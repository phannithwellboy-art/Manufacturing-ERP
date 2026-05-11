// src/routes/auth.js
const express  = require('express');
const passport = require('../config/passport');
const { generateToken, requireAuth } = require('../middleware/auth');
const logger   = require('../utils/logger');

const router       = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   8 * 60 * 60 * 1000,
};

// GET /auth/google — start OAuth flow
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })
);

// GET /auth/google/callback — OAuth redirect
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${FRONTEND_URL}/login?error=auth_failed` }),
  (req, res) => {
    const user = req.user;
    if (!user) return res.redirect(`${FRONTEND_URL}/login?error=no_user`);

    const token = generateToken(user);
    res.cookie('token', token, COOKIE_OPTS);

    logger.info(`User logged in: ${user.email} (${user.role_name})`);

    if (user.pendingApproval) return res.redirect(`${FRONTEND_URL}/pending`);

    // Pass token in URL so SPA can hold it in memory
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${encodeURIComponent(token)}`);
  }
);

// GET /auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({
    userId:      req.user.userId,
    email:       req.user.email,
    role:        req.user.role,
    permissions: req.user.permissions,
    expiresAt:   new Date(req.user.exp * 1000).toISOString(),
  });
});

// GET /auth/permissions
router.get('/permissions', requireAuth, (req, res) => {
  res.json({ permissions: req.user.permissions });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.json({ message: 'Logged out' });
});

module.exports = router;
