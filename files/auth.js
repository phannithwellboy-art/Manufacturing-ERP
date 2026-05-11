// src/middleware/auth.js
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME';
const LEVEL_RANK = { edit: 2, view: 1, none: 0 };

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role_name, permissions: user.permissions || {} },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Session expired — please log in again' : 'Invalid token';
    res.status(401).json({ error: msg });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      logger.warn(`Role denied: ${req.user.email} (${req.user.role}) tried ${req.method} ${req.path}`);
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

function requirePermission(departmentSlug, requiredLevel = 'view') {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'Admin') return next();
    const userLevel = req.user.permissions?.[departmentSlug] || 'none';
    if (LEVEL_RANK[userLevel] >= LEVEL_RANK[requiredLevel]) return next();
    logger.warn(`Permission denied: ${req.user.email} needs "${requiredLevel}" on "${departmentSlug}", has "${userLevel}"`);
    return res.status(403).json({
      error: `Requires "${requiredLevel}" access to "${departmentSlug}". Your level: "${userLevel}".`
    });
  };
}

async function requireActive(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { rows } = await db.query(`SELECT status FROM users WHERE id=$1`, [req.user.userId]);
    const status = rows[0]?.status;
    if (status === 'active') return next();
    if (status === 'suspended') return res.status(403).json({ error: 'Account suspended — contact admin.' });
    return res.status(403).json({ error: 'Account pending approval.' });
  } catch (err) { next(err); }
}

async function auditLog({ userId, action, entity, entityId, details, ip }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id,action,entity,entity_id,details,ip_address)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, action, entity || null, entityId || null,
       details ? JSON.stringify(details) : null, ip || null]
    );
  } catch (err) {
    logger.error('Audit log write failed', { error: err.message });
  }
}

module.exports = { generateToken, requireAuth, requireRole, requirePermission, requireActive, auditLog };
