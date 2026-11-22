"use strict";

// Email one-time codes.
// - 6-digit codes from a CSPRNG, stored only as an HMAC keyed by the server secret
// - 10 minute expiry; requesting a new code invalidates earlier unused codes
// - 5 wrong attempts burn the code
// - consumption is a single conditional UPDATE, so a code can be used once even
//   under concurrent verification requests (replay prevention)
// - per-email request limit in addition to the per-IP route limiter

const crypto = require("crypto");

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MINUTES = 15;

function hashCode(secret, email, code) {
  return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

function createOtpService({ pool, mailer, config }) {
  async function requestCode(email) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM otp_codes
       WHERE email = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
      [email, String(REQUEST_WINDOW_MINUTES)]
    );
    if (rows[0].n >= MAX_REQUESTS_PER_WINDOW) return { sent: false, reason: "too_many_requests" };

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await pool.query(
      "UPDATE otp_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL",
      [email]
    );
    await pool.query(
      `INSERT INTO otp_codes (email, code_hash, expires_at)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [email, hashCode(config.session.secret, email, code), String(CODE_TTL_MINUTES)]
    );
    const result = await mailer.send({
      to: email,
      subject: `Your Lost & Found sign-in code: ${code}`,
      text: `Your sign-in code is ${code}.\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.`,
      template: "otp",
    });
    return { sent: result.status === "sent", reason: result.status === "sent" ? undefined : result.detail };
  }

  async function verifyCode(email, code) {
    const { rows } = await pool.query(
      `SELECT id, code_hash, attempts FROM otp_codes
       WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const record = rows[0];
    if (!record || record.attempts >= MAX_ATTEMPTS) return false;

    const expected = Buffer.from(record.code_hash, "hex");
    const actual = Buffer.from(hashCode(config.session.secret, email, code), "hex");
    if (!crypto.timingSafeEqual(expected, actual)) {
      await pool.query(
        `UPDATE otp_codes SET attempts = attempts + 1,
           consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
         WHERE id = $1`,
        [record.id, MAX_ATTEMPTS]
      );
      return false;
    }

    const consumed = await pool.query(
      "UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id",
      [record.id]
    );
    return consumed.rowCount === 1;
  }

  return { requestCode, verifyCode };
}

module.exports = { createOtpService, hashCode, CODE_TTL_MINUTES, MAX_ATTEMPTS };
