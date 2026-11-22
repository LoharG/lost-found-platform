"use strict";

const { Pool } = require("pg");

function createPool(config, logger) {
  const pool = new Pool(config.database);
  pool.on("error", (error) => logger.error({ err: error }, "Idle PostgreSQL client error"));
  return pool;
}

// Runs fn(client) inside a transaction and always releases the client.
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
