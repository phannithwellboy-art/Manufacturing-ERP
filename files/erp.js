// src/routes/erp.js
const express  = require('express');
const db       = require('../db');
const { requireAuth, requireActive, requirePermission, auditLog } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth, requireActive);

// ── Production ─────────────────────────────────────────────────────────────

router.get('/production', requirePermission('production','view'), async (req, res, next) => {
  try {
    res.json({
      lines: [
        { line:'Line A', wo:'#WO-2042', product:'Bracket X4', pct:72, operator:'K. Sovann', status:'running' },
        { line:'Line B', wo:'#WO-2043', product:'Motor Housing', pct:45, operator:'P. Dara', status:'running' },
        { line:'Line E', wo:null, product:null, pct:0, operator:null, status:'maintenance' },
      ],
      kpi: { linesActive:4, unitsPerHour:212, scrapRate:1.7, shiftOutput:847 }
    });
  } catch (err) { next(err); }
});

router.post('/production/lines', requirePermission('production','edit'), async (req, res, next) => {
  try {
    const { line, product, operator } = req.body;
    if (!line) return res.status(400).json({ error: 'line is required' });
    await auditLog({ userId: req.user.userId, action: 'production_line_added',
      entity: 'production', details: { line, product, operator }, ip: req.ip });
    res.status(201).json({ message: 'Line added', line: { line, product, operator, status:'running' } });
  } catch (err) { next(err); }
});

// ── Inventory ──────────────────────────────────────────────────────────────

router.get('/inventory', requirePermission('inventory','view'), async (req, res, next) => {
  try {
    const { search } = req.query;
    const params = [];
    let q = `SELECT * FROM inventory`;
    if (search) { params.push(`%${search}%`); q += ` WHERE name ILIKE $1 OR sku ILIKE $1`; }
    q += ` ORDER BY name`;
    const { rows } = await db.query(q, params);
    const enriched = rows.map(r => ({
      ...r,
      stock_status: r.quantity >= r.min_stock ? 'ok'
        : r.quantity >= r.min_stock * 0.5 ? 'low' : 'critical'
    }));
    res.json({ inventory: enriched, total: enriched.length });
  } catch (err) { next(err); }
});

router.post('/inventory', requirePermission('inventory','edit'), validate.createInventory, async (req, res, next) => {
  try {
    const { name, sku, quantity, min_stock, unit } = req.body;
    const { rows: [item] } = await db.query(`
      INSERT INTO inventory (name,sku,quantity,min_stock,unit,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *
    `, [name, sku.toUpperCase(), quantity||0, min_stock||0, unit||'pcs', req.user.userId]);
    await auditLog({ userId: req.user.userId, action: 'inventory_created',
      entity: 'inventory', entityId: item.id, details: { name, sku }, ip: req.ip });
    res.status(201).json({ item });
  } catch (err) { next(err); }
});

router.patch('/inventory/:id', requirePermission('inventory','edit'), async (req, res, next) => {
  try {
    const { quantity, min_stock, name, unit } = req.body;
    const { rows: [item] } = await db.query(`
      UPDATE inventory SET
        quantity=COALESCE($1,quantity), min_stock=COALESCE($2,min_stock),
        name=COALESCE($3,name), unit=COALESCE($4,unit),
        updated_by=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [quantity, min_stock, name, unit, req.user.userId, req.params.id]);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await auditLog({ userId: req.user.userId, action: 'inventory_updated',
      entity: 'inventory', entityId: parseInt(req.params.id), details: req.body, ip: req.ip });
    res.json({ item });
  } catch (err) { next(err); }
});

// ── Work Orders ────────────────────────────────────────────────────────────

router.get('/work-orders', requirePermission('work_orders','view'), async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [];
    let q = `SELECT w.*, u.name AS created_by_name FROM work_orders w
             LEFT JOIN users u ON w.created_by=u.id`;
    if (status) { params.push(status); q += ` WHERE w.status=$1`; }
    q += ` ORDER BY w.created_at DESC`;
    const { rows } = await db.query(q, params);
    res.json({ workOrders: rows, total: rows.length });
  } catch (err) { next(err); }
});

router.post('/work-orders', requirePermission('work_orders','edit'), validate.createWorkOrder, async (req, res, next) => {
  try {
    const { product, quantity, line, start_time, due_at } = req.body;
    const { rows: [{ count }] } = await db.query(`SELECT COUNT(*) FROM work_orders`);
    const woNumber = `WO-${2046 + parseInt(count)}`;
    const { rows: [wo] } = await db.query(`
      INSERT INTO work_orders (wo_number,product,quantity,line,start_time,due_at,status,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$7) RETURNING *
    `, [woNumber, product, quantity, line, start_time, due_at, req.user.userId]);
    await auditLog({ userId: req.user.userId, action: 'work_order_created',
      entity: 'work_order', entityId: wo.id, details: { woNumber, product, quantity }, ip: req.ip });
    res.status(201).json({ workOrder: wo });
  } catch (err) { next(err); }
});

router.patch('/work-orders/:id', requirePermission('work_orders','edit'), async (req, res, next) => {
  try {
    const { status, line, due_at } = req.body;
    const valid = ['pending','in_progress','completed','cancelled'];
    if (status && !valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows: [wo] } = await db.query(`
      UPDATE work_orders SET status=COALESCE($1,status),line=COALESCE($2,line),
        due_at=COALESCE($3,due_at),updated_by=$4,updated_at=NOW()
      WHERE id=$5 RETURNING *
    `, [status, line, due_at, req.user.userId, req.params.id]);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    await auditLog({ userId: req.user.userId, action: 'work_order_updated',
      entity: 'work_order', entityId: parseInt(req.params.id), details: req.body, ip: req.ip });
    res.json({ workOrder: wo });
  } catch (err) { next(err); }
});

// ── Quality ────────────────────────────────────────────────────────────────

router.get('/quality', requirePermission('quality','view'), async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT q.*, u.name AS created_by_name FROM qc_inspections q
      LEFT JOIN users u ON q.created_by=u.id ORDER BY q.created_at DESC LIMIT 100
    `);
    res.json({ inspections: rows });
  } catch (err) { next(err); }
});

