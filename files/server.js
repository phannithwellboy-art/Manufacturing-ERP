// src/server.js
require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const passport     = require('./config/passport');
const db           = require('./db');
const logger       = require('./utils/logger');

const authRoutes  = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const erpRoutes   = require('./routes/erp');

const app  = express();
const PORT = parseInt(process.env.PORT || '4000');

// ── Security ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
}));
app.use(compression());
app.set('trust proxy', 1); // trust nginx/Cloudflare

// ── CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods:     ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ── Parsing ────────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── HTTP Logging ───────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
  { stream: logger.stream }
));

// ── Rate limiting ──────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { error: 'Rate limit exceeded.' },
});

// ── Session (for Passport OAuth handshake only) ────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'CHANGE_ME',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   10 * 60 * 1000, // 10 min — only needed for OAuth dance
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/auth',  authLimiter, authRoutes);
app.use('/admin', apiLimiter,  adminRoutes);
app.use('/erp',   apiLimiter,  erpRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error(`${req.method} ${req.path} — ${err.message}`, { stack: err.stack });
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record not found' });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  await db.connectWithRetry();
  app.listen(PORT, () => {
    logger.info(`FactoryOS ERP running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  await db.pool.end();
  process.exit(0);
});

module.exports = app;
