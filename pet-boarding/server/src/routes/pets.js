const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

router.get('/', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM pets WHERE user_id = ?', [req.user.userId]);
    res.json({ code: 200, message: 'ok', data: rows });
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { name, species, breed, age, weight, notes } = req.body;
    if (!name || !species) return res.status(400).json({ code: 400, message: 'name and species required', data: null });
    const [result] = await pool.query(
      'INSERT INTO pets (user_id, name, species, breed, age, weight, notes) VALUES (?,?,?,?,?,?,?)',
      [req.user.userId, name, species, breed, age, weight, notes]
    );
    res.json({ code: 200, message: 'ok', data: { id: result.insertId } });
  } catch (err) { next(err); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const { name, species, breed, age, weight, notes } = req.body;
    const [check] = await pool.query('SELECT id FROM pets WHERE id=? AND user_id=?', [req.params.id, req.user.userId]);
    if (!check.length) return res.status(404).json({ code: 404, message: 'Pet not found', data: null });
    await pool.query('UPDATE pets SET name=?,species=?,breed=?,age=?,weight=?,notes=? WHERE id=?',
      [name, species, breed, age, weight, notes, req.params.id]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const [check] = await pool.query('SELECT id FROM pets WHERE id=? AND user_id=?', [req.params.id, req.user.userId]);
    if (!check.length) return res.status(404).json({ code: 404, message: 'Pet not found', data: null });
    await pool.query('DELETE FROM pets WHERE id=?', [req.params.id]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
