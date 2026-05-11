// src/middleware/validate.js
// Request body validation using express-validator.
// Usage: router.post('/path', validate.inviteUser, handler)

const { body, param, query, validationResult } = require('express-validator');

// Helper — run after validators to return errors
function check(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ── Validators ────────────────────────────────────────────────────────────

const inviteUser = [
  body('name')
    .trim().notEmpty().withMessage('Name is required')
    .isLength({ max: 255 }).withMessage('Name too long'),
  body('email')
    .trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  body('role')
    .notEmpty().withMessage('Role is required')
    .isIn(['Admin', 'Manager', 'Operator', 'Viewer'])
    .withMessage('Role must be Admin, Manager, Operator, or Viewer'),
  check,
];

const updateUser = [
  param('id').isInt({ min: 1 }).withMessage('Invalid user ID'),
  body('role')
    .optional()
    .isIn(['Admin', 'Manager', 'Operator', 'Viewer'])
    .withMessage('Invalid role'),
  body('status')
    .optional()
    .isIn(['active', 'pending', 'suspended'])
    .withMessage('Invalid status'),
  check,
];

const updatePermission = [
  body('role')
    .notEmpty().withMessage('Role is required')
    .isIn(['Manager', 'Operator', 'Viewer'])
    .withMessage('Cannot change Admin permissions'),
  body('department')
    .notEmpty().withMessage('Department slug is required')
    .isSlug().withMessage('Invalid department slug'),
  body('access_level')
    .notEmpty().withMessage('access_level is required')
    .isIn(['edit', 'view', 'none'])
    .withMessage('access_level must be edit, view, or none'),
  check,
];

const createWorkOrder = [
  body('product').trim().notEmpty().withMessage('Product name is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('line').optional().trim(),
  body('due_at').optional().trim(),
  check,
];

const createInventory = [
  body('name').trim().notEmpty().withMessage('Material name is required'),
  body('sku').trim().notEmpty().withMessage('SKU is required')
    .isAlphanumeric('en-US', { ignore: '-_' }).withMessage('SKU must be alphanumeric'),
  body('quantity').optional().isNumeric().withMessage('Quantity must be a number'),
  body('min_stock').optional().isNumeric().withMessage('min_stock must be a number'),
  body('unit').optional().trim().isLength({ max: 20 }),
  check,
];

const createInspection = [
  body('batch_id').trim().notEmpty().withMessage('batch_id is required'),
  body('qty_inspected').isInt({ min: 0 }).withMessage('qty_inspected must be a non-negative integer'),
  body('defects').isInt({ min: 0 }).withMessage('defects must be a non-negative integer'),
  check,
];

const paginationQuery = [
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be 1–200'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
  check,
];

module.exports = {
  inviteUser,
  updateUser,
  updatePermission,
  createWorkOrder,
  createInventory,
  createInspection,
  paginationQuery,
};
