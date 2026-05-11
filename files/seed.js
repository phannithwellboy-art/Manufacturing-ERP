// src/db/seed.js
require('dotenv').config();
const db     = require('./index');
const logger = require('../utils/logger');

const ROLES = [
  { name: 'Admin',    description: 'Full system access + user management' },
  { name: 'Manager',  description: 'Manage assigned departments' },
  { name: 'Operator', description: 'Edit own department only' },
  { name: 'Viewer',   description: 'Read-only access' },
];

const DEPARTMENTS = [
  { name: 'Production',  slug: 'production' },
  { name: 'Inventory',   slug: 'inventory' },
  { name: 'Work Orders', slug: 'work_orders' },
  { name: 'Quality',     slug: 'quality' },
  { name: 'Reports',     slug: 'reports' },
  { name: 'Machines',    slug: 'machines' },
];

const DEFAULT_PERMS = {
  Admin:    { production:'edit', inventory:'edit', work_orders:'edit', quality:'edit', reports:'view', machines:'edit' },
  Manager:  { production:'edit', inventory:'view', work_orders:'edit', quality:'view', reports:'view', machines:'view' },
  Operator: { production:'edit', inventory:'none', work_orders:'none', quality:'edit', reports:'view', machines:'none' },
  Viewer:   { production:'view', inventory:'view', work_orders:'view', quality:'view', reports:'view', machines:'view' },
};

async function seed() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of ROLES) {
      await client.query(
        `INSERT INTO roles (name, description) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`,
        [r.name, r.description]
      );
    }
    logger.info('Roles seeded');

    for (const d of DEPARTMENTS) {
      await client.query(
        `INSERT INTO departments (name, slug) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING`,
        [d.name, d.slug]
      );
    }
    logger.info('Departments seeded');

    for (const [roleName, deptPerms] of Object.entries(DEFAULT_PERMS)) {
      const { rows: [role] } = await client.query(`SELECT id FROM roles WHERE name=$1`, [roleName]);
      if (!role) continue;
      for (const [slug, level] of Object.entries(deptPerms)) {
        const { rows: [dept] } = await client.query(`SELECT id FROM departments WHERE slug=$1`, [slug]);
        if (!dept) continue;
        await client.query(`
          INSERT INTO permissions (role_id, department_id, access_level)
          VALUES ($1,$2,$3)
          ON CONFLICT (role_id, department_id)
          DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
        `, [role.id, dept.id, level]);
      }
    }
    logger.info('Permissions seeded');

    const { rows: [adminRole] } = await client.query(`SELECT id FROM roles WHERE name='Admin'`);
    await client.query(`
      INSERT INTO users (email, name, google_id, role_id, status)
      VALUES ('admin@factory.com','System Admin','demo_admin_id',$1,'active')
      ON CONFLICT (email) DO NOTHING
    `, [adminRole?.id]);
    logger.info('Demo admin seeded: admin@factory.com');

    await client.query('COMMIT');
    logger.info('✅  Seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Seed failed', { error: err.message });
    throw err;
  } finally {
    client.release();
    await db.pool.end();
  }
}

seed().catch(() => process.exit(1));
