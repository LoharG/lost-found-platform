"use strict";

// Outbound email. With SMTP_URL set (e.g. Mailpit locally, SES/SendGrid SMTP in
// production) messages are sent through nodemailer; otherwise a log-only
// adapter records that a message would have been sent, without its content.

const nodemailer = require("nodemailer");

function createMailer(config, logger) {
  if (!config.mail.smtpUrl) {
    return {
      configured: false,
      async send({ template }) {
        logger.info({ template }, "Email not sent: SMTP_URL is not configured");
        return { status: "skipped", detail: "smtp_not_configured" };
      },
    };
  }

  const transport = nodemailer.createTransport(config.mail.smtpUrl);
  return {
    configured: true,
    async send({ to, subject, text, template }) {
      try {
        const info = await transport.sendMail({ from: config.mail.from, to, subject, text });
        return { status: "sent", detail: info.messageId };
      } catch (error) {
        logger.error({ err: error, template }, "Email delivery failed");
        return { status: "failed", detail: error.code || "send_failed" };
      }
    },
  };
}

module.exports = { createMailer };
