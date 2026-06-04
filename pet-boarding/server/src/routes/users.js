const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

router.get('/me', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, nickname, avatar_url, phone, role, created_at FROM users WHERE id = ?', [req.user.userId]);
    if (!rows.length) return res.status(404).json({ code: 404, message: 'User not found', data: null });
    res.json({ code: 200, message: 'ok', data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/me', auth, async (req, res, next) => {
  try {
    const { nickname, avatarUrl, phone } = req.body;
    await pool.query('UPDATE users SET nickname=?, avatar_url=?, phone=? WHERE id=?',
      [nickname, avatarUrl, phone, req.user.userId]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

router.put('/me/role', auth, async (req, res, next) => {
  try {
    await pool.query("UPDATE users SET role='provider' WHERE id=?", [req.user.userId]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
