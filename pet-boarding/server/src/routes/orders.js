const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

const VALID_TRANSITIONS = {
  pending:   { provider: ['confirmed', 'cancelled'], user: ['cancelled'] },
  confirmed: { provider: ['ongoing', 'cancelled'],   user: ['cancelled'] },
  ongoing:   { provider: ['completed'],              user: [] },
  completed: { provider: [],                         user: [] },
  cancelled: { provider: [],                         user: [] },
};

router.post('/', auth, async (req, res, next) => {
  try {
    const { providerId, petId, startDate, endDate, note } = req.body;
    if (!providerId || !petId || !startDate || !endDate)
      return res.status(400).json({ code: 400, message: 'providerId, petId, startDate, endDate required', data: null });
    const [providers] = await pool.query('SELECT price_per_day FROM providers WHERE id=?', [providerId]);
    if (!providers.length) return res.status(404).json({ code: 404, message: 'Provider not found', data: null });
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000);
    if (days <= 0) return res.status(400).json({ code: 400, message: 'end_date must be after start_date', data: null });
    const totalPrice = (providers[0].price_per_day * days).toFixed(2);
    const [result] = await pool.query(
      'INSERT INTO orders (user_id, provider_id, pet_id, start_date, end_date, total_price, note) VALUES (?,?,?,?,?,?,?)',
      [req.user.userId, providerId, petId, startDate, endDate, totalPrice, note]
    );
    res.json({ code: 200, message: 'ok', data: { id: result.insertId, totalPrice } });
  } catch (err) { next(err); }
});

router.get('/', auth, async (req, res, next) => {
  try {
    const { role } = req.user;
    let rows;
    if (role === 'provider') {
      const [prov] = await pool.query('SELECT id FROM providers WHERE user_id=?', [req.user.userId]);
      if (!prov.length) return res.json({ code: 200, message: 'ok', data: [] });
      [rows] = await pool.query(
        `SELECT o.*, u.nickname as user_nickname, p.name as pet_name, p.species as pet_species
         FROM orders o JOIN users u ON o.user_id=u.id JOIN pets p ON o.pet_id=p.id
         WHERE o.provider_id=? ORDER BY o.created_at DESC`, [prov[0].id]);
    } else {
      [rows] = await pool.query(
        `SELECT o.*, pr.shop_name, pr.price_per_day, p.name as pet_name
         FROM orders o JOIN providers pr ON o.provider_id=pr.id JOIN pets p ON o.pet_id=p.id
         WHERE o.user_id=? ORDER BY o.created_at DESC`, [req.user.userId]);
    }
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT o.*, u.nickname as user_nickname, pr.shop_name, pr.address, pr.price_per_day,
              p.name as pet_name, p.species as pet_species, p.breed as pet_breed
       FROM orders o JOIN users u ON o.user_id=u.id JOIN providers pr ON o.provider_id=pr.id JOIN pets p ON o.pet_id=p.id
       WHERE o.id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ code: 404, message: 'Order not found', data: null });
    const order = rows[0];
    const isOwner = order.user_id === req.user.userId;
    const [prov] = await pool.query('SELECT id FROM providers WHERE user_id=?', [req.user.userId]);
    const isProvider = prov.length && prov[0].id === order.provider_id;
    if (!isOwner && !isProvider) return res.status(403).json({ code: 403, message: 'Forbidden', data: null });
    res.json({ code: 200, message: 'ok', data: order });
  } catch (err) { next(err); }
});

router.put('/:id/status', auth, async (req, res, next) => {
  try {
    const { status } = req.body;
    const [rows] = await pool.query(
      'SELECT o.*, pr.user_id as provider_user_id FROM orders o JOIN providers pr ON o.provider_id=pr.id WHERE o.id=?',
      [req.params.id]);
    if (!rows.length) return res.status(404).json({ code: 404, message: 'Order not found', data: null });
    const order = rows[0];
    const isOwner = order.user_id === req.user.userId;
    const isProvider = order.provider_user_id === req.user.userId;
    if (!isOwner && !isProvider) return res.status(403).json({ code: 403, message: 'Forbidden', data: null });
    const actorRole = isProvider ? 'provider' : 'user';
    const allowed = VALID_TRANSITIONS[order.status]?.[actorRole] || [];
    if (!allowed.includes(status))
      return res.status(400).json({ code: 400, message: `Cannot transition from ${order.status} to ${status}`, data: null });
    await pool.query('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