router.post('/quality', requirePermission('quality','edit'), validate.createInspection, async (req, res, next) => {
  try {
    const { batch_id, product, qty_inspected, defects, inspector, notes } = req.body;
    const def = parseInt(defects)||0, qty = parseInt(qty_inspected)||0;
    const rate = qty > 0 ? def/qty : 0;
    const result = rate === 0 ? 'pass' : rate < 0.05 ? 'review' : 'fail';
    const { rows: [insp] } = await db.query(`
      INSERT INTO qc_inspections (batch_id,product,qty_inspected,defects,inspector,result,notes,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [batch_id, product, qty, def, inspector, result, notes, req.user.userId]);
    await auditLog({ userId: req.user.userId, action: 'qc_inspection_logged',
      entity: 'qc_inspection', entityId: insp.id, details: { batch_id, result, defects: def }, ip: req.ip });
    res.status(201).json({ inspection: insp });
  } catch (err) { next(err); }
});

// ── Machines ───────────────────────────────────────────────────────────────

router.get('/machines', requirePermission('machines','view'), async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM machines ORDER BY machine_id`);
    res.json({ machines: rows });
  } catch (err) { next(err); }
});

router.post('/machines', requirePermission('machines','edit'), async (req, res, next) => {
  try {
    const { machine_id, type, line, last_service, next_pm } = req.body;
    if (!machine_id) return res.status(400).json({ error: 'machine_id required' });
    const { rows: [m] } = await db.query(`
      INSERT INTO machines (machine_id,type,line,last_service,next_pm,status,created_by)
      VALUES ($1,$2,$3,$4,$5,'running',$6) RETURNING *
    `, [machine_id, type, line, last_service, next_pm, req.user.userId]);
    await auditLog({ userId: req.user.userId, action: 'machine_added',
      entity: 'machine', entityId: m.id, details: { machine_id, type, line }, ip: req.ip });
    res.status(201).json({ machine: m });
  } catch (err) { next(err); }
});

router.patch('/machines/:id', requirePermission('machines','edit'), async (req, res, next) => {
  try {
    const { status, next_pm, last_service } = req.body;
    const { rows: [m] } = await db.query(`
      UPDATE machines SET status=COALESCE($1,status),next_pm=COALESCE($2,next_pm),
        last_service=COALESCE($3,last_service),updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [status, next_pm, last_service, req.params.id]);
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json({ machine: m });
  } catch (err) { next(err); }
});

// ── Reports ────────────────────────────────────────────────────────────────

router.get('/reports/summary', requirePermission('reports','view'), async (req, res, next) => {
  try {
    const [[wo], [inv], [qc]] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM work_orders WHERE status='in_progress'`),
      db.query(`SELECT COUNT(*) FROM inventory WHERE quantity < min_stock`),
      db.query(`SELECT COUNT(*) FROM qc_inspections WHERE result='pass'`),
    ]).then(r => r.map(x => x.rows));
    res.json({
      openWorkOrders: parseInt(wo.count),
      lowStockItems:  parseInt(inv.count),
      qcPassCount:    parseInt(qc.count),
      generatedAt:    new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
