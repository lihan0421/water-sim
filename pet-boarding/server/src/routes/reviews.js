const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

router.post('/', auth, async (req, res, next) => {
  try {
    const { orderId, rating, content, images } = req.body;
    if (!orderId || !rating) return res.status(400).json({ code: 400, message: 'orderId and rating required', data: null });
    const [orders] = await pool.query(
      "SELECT * FROM orders WHERE id=? AND user_id=? AND status='completed'",
      [orderId, req.user.userId]);
    if (!orders.length) return res.status(403).json({ code: 403, message: 'Order not found or not completed', data: null });
    const order = orders[0];
    const [result] = await pool.query(
      'INSERT INTO reviews (order_id, user_id, provider_id, rating, content) VALUES (?,?,?,?,?)',
      [orderId, req.user.userId, order.provider_id, rating, content]
    );
    const reviewId = result.insertId;
    if (images && images.length) {
      const imgValues = images.map((url, i) => [reviewId, url, i]);
      await pool.query('INSERT INTO review_images (review_id, image_url, sort_order) VALUES ?', [imgValues]);
    }
    const [avgRows] = await pool.query('SELECT AVG(rating) as avg FROM reviews WHERE provider_id=?', [order.provider_id]);
    await pool.query('UPDATE providers SET avg_rating=? WHERE id=?', [avgRows[0].avg, order.provider_id]);
    res.json({ code: 200, message: 'ok', data: { id: reviewId } });
  } catch (err) { next(err); }
});

router.get('/provider/:id', async (req, res, next) => {
  try {
    const [reviews] = await pool.query(
      `SELECT r.*, u.nickname, u.avatar_url FROM reviews r JOIN users u ON r.user_id=u.id
       WHERE r.provider_id=? ORDER BY r.created_at DESC`, [req.params.id]);
    for (const review of reviews) {
      const [imgs] = await pool.query(
        'SELECT image_url FROM review_images WHERE review_id=? ORDER BY sort_order', [review.id]);
      review.images = imgs.map(i => i.image_url);
    }
    res.json({ code: 200, message: 'ok', data: reviews });
  } catch (err) { next(err); }
});

router.put('/:id/reply', auth, async (req, res, next) => {
  try {
    const { reply } = req.body;
    const [prov] = await pool.query('SELECT id FROM providers WHERE user_id=?', [req.user.userId]);
    if (!prov.length) return res.status(403).json({ code: 403, message: 'Forbidden', data: null });
    const [check] = await pool.query('SELECT id FROM reviews WHERE id=? AND provider_id=?', [req.params.id, prov[0].id]);
    if (!check.length) return res.status(404).json({ code: 404, message: 'Review not found', data: null });
    await pool.query('UPDATE reviews SET reply=? WHERE id=?', [reply, req.params.id]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
