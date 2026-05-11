// src/db/index.js
// PostgreSQL pool with connection retry (important for Docker startup race)

const { Pool } = require('pg');
const logger   = require('../utils/logger');

const pool = new Pool({
  host:                    process.env.DB_HOST     || 'localhost',
  port:                    parseInt(process.env.DB_PORT || '5432'),
  database:                process.env.DB_NAME     || 'factory_erp',
  user:                    process.env.DB_USER     || 'postgres',
  password:                process.env.DB_PASSWORD || '',
  max:                     parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }   // for managed DBs like Neon/Supabase
    : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

// Test connection with retry — waits for DB container to be ready
async function connectWithRetry(retries = 10, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      const res    = await client.query('SELECT NOW()');
      client.release();
      logger.info(`PostgreSQL connected — ${res.rows[0].now}`);
      return;
    } catch (err) {
      logger.warn(`DB connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) {
        logger.error('Could not connect to PostgreSQL after maximum retries');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

const db = {
  query:            (text, params) => pool.query(text, params),
  pool,
  connectWithRetry,
};

module.exports = db;
