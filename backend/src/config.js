"use strict";

// Central runtime configuration. Everything environment-specific is read here,
// validated once at startup, and passed around as a frozen object.

const path = require("path");

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";

  const appUrl = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const appIsHttps = appUrl.startsWith("https://");

  const sessionSecret = env.SESSION_SECRET || "";
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  if (/change-me|replace-with/i.test(sessionSecret) && isProduction) {
    throw new Error("SESSION_SECRET still contains a placeholder value");
  }

  const enableTestAuth = bool(env.ENABLE_TEST_AUTH);
  if (enableTestAuth && !isTest) {
    throw new Error("ENABLE_TEST_AUTH is only permitted when NODE_ENV=test");
  }

  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const appleConfigured = Boolean(
    env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
  );

  const storageDriver = env.STORAGE_DRIVER || "local";
  if (!["local", "s3"].includes(storageDriver)) {
    throw new Error("STORAGE_DRIVER must be 'local' or 's3'");
  }
  if (storageDriver === "s3" && !env.S3_BUCKET) {
    throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
  }

  const database = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.DB_HOST || "localhost",
        port: int(env.DB_PORT, 5434),
        user: env.DB_USER || "postgres",
        password: env.DB_PASSWORD || "admin",
        database: env.DB_NAME || "lost_found_db",
      };
  if (bool(env.DB_SSL)) {
    database.ssl = { rejectUnauthorized: bool(env.DB_SSL_REJECT_UNAUTHORIZED, true) };
  }
  database.max = int(env.DB_POOL_MAX, 10);

  return Object.freeze({
    nodeEnv,
    isProduction,
    isTest,
    port: int(env.PORT, 5000),
    appUrl,
    allowedOrigins: list(env.ALLOWED_ORIGINS).length ? list(env.ALLOWED_ORIGINS) : [appUrl],
    trustProxy: env.TRUST_PROXY === undefined ? 1 : int(env.TRUST_PROXY, 1),
    logLevel: env.LOG_LEVEL || (isTest ? "warn" : "info"),
    database,
    session: {
      secret: sessionSecret,
      cookieName: env.SESSION_COOKIE_NAME || "lf.sid",
      // Secure cookies whenever the public app is served over HTTPS.
      secureCookie: bool(env.COOKIE_SECURE, appIsHttps),
      maxAgeMs: int(env.SESSION_MAX_AGE_HOURS, 24 * 14) * 60 * 60 * 1000,
    },
    google: googleConfigured
      ? {
          clientID: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          callbackURL: env.GOOGLE_CALLBACK_URL || `${appUrl}/api/auth/google/callback`,
        }
      : null,
    apple: appleConfigured
      ? {
          clientID: env.APPLE_CLIENT_ID,
          teamID: env.APPLE_TEAM_ID,
          keyID: env.APPLE_KEY_ID,
          privateKeyString: env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          callbackURL: env.APPLE_CALLBACK_URL || `${appUrl}/api/auth/apple/callback`,
        }
      : null,
    emailLogin: bool(env.EMAIL_LOGIN_ENABLED, Boolean(env.SMTP_URL) || isTest),
    mail: {
      smtpUrl: env.SMTP_URL || "",
      from: env.MAIL_FROM || "Lost & Found <no-reply@localhost>",
      notificationEmails: bool(env.NOTIFICATION_EMAILS, Boolean(env.SMTP_URL)),
    },
    storage: {
      driver: storageDriver,
      localDir: path.resolve(env.STORAGE_LOCAL_DIR || path.join(__dirname, "..", "storage")),
      s3Bucket: env.S3_BUCKET || "",
      s3Region: env.S3_REGION || env.AWS_REGION || "us-east-1",
      s3Prefix: (env.S3_PREFIX || "").replace(/^\/|\/$/g, ""),
      cloudfrontDistributionId: env.CLOUDFRONT_DISTRIBUTION_ID || "",
      legacyUploadsDir: path.resolve(env.LEGACY_UPLOADS_DIR || path.join(__dirname, "..", "uploads")),
    },
    uploads: {
      maxFiles: int(env.UPLOAD_MAX_FILES, 5),
      maxFileBytes: int(env.UPLOAD_MAX_FILE_MB, 8) * 1024 * 1024,
      maxPixels: int(env.UPLOAD_MAX_MEGAPIXELS, 40) * 1_000_000,
      maxDimension: int(env.UPLOAD_MAX_DIMENSION, 10000),
      minDimension: 32,
    },
    rateLimitMultiplier: Math.max(0.01, Number(env.RATE_LIMIT_MULTIPLIER || 1)),
    enableTestAuth,
    metricsEnabled: bool(env.METRICS_ENABLED, true),
  });
}

module.exports = { loadConfig };
