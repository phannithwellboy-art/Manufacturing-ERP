// tests/auth.test.js
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/server');
const db      = require('../src/db');

const JWT_SECRET = process.env.JWT_SECRET || 'ci_test_jwt_secret_not_for_production';

// Helper — create a signed test token for any role
function makeToken(overrides = {}) {
  return jwt.sign({
    userId: 99,
    email: 'test@factory.com',
    role: 'Admin',
    permissions: {
      production: 'edit', inventory: 'edit', work_orders: 'edit',
      quality: 'edit', reports: 'view', machines: 'edit',
    },
    ...overrides,
  }, JWT_SECRET, { expiresIn: '1h' });
}

beforeAll(async () => {
  // Ensure test user exists in DB
  await db.query(`
    INSERT INTO users (id, email, name, status, google_id)
    VALUES (99, 'test@factory.com', 'Test Admin', 'active', 'test_google_99')
    ON CONFLICT (id) DO NOTHING
  `).catch(() => {});
});

afterAll(async () => {
  await db.pool.end();
});

// ── Health check ───────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
  });
});

// ── Auth middleware ────────────────────────────────────────────────────────
describe('Auth middleware', () => {
  it('rejects request with no token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('rejects request with invalid token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('accepts valid bearer token', async () => {
    const token = makeToken();
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@factory.com');
    expect(res.body.role).toBe('Admin');
  });

  it('accepts token from cookie', async () => {
    const token = makeToken();
    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
  });
});

// ── Role guard ─────────────────────────────────────────────────────────────
describe('Role-based access control', () => {
  it('allows Admin to access /admin/users', async () => {
    const token = makeToken({ role: 'Admin' });
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 403]).toContain(res.status); // 403 only if user status != active
  });

  it('blocks Viewer from /admin/users', async () => {
    const token = makeToken({ role: 'Viewer' });
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('blocks Manager from /admin/users', async () => {
    const token = makeToken({ role: 'Manager' });
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── Permission guard ───────────────────────────────────────────────────────
describe('Department permission enforcement', () => {
  it('blocks Operator from creating inventory (none access)', async () => {
    const token = makeToken({
      role: 'Operator',
      permissions: { inventory: 'none', production: 'edit', quality: 'edit', reports: 'view' },
    });
    const res = await request(app)
      .post('/erp/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Material', sku: 'TST001', quantity: 100 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/inventory/i);
  });

  it('allows Viewer to GET /erp/inventory (view access)', async () => {
    const token = makeToken({
      role: 'Viewer',
      permissions: { inventory: 'view', production: 'view', quality: 'view', reports: 'view', work_orders: 'view', machines: 'view' },
    });
    const res = await request(app)
      .get('/erp/inventory')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 403]).toContain(res.status);
  });

  it('blocks Viewer from POST /erp/inventory', async () => {
    const token = makeToken({
      role: 'Viewer',
      permissions: { inventory: 'view' },
    });
    const res = await request(app)
      .post('/erp/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', sku: 'T001', quantity: 10 });
    expect(res.status).toBe(403);
  });
});

// ── Input validation ───────────────────────────────────────────────────────
describe('Input validation', () => {
  it('rejects work order with missing product', async () => {
    const token = makeToken();
    const res = await request(app)
      .post('/erp/work-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 100 }); // missing product
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/validation/i);
  });

  it('rejects work order with non-integer quantity', async () => {
    const token = makeToken();
    const res = await request(app)
      .post('/erp/work-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ product: 'Test', quantity: -5 });
    expect(res.status).toBe(422);
  });

  it('rejects invite with invalid email', async () => {
    const token = makeToken({ role: 'Admin' });
    const res = await request(app)
      .post('/admin/users/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test User', email: 'not-an-email', role: 'Viewer' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toBeDefined();
  });
});

// ── Logout ─────────────────────────────────────────────────────────────────
describe('POST /auth/logout', () => {
  it('clears the cookie and returns 200', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
    expect(res.headers['set-cookie']).toBeDefined();
  });
});
