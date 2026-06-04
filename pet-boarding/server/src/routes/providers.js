const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

router.get('/', async (req, res, next) => {
  try {
    const { species, minPrice, maxPrice, minRating } = req.query;
    let sql = 'SELECT p.*, u.nickname, u.avatar_url FROM providers p JOIN users u ON p.user_id = u.id WHERE p.is_available = TRUE';
    const params = [];
    if (minPrice) { sql += ' AND p.price_per_day >= ?'; params.push(minPrice); }
    if (maxPrice) { sql += ' AND p.price_per_day <= ?'; params.push(maxPrice); }
    if (minRating) { sql += ' AND p.avg_rating >= ?'; params.push(minRating); }
    sql += ' ORDER BY p.avg_rating DESC';
    let [rows] = await pool.query(sql, params);
    if (species) {
      rows = rows.filter(r => {
        const list = typeof r.accepted_species === 'string' ? JSON.parse(r.accepted_species) : (r.accepted_species || []);
        return list.includes(species);
      });
    }
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT p.*, u.nickname, u.avatar_url FROM providers p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ code: 404, message: 'Provider not found', data: null });
    res.json({ code: 200, message: 'ok', data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { shopName, description, address, pricePerDay, acceptedSpecies, images } = req.body;
    if (!shopName || pricePerDay == null) return res.status(400).json({ code: 400, message: 'shopName and pricePerDay required', data: null });
    const [result] = await pool.query(
      'INSERT INTO providers (user_id, shop_name, description, address, price_per_day, accepted_species, images) VALUES (?,?,?,?,?,?,?)',
      [req.user.userId, shopName, description, address, pricePerDay,
        JSON.stringify(acceptedSpecies || []), JSON.stringify(images || [])]
    );
    res.json({ code: 200, message: 'ok', data: { id: result.insertId } });
  } catch (err) { next(err); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const [check] = await pool.query('SELECT id FROM providers WHERE id=? AND user_id=?', [req.params.id, req.user.userId]);
    if (!check.length) return res.status(403).json({ code: 403, message: 'Forbidden', data: null });
    const { shopName, description, address, pricePerDay, acceptedSpecies, images, isAvailable } = req.body;
    await pool.query(
      'UPDATE providers SET shop_name=?,description=?,address=?,price_per_day=?,accepted_species=?,images=?,is_available=? WHERE id=?',
      [shopName, description, address, pricePerDay,
        JSON.stringify(acceptedSpecies || []), JSON.stringify(images || []), isAvailable, req.params.id]
    );
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
