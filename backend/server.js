"use strict";

// Entry point. `node server.js` serves the API; `node server.js migrate`
// applies database migrations and the legacy image backfill, then exits.

require("dotenv").config({ quiet: true });

const { loadConfig } = require("./src/config");
const { createLogger } = require("./src/logger");
const { createPool } = require("./src/db");
const { runMigrations } = require("./src/migrate");
const { createStorage } = require("./src/storage");
const { backfillLegacyImages } = require("./src/legacyImages");
const { createApp } = require("./src/app");

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config, logger);

  if (process.argv[2] === "migrate") {
    const ran = await runMigrations(pool, logger);
    logger.info({ applied: ran }, ran.length ? "Migrations applied" : "Database already up to date");
    await backfillLegacyImages({ pool, storage: createStorage(config.storage, logger), config, logger });
    await pool.end();
    return;
  }

  const app = createApp({ config, pool, logger });
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, google: Boolean(config.google), apple: Boolean(config.apple), emailLogin: config.emailLogin, storage: config.storage.driver },
      "API listening"
    );
  });

  // Graceful shutdown for rolling deploys.
  const shutdown = (signal) => {
    logger.info({ signal }, "Shutting down");
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "fatal", msg: error.message }));
  process.exit(1);
});
