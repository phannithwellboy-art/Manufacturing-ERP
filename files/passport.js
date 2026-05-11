// src/config/passport.js
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db             = require('../db');
const logger         = require('../utils/logger');

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

function domainAllowed(email) {
  if (!ALLOWED_DOMAINS.length) return true;
  return ALLOWED_DOMAINS.includes(email.split('@')[1]?.toLowerCase());
}

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL,
  scope: ['profile', 'email'],
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const email     = profile.emails?.[0]?.value?.toLowerCase();
    const googleId  = profile.id;
    const name      = profile.displayName;
    const avatarUrl = profile.photos?.[0]?.value;

    if (!email) return done(null, false, { message: 'No email from Google' });
    if (!domainAllowed(email)) {
      return done(null, false, { message: `Domain not permitted. Allowed: ${ALLOWED_DOMAINS.join(', ') || 'any'}` });
    }

    let { rows } = await db.query(
      `SELECT u.*, r.name AS role_name FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.google_id=$1 OR u.email=$2 LIMIT 1`,
      [googleId, email]
    );
    let user = rows[0];

    if (user) {
      if (user.status === 'suspended') {
        return done(null, false, { message: 'Account suspended — contact admin.' });
      }
      await db.query(
        `UPDATE users SET google_id=$1, avatar_url=$2, last_login_at=NOW(), updated_at=NOW() WHERE id=$3`,
        [googleId, avatarUrl, user.id]
      );
    } else {
      const viewerRole = await db.query(`SELECT id FROM roles WHERE name='Viewer'`);
      const roleId = viewerRole.rows[0]?.id;
      const insert = await db.query(
        `INSERT INTO users (google_id,email,name,avatar_url,role_id,status)
         VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
        [googleId, email, name, avatarUrl, roleId]
      );
      user = insert.rows[0];
      user.role_name = 'Viewer';
      logger.info(`New user registered: ${email}`);
    }

    if (user.status === 'pending') user.pendingApproval = true;

    // Attach permissions from DB
    const perms = await db.query(
      `SELECT d.slug, p.access_level FROM permissions p
       JOIN departments d ON p.department_id=d.id
       JOIN roles r ON p.role_id=r.id WHERE r.name=$1`,
      [user.role_name || 'Viewer']
    );
    user.permissions = {};
    perms.rows.forEach(p => { user.permissions[p.slug] = p.access_level; });

    await db.query(
      `INSERT INTO audit_logs (user_id,action,details) VALUES ($1,'login',$2)`,
      [user.id, JSON.stringify({ email, provider: 'google' })]
    );

    return done(null, user);
  } catch (err) {
    logger.error('Passport error', { error: err.message });
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await db.query(
      `SELECT u.*, r.name AS role_name FROM users u
       LEFT JOIN roles r ON u.role_id=r.id WHERE u.id=$1`,
      [id]
    );
    const user = rows[0];
    if (!user) return done(null, false);
    const perms = await db.query(
      `SELECT d.slug, p.access_level FROM permissions p
       JOIN departments d ON p.department_id=d.id
       JOIN roles r ON p.role_id=r.id WHERE r.name=$1`,
      [user.role_name]
    );
    user.permissions = {};
    perms.rows.forEach(p => { user.permissions[p.slug] = p.access_level; });
    done(null, user);
  } catch (err) { done(err); }
});

module.exports = passport;
