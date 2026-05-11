// src/routes/admin.js
const express  = require('express');
const db       = require('../db');
const { requireAuth, requireRole, requireActive, auditLog } = require('../middleware/auth');
const validate = require('../middleware/validate');
const logger   = require('../utils/logger');

const router = express.Router();
router.use(requireAuth, requireActive, requireRole('Admin'));

// ── Users ──────────────────────────────────────────────────────────────────

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.avatar_url, u.status,
             u.last_login_at, u.created_at, r.name AS role
      FROM users u LEFT JOIN roles r ON u.role_id=r.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

router.post('/users/invite', validate.inviteUser, async (req, res, next) => {
  try {
    const { name, email, role } = req.body;
    const { rows: [roleRow] } = await db.query(`SELECT id FROM roles WHERE name=$1`, [role]);
    if (!roleRow) return res.status(400).json({ error: 'Invalid role' });

    const exists = await db.query(`SELECT id FROM users WHERE email=$1`, [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered' });

    const { rows: [user] } = await db.query(`
      INSERT INTO users (email,name,role_id,status,invited_by)
      VALUES ($1,$2,$3,'pending',$4) RETURNING id,name,email,status
    `, [email, name, roleRow.id, req.user.userId]);

    await auditLog({ userId: req.user.userId, action: 'user_invited',
      entity: 'user', entityId: user.id, details: { email, role }, ip: req.ip });

    logger.info(`Admin ${req.user.email} invited ${email} as ${role}`);
    res.status(201).json({ user, message: `Invite sent to ${email}` });
  } catch (err) { next(err); }
});

router.patch('/users/:id', validate.updateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, status } = req.body;
    if (parseInt(id) === req.user.userId && role && role !== 'Admin') {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    const sets = [], vals = [];
    if (role) {
      const { rows: [r] } = await db.query(`SELECT id FROM roles WHERE name=$1`, [role]);
      if (!r) return res.status(400).json({ error: 'Invalid role' });
      sets.push(`role_id=$${vals.push(r.id)}`);
    }
    if (status) sets.push(`status=$${vals.push(status)}`);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at=NOW()');
    vals.push(id);
    const { rows: [user] } = await db.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,name,email,status`,
      vals
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    await auditLog({ userId: req.user.userId, action: 'user_updated',
      entity: 'user', entityId: parseInt(id), details: { role, status }, ip: req.ip });
    res.json({ user });
  } catch (err) { next(err); }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (parseInt(req.params.id) === req.user.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const { rows: [user] } = await db.query(
      `DELETE FROM users WHERE id=$1 RETURNING id,email`, [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    await auditLog({ userId: req.user.userId, action: 'user_deleted',
      entity: 'user', entityId: parseInt(req.params.id), details: { email: user.email }, ip: req.ip });
    res.json({ message: 'User removed' });
  } catch (err) { next(err); }
});

// ── Permissions ────────────────────────────────────────────────────────────

router.get('/permissions', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT r.name AS role, d.name AS department, d.slug, p.access_level
      FROM permissions p
      JOIN roles r ON p.role_id=r.id
      JOIN departments d ON p.department_id=d.id
      ORDER BY r.name, d.name
    `);
    const matrix = {};
    rows.forEach(r => {
      if (!matrix[r.role]) matrix[r.role] = {};
      matrix[r.role][r.slug] = r.access_level;
    });
    res.json({ matrix });
  } catch (err) { next(err); }
});

router.patch('/permissions', validate.updatePermission, async (req, res, next) => {
  try {
    const { role, department, access_level } = req.body;
    const { rows: [roleRow] } = await db.query(`SELECT id FROM roles WHERE name=$1`, [role]);
    const { rows: [deptRow] } = await db.query(`SELECT id FROM departments WHERE slug=$1`, [department]);
    if (!roleRow) return res.status(400).json({ error: 'Role not found' });
    if (!deptRow) return res.status(400).json({ error: 'Department not found' });

    await db.query(`
      UPDATE permissions SET access_level=$1, updated_at=NOW(), updated_by=$2
      WHERE role_id=$3 AND department_id=$4
    `, [access_level, req.user.userId, roleRow.id, deptRow.id]);

    await auditLog({ userId: req.user.userId, action: 'permission_changed',
      details: { role, department, access_level }, ip: req.ip });

    logger.info(`Permission updated: ${role}/${department} → ${access_level} by ${req.user.email}`);
    res.json({ message: 'Permission updated', role, department, access_level });
  } catch (err) { next(err); }
});

// ── Audit log ──────────────────────────────────────────────────────────────

router.get('/audit', validate.paginationQuery, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || '50'), 200);
    const offset = parseInt(req.query.offset || '0');
    const { rows } = await db.query(`
      SELECT a.id, a.action, a.entity, a.entity_id, a.details,
             a.ip_address, a.created_at,
             u.name AS user_name, u.email AS user_email
      FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id
      ORDER BY a.created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const { rows: [{ count }] } = await db.query(`SELECT COUNT(*) FROM audit_logs`);
    res.json({ logs: rows, total: parseInt(count), limit, offset });
  } catch (err) { next(err); }
});

router.get('/roles',       async (req, res, next) => { try { res.json({ roles: (await db.query(`SELECT * FROM roles ORDER BY id`)).rows }); } catch(e){next(e);} });
router.get('/departments', async (req, res, next) => { try { res.json({ departments: (await db.query(`SELECT * FROM departments ORDER BY id`)).rows }); } catch(e){next(e);} });

module.exports = router;
