const express = require('express');
const router = express.Router();
const https = require('https');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

function wxCode2Session(code) {
  return new Promise((resolve, reject) => {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WECHAT_APPID}&secret=${process.env.WECHAT_SECRET}&js_code=${code}&grant_type=authorization_code`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

router.post('/login', async (req, res, next) => {
  try {
    const { code, nickname, avatarUrl } = req.body;
    if (!code) return res.status(400).json({ code: 400, message: 'code is required', data: null });

    const wxRes = await wxCode2Session(code);
    if (wxRes.errcode) return res.status(400).json({ code: 400, message: wxRes.errmsg, data: null });

    const { openid } = wxRes;
    const [rows] = await pool.query('SELECT * FROM users WHERE openid = ?', [openid]);
    let user;
    if (rows.length === 0) {
      const [result] = await pool.query(
        'INSERT INTO users (openid, nickname, avatar_url) VALUES (?, ?, ?)',
        [openid, nickname || '宠物主人', avatarUrl || '']
      );
      const [newRows] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = newRows[0];
    } else {
      user = rows[0];
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ code: 200, message: 'ok', data: { token, user: { id: user.id, nickname: user.nickname, avatarUrl: user.avatar_url, role: user.role } } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
