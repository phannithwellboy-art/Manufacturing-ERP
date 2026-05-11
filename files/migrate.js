// src/db/migrate.js
require('dotenv').config();
const db     = require('./index');
const logger = require('../utils/logger');

async function migrate() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(50)  UNIQUE NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              SERIAL PRIMARY KEY,
        google_id       VARCHAR(100) UNIQUE,
        email           VARCHAR(255) UNIQUE NOT NULL,
        name            VARCHAR(255) NOT NULL,
        avatar_url      TEXT,
        role_id         INTEGER REFERENCES roles(id) ON DELETE SET NULL,
        status          VARCHAR(20)  DEFAULT 'pending'
                          CHECK (status IN ('active','pending','suspended')),
        last_login_at   TIMESTAMPTZ,
        invited_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) UNIQUE NOT NULL,
        slug        VARCHAR(50)  UNIQUE NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id            SERIAL PRIMARY KEY,
        role_id       INTEGER REFERENCES roles(id)       ON DELETE CASCADE,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        access_level  VARCHAR(10) DEFAULT 'none'
                        CHECK (access_level IN ('edit','view','none')),
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (role_id, department_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action      VARCHAR(100) NOT NULL,
        entity      VARCHAR(100),
        entity_id   INTEGER,
        details     JSONB,
        ip_address  INET,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id          SERIAL PRIMARY KEY,
        wo_number   VARCHAR(20)  UNIQUE NOT NULL,
        product     VARCHAR(255) NOT NULL,
        quantity    INTEGER      NOT NULL DEFAULT 0,
        line        VARCHAR(50),
        start_time  VARCHAR(50),
        due_at      VARCHAR(100),
        status      VARCHAR(20)  DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','completed','cancelled')),
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        sku         VARCHAR(50)  UNIQUE NOT NULL,
        quantity    NUMERIC(12,2) DEFAULT 0,
        min_stock   NUMERIC(12,2) DEFAULT 0,
        unit        VARCHAR(20),
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS machines (
        id            SERIAL PRIMARY KEY,
        machine_id    VARCHAR(50) UNIQUE NOT NULL,
        type          VARCHAR(100),
        line          VARCHAR(50),
        last_service  VARCHAR(50),
        next_pm       VARCHAR(50),
        status        VARCHAR(20) DEFAULT 'running'
                        CHECK (status IN ('running','maintenance','idle','pm_overdue')),
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS qc_inspections (
        id              SERIAL PRIMARY KEY,
        batch_id        VARCHAR(50) NOT NULL,
        product         VARCHAR(255),
        qty_inspected   INTEGER DEFAULT 0,
        defects         INTEGER DEFAULT 0,
        inspector       VARCHAR(100),
        result          VARCHAR(10) DEFAULT 'pass'
                          CHECK (result IN ('pass','review','fail')),
        notes           TEXT,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_users_google_id  ON users(google_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_status     ON users(status)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_time       ON audit_logs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs(action)`,
      `CREATE INDEX IF NOT EXISTS idx_wo_status        ON work_orders(status)`,
      `CREATE INDEX IF NOT EXISTS idx_wo_line          ON work_orders(line)`,
      `CREATE INDEX IF NOT EXISTS idx_inv_sku          ON inventory(sku)`,
      `CREATE INDEX IF NOT EXISTS idx_perms_role       ON permissions(role_id)`,
    ];
    for (const idx of indexes) await client.query(idx);

    await client.query('COMMIT');
    logger.info('✅  Migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Migration failed', { error: err.message });
    throw err;
  } finally {
    client.release();
    await db.pool.end();
  }
}

migrate().catch(() => process.exit(1));
