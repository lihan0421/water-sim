# Pet Boarding Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WeChat Mini Program pet boarding reservation platform with Node.js backend, MySQL database, WeChat login, and image+text reviews.

**Architecture:** Single WeChat Mini Program (role-based UI for owners vs providers) talks to a modular Express backend (auth/users/pets/providers/orders/reviews/upload modules). MySQL stores all data. JWT for auth, Multer for image uploads.

**Tech Stack:** Node.js 18+, Express 4, mysql2, jsonwebtoken, multer, cors, dotenv; WeChat Mini Program native; MySQL 8; Jest + Supertest for backend tests.

---

## File Map

### Server (`D:\code\SJTU\pet-boarding\server\`)
```
package.json
.env
src/
  app.js                    # Express entry, mounts all routers
  config/db.js              # mysql2 connection pool
  middleware/auth.js        # JWT verify middleware
  routes/auth.js            # POST /api/auth/login
  routes/users.js           # GET/PUT /api/users/me, PUT /api/users/me/role
  routes/pets.js            # CRUD /api/pets
  routes/providers.js       # GET /api/providers, CRUD /api/providers/:id
  routes/orders.js          # CRUD /api/orders, PUT /api/orders/:id/status
  routes/reviews.js         # POST /api/reviews, GET /api/reviews/provider/:id, PUT reply
  routes/upload.js          # POST /api/upload
uploads/                    # static image files (gitignored)
db/schema.sql               # full DDL
tests/
  auth.test.js
  providers.test.js
  orders.test.js
  reviews.test.js
```

### Miniprogram (`D:\code\SJTU\pet-boarding\miniprogram\`)
```
project.config.json
app.js / app.json / app.wxss
utils/request.js            # wx.request wrapper with JWT header
utils/auth.js               # login helper
pages/
  login/                    # WeChat auth page
  index/                    # home, search providers
  provider-list/            # filtered provider list
  provider-detail/          # provider info + reviews + book button
  order-create/             # pick pet, dates, confirm price
  order-list/               # owner's orders by status tab
  order-detail/             # order timeline + cancel/review entry
  review-create/            # stars + text + up to 6 photos
  profile/                  # user info + role switch
  pet-list/                 # owner's pets
  pet-edit/                 # add/edit pet form
  shop-edit/                # provider: edit shop
  provider-orders/          # provider: manage orders
  provider-reviews/         # provider: view + reply reviews
```

---

## Task 1: Server scaffold + DB schema

**Files:**
- Create: `server/package.json`
- Create: `server/.env`
- Create: `server/db/schema.sql`
- Create: `server/src/config/db.js`
- Create: `server/src/app.js`

- [ ] **Step 1: Init server project**

```bash
cd D:\code\SJTU\pet-boarding
mkdir server && cd server
npm init -y
npm install express mysql2 jsonwebtoken multer cors dotenv
npm install --save-dev jest supertest
```

- [ ] **Step 2: Create `.env`**

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pet_boarding
JWT_SECRET=change_this_secret_in_production
PORT=3000
WECHAT_APPID=your_appid
WECHAT_SECRET=your_secret
BASE_URL=http://localhost:3000
```

- [ ] **Step 3: Create `db/schema.sql`**

```sql
CREATE DATABASE IF NOT EXISTS pet_boarding DEFAULT CHARSET utf8mb4;
USE pet_boarding;

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(64) NOT NULL UNIQUE,
  nickname VARCHAR(64),
  avatar_url VARCHAR(255),
  phone VARCHAR(20),
  role ENUM('user','provider') NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT NOW()
);

CREATE TABLE pets (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(32) NOT NULL,
  species ENUM('dog','cat','other') NOT NULL,
  breed VARCHAR(64),
  age INT,
  weight FLOAT,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE providers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL UNIQUE,
  shop_name VARCHAR(64) NOT NULL,
  description TEXT,
  address VARCHAR(255),
  price_per_day DECIMAL(8,2) NOT NULL DEFAULT 0,
  accepted_species JSON,
  avg_rating FLOAT NOT NULL DEFAULT 0,
  images JSON,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  provider_id INT NOT NULL,
  pet_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_price DECIMAL(8,2) NOT NULL,
  status ENUM('pending','confirmed','ongoing','completed','cancelled') NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (pet_id) REFERENCES pets(id)
);

CREATE TABLE reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL UNIQUE,
  user_id INT NOT NULL,
  provider_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT,
  reply TEXT,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE TABLE review_images (
  id INT PRIMARY KEY AUTO_INCREMENT,
  review_id INT NOT NULL,
  image_url VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);
```

- [ ] **Step 4: Run schema**

```bash
mysql -u root -p < db/schema.sql
```

Expected: no errors, `pet_boarding` database created with 5 tables.

- [ ] **Step 5: Create `src/config/db.js`**

```js
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
```

- [ ] **Step 6: Create `src/app.js`**

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/pets', require('./routes/pets'));
app.use('/api/providers', require('./routes/providers'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/upload', require('./routes/upload'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ code: err.status || 500, message: err.message || 'Internal server error', data: null });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
```

- [ ] **Step 7: Add scripts to `package.json`**

```json
"scripts": {
  "start": "node src/app.js",
  "dev": "node --watch src/app.js",
  "test": "jest --runInBand"
},
"jest": {
  "testEnvironment": "node"
}
```

- [ ] **Step 8: Create `uploads/` directory and `.gitignore`**

```bash
mkdir uploads
echo "uploads/\n.env\nnode_modules/" > .gitignore
```

- [ ] **Step 9: Commit**

```bash
git -C D:\code\SJTU init
git -C D:\code\SJTU add pet-boarding/server/
git -C D:\code\SJTU commit -m "feat: server scaffold and DB schema"
```

---

## Task 2: JWT auth middleware + login route

**Files:**
- Create: `server/src/middleware/auth.js`
- Create: `server/src/routes/auth.js`
- Create: `server/tests/auth.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/auth.test.js`:

```js
const request = require('supertest');
const app = require('../src/app');

describe('POST /api/auth/login', () => {
  it('returns 400 when code is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npx jest tests/auth.test.js --no-coverage
```

Expected: FAIL — `Cannot find module './routes/auth'`

- [ ] **Step 3: Create `src/middleware/auth.js`**

```js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: 'Unauthorized', data: null });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ code: 401, message: 'Invalid token', data: null });
  }
};
```

- [ ] **Step 4: Create `src/routes/auth.js`**

```js
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
```

- [ ] **Step 5: Run test**

```bash
npx jest tests/auth.test.js --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/server/src/middleware/ pet-boarding/server/src/routes/auth.js pet-boarding/server/tests/auth.test.js
git -C D:\code\SJTU commit -m "feat: JWT middleware and WeChat login route"
```

---

## Task 3: Users and Pets routes

**Files:**
- Create: `server/src/routes/users.js`
- Create: `server/src/routes/pets.js`

- [ ] **Step 1: Create `src/routes/users.js`**

```js
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
```

- [ ] **Step 2: Create `src/routes/pets.js`**

```js
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
```

- [ ] **Step 3: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/server/src/routes/users.js pet-boarding/server/src/routes/pets.js
git -C D:\code\SJTU commit -m "feat: users and pets routes"
```

---

## Task 4: Providers route

**Files:**
- Create: `server/src/routes/providers.js`

- [ ] **Step 1: Create `src/routes/providers.js`**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/server/src/routes/providers.js
git -C D:\code\SJTU commit -m "feat: providers route"
```

---

## Task 5: Orders route

**Files:**
- Create: `server/src/routes/orders.js`

- [ ] **Step 1: Create `src/routes/orders.js`**

```js
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
    const [rows] = await pool.query('SELECT o.*, pr.user_id as provider_user_id FROM orders o JOIN providers pr ON o.provider_id=pr.id WHERE o.id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ code: 404, message: 'Order not found', data: null });
    const order = rows[0];
    const isOwner = order.user_id === req.user.userId;
    const isProvider = order.provider_user_id === req.user.userId;
    if (!isOwner && !isProvider) return res.status(403).json({ code: 403, message: 'Forbidden', data: null });
    const actorRole = isProvider ? 'provider' : 'user';
    const allowed = VALID_TRANSITIONS[order.status]?.[actorRole] || [];
    if (!allowed.includes(status)) return res.status(400).json({ code: 400, message: `Cannot transition from ${order.status} to ${status}`, data: null });
    await pool.query('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ code: 200, message: 'ok', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/server/src/routes/orders.js
git -C D:\code\SJTU commit -m "feat: orders route with status transitions"
```

---

## Task 6: Reviews + Upload routes

**Files:**
- Create: `server/src/routes/reviews.js`
- Create: `server/src/routes/upload.js`

- [ ] **Step 1: Create `src/routes/reviews.js`**

```js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

router.post('/', auth, async (req, res, next) => {
  try {
    const { orderId, rating, content, images } = req.body;
    if (!orderId || !rating) return res.status(400).json({ code: 400, message: 'orderId and rating required', data: null });
    const [orders] = await pool.query('SELECT * FROM orders WHERE id=? AND user_id=? AND status=?', [orderId, req.user.userId, 'completed']);
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
      const [imgs] = await pool.query('SELECT image_url FROM review_images WHERE review_id=? ORDER BY sort_order', [review.id]);
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
```

- [ ] **Step 2: Create `src/routes/upload.js`**

```js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ code: 400, message: 'No file uploaded', data: null });
  const url = `${process.env.BASE_URL}/uploads/${req.file.filename}`;
  res.json({ code: 200, message: 'ok', data: { url } });
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/server/src/routes/reviews.js pet-boarding/server/src/routes/upload.js
git -C D:\code\SJTU commit -m "feat: reviews and upload routes"
```

---

## Task 7: Miniprogram scaffold + utils

**Files:**
- Create: `miniprogram/project.config.json`
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/utils/request.js`
- Create: `miniprogram/utils/auth.js`

- [ ] **Step 1: Create `miniprogram/project.config.json`**

```json
{
  "appid": "your_appid_here",
  "compileType": "miniprogram",
  "libVersion": "3.3.4",
  "setting": {
    "urlCheck": false,
    "es6": true,
    "enhance": true,
    "postcss": true,
    "minified": true
  },
  "projectname": "pet-boarding"
}
```

- [ ] **Step 2: Create `miniprogram/app.json`**

```json
{
  "pages": [
    "pages/login/index",
    "pages/index/index",
    "pages/provider-list/index",
    "pages/provider-detail/index",
    "pages/order-create/index",
    "pages/order-list/index",
    "pages/order-detail/index",
    "pages/review-create/index",
    "pages/profile/index",
    "pages/pet-list/index",
    "pages/pet-edit/index",
    "pages/shop-edit/index",
    "pages/provider-orders/index",
    "pages/provider-reviews/index"
  ],
  "tabBar": {
    "color": "#999",
    "selectedColor": "#FF6B35",
    "list": [
      { "pagePath": "pages/index/index", "text": "首页", "iconPath": "assets/home.png", "selectedIconPath": "assets/home-active.png" },
      { "pagePath": "pages/order-list/index", "text": "订单", "iconPath": "assets/order.png", "selectedIconPath": "assets/order-active.png" },
      { "pagePath": "pages/profile/index", "text": "我的", "iconPath": "assets/profile.png", "selectedIconPath": "assets/profile-active.png" }
    ]
  },
  "window": {
    "backgroundTextStyle": "light",
    "navigationBarBackgroundColor": "#FF6B35",
    "navigationBarTitleText": "宠物寄养",
    "navigationBarTextStyle": "white"
  }
}
```

- [ ] **Step 3: Create `miniprogram/app.js`**

```js
App({
  globalData: { userInfo: null, token: null },
  onLaunch() {
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    if (token) { this.globalData.token = token; this.globalData.userInfo = userInfo; }
  },
  isLoggedIn() { return !!this.globalData.token; },
  logout() {
    this.globalData.token = null;
    this.globalData.userInfo = null;
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
  }
});
```

- [ ] **Step 4: Create `miniprogram/app.wxss`**

```css
page { background: #f5f5f5; font-family: -apple-system, sans-serif; }
.btn-primary { background: #FF6B35; color: #fff; border-radius: 8rpx; border: none; }
.btn-outline { background: transparent; color: #FF6B35; border: 1rpx solid #FF6B35; border-radius: 8rpx; }
.card { background: #fff; border-radius: 12rpx; padding: 24rpx; margin: 16rpx; box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.06); }
.tag { display: inline-block; padding: 4rpx 12rpx; border-radius: 20rpx; font-size: 22rpx; }
.tag-pending { background: #fff7e6; color: #fa8c16; }
.tag-confirmed { background: #e6f7ff; color: #1890ff; }
.tag-ongoing { background: #f6ffed; color: #52c41a; }
.tag-completed { background: #f9f0ff; color: #722ed1; }
.tag-cancelled { background: #fff1f0; color: #f5222d; }
```

- [ ] **Step 5: Create `miniprogram/utils/request.js`**

```js
const BASE_URL = 'http://localhost:3000';

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    wx.request({
      url: BASE_URL + path,
      method,
      data,
      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.token || ''}` },
      success(res) {
        if (res.data.code === 401) {
          wx.reLaunch({ url: '/pages/login/index' });
          return reject(new Error('Unauthorized'));
        }
        resolve(res.data);
      },
      fail: reject,
    });
  });
}

module.exports = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data),
  put: (path, data) => request('PUT', path, data),
  del: (path) => request('DELETE', path),
};
```

- [ ] **Step 6: Create `miniprogram/utils/auth.js`**

```js
const api = require('./request');

function login() {
  return new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc: '用于完善个人信息',
      success(profileRes) {
        wx.login({
          success(loginRes) {
            api.post('/api/auth/login', {
              code: loginRes.code,
              nickname: profileRes.userInfo.nickName,
              avatarUrl: profileRes.userInfo.avatarUrl,
            }).then(res => {
              const app = getApp();
              app.globalData.token = res.data.token;
              app.globalData.userInfo = res.data.user;
              wx.setStorageSync('token', res.data.token);
              wx.setStorageSync('userInfo', res.data.user);
              resolve(res.data.user);
            }).catch(reject);
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}

module.exports = { login };
```

- [ ] **Step 7: Create placeholder assets directory**

```bash
mkdir -p miniprogram/assets
```

Create simple 81x81 PNG placeholders for tabbar icons (or download any free icons). The tabbar won't render without these files.

- [ ] **Step 8: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/
git -C D:\code\SJTU commit -m "feat: miniprogram scaffold and utils"
```

---

## Task 8: Login page

**Files:**
- Create: `miniprogram/pages/login/index.js`
- Create: `miniprogram/pages/login/index.wxml`
- Create: `miniprogram/pages/login/index.wxss`
- Create: `miniprogram/pages/login/index.json`

- [ ] **Step 1: Create `pages/login/index.json`**

```json
{ "navigationBarTitleText": "登录" }
```

- [ ] **Step 2: Create `pages/login/index.wxml`**

```xml
<view class="container">
  <image class="logo" src="/assets/logo.png" mode="aspectFit" />
  <text class="title">宠物寄养平台</text>
  <text class="subtitle">安心托付，放心出行</text>
  <button class="btn-login btn-primary" bindtap="onLogin" loading="{{loading}}">微信一键登录</button>
</view>
```

- [ ] **Step 3: Create `pages/login/index.wxss`**

```css
.container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 0 60rpx; }
.logo { width: 200rpx; height: 200rpx; margin-bottom: 40rpx; }
.title { font-size: 48rpx; font-weight: bold; color: #333; }
.subtitle { font-size: 28rpx; color: #999; margin: 16rpx 0 80rpx; }
.btn-login { width: 100%; height: 96rpx; line-height: 96rpx; font-size: 32rpx; }
```

- [ ] **Step 4: Create `pages/login/index.js`**

```js
const { login } = require('../../utils/auth');
Page({
  data: { loading: false },
  async onLogin() {
    this.setData({ loading: true });
    try {
      await login();
      wx.switchTab({ url: '/pages/index/index' });
    } catch (e) {
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
```

- [ ] **Step 5: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/login/
git -C D:\code\SJTU commit -m "feat: login page"
```

---

## Task 9: Index page (home + search)

**Files:**
- Create: `miniprogram/pages/index/index.*` (4 files)

- [ ] **Step 1: Create `pages/index/index.json`**

```json
{ "navigationBarTitleText": "宠物寄养" }
```

- [ ] **Step 2: Create `pages/index/index.wxml`**

```xml
<view class="search-bar">
  <input class="search-input" placeholder="搜索寄养服务商" value="{{keyword}}" bindinput="onKeywordInput" bindconfirm="onSearch" />
  <view class="filter-row">
    <picker class="filter-pick" range="{{speciesOptions}}" bindchange="onSpeciesChange">
      <view class="filter-btn">{{speciesOptions[speciesIndex]}} ▾</view>
    </picker>
    <view class="filter-btn" bindtap="onSearch">搜索</view>
  </view>
</view>
<view wx:if="{{loading}}" class="loading">加载中...</view>
<view wx:else>
  <view wx:for="{{providers}}" wx:key="id" class="card provider-card" bindtap="goDetail" data-id="{{item.id}}">
    <image class="shop-img" src="{{item.images && item.images[0] || '/assets/default-shop.png'}}" mode="aspectFill" />
    <view class="info">
      <text class="shop-name">{{item.shop_name}}</text>
      <text class="address">{{item.address}}</text>
      <view class="row">
        <text class="price">¥{{item.price_per_day}}/天</text>
        <text class="rating">★ {{item.avg_rating > 0 ? item.avg_rating.toFixed(1) : '暂无评分'}}</text>
      </view>
    </view>
  </view>
  <view wx:if="{{providers.length === 0}}" class="empty">暂无服务商</view>
</view>
```

- [ ] **Step 3: Create `pages/index/index.wxss`**

```css
.search-bar { background: #FF6B35; padding: 20rpx 24rpx; }
.search-input { background: #fff; border-radius: 40rpx; padding: 12rpx 24rpx; font-size: 28rpx; margin-bottom: 16rpx; }
.filter-row { display: flex; gap: 16rpx; }
.filter-btn { background: rgba(255,255,255,0.2); color: #fff; padding: 8rpx 20rpx; border-radius: 30rpx; font-size: 26rpx; }
.provider-card { display: flex; gap: 20rpx; align-items: flex-start; }
.shop-img { width: 160rpx; height: 160rpx; border-radius: 8rpx; flex-shrink: 0; }
.info { flex: 1; }
.shop-name { font-size: 32rpx; font-weight: bold; color: #333; display: block; }
.address { font-size: 26rpx; color: #999; display: block; margin: 6rpx 0; }
.row { display: flex; justify-content: space-between; margin-top: 8rpx; }
.price { color: #FF6B35; font-size: 28rpx; font-weight: bold; }
.rating { color: #faad14; font-size: 26rpx; }
.loading, .empty { text-align: center; color: #999; padding: 80rpx; }
```

- [ ] **Step 4: Create `pages/index/index.js`**

```js
const api = require('../../utils/request');
Page({
  data: { providers: [], loading: false, keyword: '', speciesOptions: ['全部', '狗', '猫', '其他'], speciesIndex: 0 },
  onLoad() { this.loadProviders(); },
  onShow() {
    const app = getApp();
    if (!app.isLoggedIn()) wx.reLaunch({ url: '/pages/login/index' });
  },
  onSpeciesChange(e) { this.setData({ speciesIndex: e.detail.value }); },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  async onSearch() { this.loadProviders(); },
  async loadProviders() {
    this.setData({ loading: true });
    try {
      const speciesMap = { 1: 'dog', 2: 'cat', 3: 'other' };
      const species = speciesMap[this.data.speciesIndex] || '';
      const query = species ? `?species=${species}` : '';
      const res = await api.get(`/api/providers${query}`);
      let list = res.data || [];
      if (this.data.keyword) {
        list = list.filter(p => p.shop_name.includes(this.data.keyword));
      }
      this.setData({ providers: list });
    } finally { this.setData({ loading: false }); }
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/provider-detail/index?id=${e.currentTarget.dataset.id}` }); }
});
```

- [ ] **Step 5: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/index/
git -C D:\code\SJTU commit -m "feat: index/home page"
```

---

## Task 10: Provider detail page

**Files:**
- Create: `miniprogram/pages/provider-detail/index.*` (4 files)

- [ ] **Step 1: Create `pages/provider-detail/index.json`**

```json
{ "navigationBarTitleText": "服务商详情" }
```

- [ ] **Step 2: Create `pages/provider-detail/index.wxml`**

```xml
<view wx:if="{{provider}}">
  <swiper class="banner" indicator-dots autoplay>
    <swiper-item wx:for="{{provider.images || []}}" wx:key="*this">
      <image src="{{item}}" mode="aspectFill" class="banner-img" />
    </swiper-item>
    <swiper-item wx:if="{{!provider.images || provider.images.length === 0}}">
      <image src="/assets/default-shop.png" mode="aspectFill" class="banner-img" />
    </swiper-item>
  </swiper>
  <view class="card">
    <text class="shop-name">{{provider.shop_name}}</text>
    <view class="row"><text class="price">¥{{provider.price_per_day}}/天</text><text class="rating">★ {{provider.avg_rating > 0 ? provider.avg_rating.toFixed(1) : '暂无评分'}}</text></view>
    <text class="addr">📍 {{provider.address}}</text>
    <text class="desc">{{provider.description}}</text>
  </view>
  <view class="card">
    <text class="section-title">评价 ({{reviews.length}})</text>
    <view wx:for="{{reviews}}" wx:key="id" class="review-item">
      <view class="review-header">
        <image src="{{item.avatar_url || '/assets/default-avatar.png'}}" class="avatar" />
        <text class="nickname">{{item.nickname}}</text>
        <text class="stars">{'★'.repeat(item.rating)}</text>
      </view>
      <text class="review-content">{{item.content}}</text>
      <scroll-view scroll-x class="img-row">
        <image wx:for="{{item.images}}" wx:for-item="img" wx:key="*this" src="{{img}}" class="review-img" mode="aspectFill" bindtap="previewImg" data-src="{{img}}" data-list="{{item.images}}" />
      </scroll-view>
      <view wx:if="{{item.reply}}" class="reply">店家回复：{{item.reply}}</view>
    </view>
    <view wx:if="{{reviews.length === 0}}" class="empty">暂无评价</view>
  </view>
  <view class="bottom-bar">
    <button class="btn-primary book-btn" bindtap="goBook">立即预约</button>
  </view>
</view>
```

- [ ] **Step 3: Create `pages/provider-detail/index.wxss`**

```css
.banner { height: 400rpx; }
.banner-img { width: 100%; height: 400rpx; }
.shop-name { font-size: 36rpx; font-weight: bold; display: block; margin-bottom: 12rpx; }
.row { display: flex; justify-content: space-between; margin-bottom: 8rpx; }
.price { color: #FF6B35; font-size: 32rpx; font-weight: bold; }
.rating { color: #faad14; }
.addr { color: #999; font-size: 26rpx; display: block; margin: 8rpx 0; }
.desc { color: #555; font-size: 28rpx; display: block; margin-top: 8rpx; }
.section-title { font-size: 30rpx; font-weight: bold; display: block; margin-bottom: 20rpx; }
.review-item { border-bottom: 1rpx solid #f0f0f0; padding: 16rpx 0; }
.review-header { display: flex; align-items: center; gap: 12rpx; margin-bottom: 8rpx; }
.avatar { width: 60rpx; height: 60rpx; border-radius: 50%; }
.nickname { font-size: 26rpx; color: #333; flex: 1; }
.stars { color: #faad14; }
.review-content { font-size: 28rpx; color: #555; }
.img-row { white-space: nowrap; margin-top: 8rpx; }
.review-img { width: 160rpx; height: 160rpx; margin-right: 8rpx; border-radius: 6rpx; display: inline-block; }
.reply { background: #f9f9f9; padding: 8rpx 16rpx; border-radius: 6rpx; color: #888; font-size: 26rpx; margin-top: 8rpx; }
.empty { text-align: center; color: #ccc; padding: 40rpx; }
.bottom-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; padding: 20rpx 40rpx; box-shadow: 0 -2rpx 8rpx rgba(0,0,0,0.08); }
.book-btn { width: 100%; height: 88rpx; line-height: 88rpx; font-size: 32rpx; }
```

- [ ] **Step 4: Create `pages/provider-detail/index.js`**

```js
const api = require('../../utils/request');
Page({
  data: { provider: null, reviews: [] },
  onLoad(options) {
    this.providerId = options.id;
    this.loadData();
  },
  async loadData() {
    const [p, r] = await Promise.all([
      api.get(`/api/providers/${this.providerId}`),
      api.get(`/api/reviews/provider/${this.providerId}`),
    ]);
    this.setData({ provider: p.data, reviews: r.data || [] });
  },
  goBook() {
    wx.navigateTo({ url: `/pages/order-create/index?providerId=${this.providerId}&pricePerDay=${this.data.provider.price_per_day}` });
  },
  previewImg(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: e.currentTarget.dataset.list });
  }
});
```

- [ ] **Step 5: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/provider-detail/
git -C D:\code\SJTU commit -m "feat: provider detail page"
```

---

## Task 11: Order create page

**Files:**
- Create: `miniprogram/pages/order-create/index.*` (4 files)

- [ ] **Step 1: Create `pages/order-create/index.json`**

```json
{ "navigationBarTitleText": "创建预约" }
```

- [ ] **Step 2: Create `pages/order-create/index.wxml`**

```xml
<view class="form card">
  <view class="field">
    <text class="label">选择宠物</text>
    <picker range="{{petNames}}" bindchange="onPetChange">
      <view class="picker-val">{{petNames[petIndex] || '请选择宠物'}}</view>
    </picker>
  </view>
  <view class="field">
    <text class="label">入住日期</text>
    <picker mode="date" bindchange="onStartChange" value="{{startDate}}">
      <view class="picker-val">{{startDate || '请选择'}}</view>
    </picker>
  </view>
  <view class="field">
    <text class="label">离开日期</text>
    <picker mode="date" bindchange="onEndChange" value="{{endDate}}">
      <view class="picker-val">{{endDate || '请选择'}}</view>
    </picker>
  </view>
  <view class="field" wx:if="{{days > 0}}">
    <text class="label">费用预估</text>
    <text class="price-val">¥{{totalPrice}}（{{days}}天 × ¥{{pricePerDay}}/天）</text>
  </view>
  <view class="field">
    <text class="label">备注</text>
    <textarea class="textarea" placeholder="特殊需求、注意事项等" value="{{note}}" bindinput="onNoteInput" />
  </view>
  <button class="btn-primary submit-btn" bindtap="onSubmit" loading="{{loading}}">确认预约</button>
</view>
```

- [ ] **Step 3: Create `pages/order-create/index.wxss`**

```css
.form { margin: 24rpx; }
.field { margin-bottom: 32rpx; }
.label { font-size: 28rpx; color: #666; display: block; margin-bottom: 12rpx; }
.picker-val { background: #f5f5f5; padding: 20rpx 24rpx; border-radius: 8rpx; font-size: 28rpx; color: #333; }
.price-val { color: #FF6B35; font-size: 30rpx; font-weight: bold; }
.textarea { background: #f5f5f5; padding: 20rpx; border-radius: 8rpx; width: 100%; min-height: 120rpx; font-size: 28rpx; box-sizing: border-box; }
.submit-btn { width: 100%; height: 96rpx; line-height: 96rpx; font-size: 32rpx; margin-top: 16rpx; }
```

- [ ] **Step 4: Create `pages/order-create/index.js`**

```js
const api = require('../../utils/request');
Page({
  data: { pets: [], petNames: [], petIndex: 0, startDate: '', endDate: '', days: 0, pricePerDay: 0, totalPrice: 0, note: '', loading: false },
  onLoad(options) {
    this.providerId = options.providerId;
    this.setData({ pricePerDay: parseFloat(options.pricePerDay) });
    this.loadPets();
  },
  async loadPets() {
    const res = await api.get('/api/pets');
    const pets = res.data || [];
    this.setData({ pets, petNames: pets.map(p => `${p.name}(${p.species})`) });
  },
  onPetChange(e) { this.setData({ petIndex: parseInt(e.detail.value) }); },
  onStartChange(e) { this.setData({ startDate: e.detail.value }); this.calcPrice(); },
  onEndChange(e) { this.setData({ endDate: e.detail.value }); this.calcPrice(); },
  calcPrice() {
    const { startDate, endDate, pricePerDay } = this.data;
    if (!startDate || !endDate) return;
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000);
    if (days > 0) this.setData({ days, totalPrice: (days * pricePerDay).toFixed(2) });
  },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },
  async onSubmit() {
    const { pets, petIndex, startDate, endDate, note, days } = this.data;
    if (!pets.length) return wx.showToast({ title: '请先添加宠物', icon: 'none' });
    if (!startDate || !endDate) return wx.showToast({ title: '请选择日期', icon: 'none' });
    if (days <= 0) return wx.showToast({ title: '结束日期需晚于开始日期', icon: 'none' });
    this.setData({ loading: true });
    try {
      const res = await api.post('/api/orders', { providerId: parseInt(this.providerId), petId: pets[petIndex].id, startDate, endDate, note });
      wx.showToast({ title: '预约成功！' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (e) {
      wx.showToast({ title: '预约失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  }
});
```

- [ ] **Step 5: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/order-create/
git -C D:\code\SJTU commit -m "feat: order create page"
```

---

## Task 12: Order list + detail pages

**Files:**
- Create: `miniprogram/pages/order-list/index.*`
- Create: `miniprogram/pages/order-detail/index.*`

- [ ] **Step 1: Create `pages/order-list/index.json`**

```json
{ "navigationBarTitleText": "我的订单" }
```

- [ ] **Step 2: Create `pages/order-list/index.wxml`**

```xml
<view class="tabs">
  <view wx:for="{{tabs}}" wx:key="*this" class="tab {{activeTab === index ? 'active' : ''}}" bindtap="switchTab" data-idx="{{index}}">{{item}}</view>
</view>
<view wx:for="{{filtered}}" wx:key="id" class="card order-card" bindtap="goDetail" data-id="{{item.id}}">
  <view class="row"><text class="shop">{{item.shop_name || item.user_nickname}}</text><text class="tag tag-{{item.status}}">{{statusMap[item.status]}}</text></view>
  <text class="pet">🐾 {{item.pet_name}} · {{item.start_date}} ~ {{item.end_date}}</text>
  <text class="price">¥{{item.total_price}}</text>
</view>
<view wx:if="{{filtered.length === 0}}" class="empty">暂无订单</view>
```

- [ ] **Step 3: Create `pages/order-list/index.wxss`**

```css
.tabs { display: flex; background: #fff; border-bottom: 1rpx solid #f0f0f0; }
.tab { flex: 1; text-align: center; padding: 24rpx 0; font-size: 28rpx; color: #666; }
.tab.active { color: #FF6B35; border-bottom: 4rpx solid #FF6B35; }
.order-card { margin: 16rpx; }
.row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8rpx; }
.shop { font-size: 30rpx; font-weight: bold; }
.pet { font-size: 26rpx; color: #666; display: block; margin-bottom: 6rpx; }
.price { color: #FF6B35; font-size: 28rpx; font-weight: bold; }
.empty { text-align: center; color: #ccc; padding: 80rpx; }
```

- [ ] **Step 4: Create `pages/order-list/index.js`**

```js
const api = require('../../utils/request');
const STATUS_MAP = { pending: '待确认', confirmed: '已确认', ongoing: '寄养中', completed: '已完成', cancelled: '已取消' };
Page({
  data: { orders: [], filtered: [], tabs: ['全部','待确认','进行中','已完成','已取消'], activeTab: 0, statusMap: STATUS_MAP },
  async onShow() {
    const res = await api.get('/api/orders');
    this.allOrders = res.data || [];
    this.setData({ orders: this.allOrders });
    this.filter(this.data.activeTab);
  },
  switchTab(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ activeTab: idx });
    this.filter(idx);
  },
  filter(idx) {
    const groups = [null, ['pending'], ['confirmed','ongoing'], ['completed'], ['cancelled']];
    const statuses = groups[idx];
    const filtered = statuses ? this.allOrders.filter(o => statuses.includes(o.status)) : this.allOrders;
    this.setData({ filtered });
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/order-detail/index?id=${e.currentTarget.dataset.id}` }); }
});
```

- [ ] **Step 5: Create `pages/order-detail/index.json`**

```json
{ "navigationBarTitleText": "订单详情" }
```

- [ ] **Step 6: Create `pages/order-detail/index.wxml`**

```xml
<view wx:if="{{order}}" class="container">
  <view class="card">
    <view class="row"><text class="shop">{{order.shop_name}}</text><text class="tag tag-{{order.status}}">{{statusMap[order.status]}}</text></view>
    <view class="info-row"><text class="label">地址</text><text>{{order.address}}</text></view>
    <view class="info-row"><text class="label">宠物</text><text>{{order.pet_name}}（{{order.pet_species}}·{{order.pet_breed}}）</text></view>
    <view class="info-row"><text class="label">日期</text><text>{{order.start_date}} ~ {{order.end_date}}</text></view>
    <view class="info-row"><text class="label">费用</text><text class="price">¥{{order.total_price}}</text></view>
    <view class="info-row" wx:if="{{order.note}}"><text class="label">备注</text><text>{{order.note}}</text></view>
  </view>
  <view class="btn-group">
    <button wx:if="{{order.status==='pending'||order.status==='confirmed'}}" class="btn-outline cancel-btn" bindtap="onCancel">取消预约</button>
    <button wx:if="{{order.status==='completed'&&!order.reviewed}}" class="btn-primary review-btn" bindtap="goReview">写评价</button>
  </view>
</view>
```

- [ ] **Step 7: Create `pages/order-detail/index.wxss`**

```css
.container { padding-bottom: 120rpx; }
.row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12rpx; }
.shop { font-size: 32rpx; font-weight: bold; }
.info-row { display: flex; gap: 16rpx; margin-bottom: 12rpx; font-size: 28rpx; }
.label { color: #999; width: 80rpx; flex-shrink: 0; }
.price { color: #FF6B35; font-weight: bold; }
.btn-group { display: flex; gap: 20rpx; padding: 0 24rpx; }
.cancel-btn, .review-btn { flex: 1; height: 88rpx; line-height: 88rpx; font-size: 30rpx; }
```

- [ ] **Step 8: Create `pages/order-detail/index.js`**

```js
const api = require('../../utils/request');
const STATUS_MAP = { pending: '待确认', confirmed: '已确认', ongoing: '寄养中', completed: '已完成', cancelled: '已取消' };
Page({
  data: { order: null, statusMap: STATUS_MAP },
  onLoad(options) { this.orderId = options.id; this.loadOrder(); },
  async loadOrder() {
    const res = await api.get(`/api/orders/${this.orderId}`);
    this.setData({ order: res.data });
  },
  async onCancel() {
    const { confirm } = await wx.showModal({ title: '确认取消', content: '确定要取消此预约吗？' });
    if (!confirm) return;
    await api.put(`/api/orders/${this.orderId}/status`, { status: 'cancelled' });
    wx.showToast({ title: '已取消' });
    this.loadOrder();
  },
  goReview() { wx.navigateTo({ url: `/pages/review-create/index?orderId=${this.orderId}&providerId=${this.data.order.provider_id}` }); }
});
```

- [ ] **Step 9: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/order-list/ pet-boarding/miniprogram/pages/order-detail/
git -C D:\code\SJTU commit -m "feat: order list and detail pages"
```

---

## Task 13: Review create page

**Files:**
- Create: `miniprogram/pages/review-create/index.*`

- [ ] **Step 1: Create `pages/review-create/index.json`**

```json
{ "navigationBarTitleText": "写评价" }
```

- [ ] **Step 2: Create `pages/review-create/index.wxml`**

```xml
<view class="form card">
  <text class="section-title">评分</text>
  <view class="stars-row">
    <text wx:for="{{[1,2,3,4,5]}}" wx:key="*this" class="star {{rating >= item ? 'active' : ''}}" bindtap="onRate" data-val="{{item}}">★</text>
  </view>
  <text class="section-title">评价内容</text>
  <textarea class="textarea" placeholder="分享你的寄养体验..." value="{{content}}" bindinput="onContentInput" maxlength="500" />
  <text class="section-title">上传图片（最多6张）</text>
  <view class="img-list">
    <view wx:for="{{images}}" wx:key="*this" class="img-wrap">
      <image src="{{item}}" mode="aspectFill" class="preview-img" />
      <text class="del-btn" bindtap="delImg" data-idx="{{index}}">×</text>
    </view>
    <view wx:if="{{images.length < 6}}" class="add-img-btn" bindtap="chooseImg">+</view>
  </view>
  <button class="btn-primary submit-btn" bindtap="onSubmit" loading="{{loading}}">提交评价</button>
</view>
```

- [ ] **Step 3: Create `pages/review-create/index.wxss`**

```css
.form { margin: 24rpx; }
.section-title { font-size: 28rpx; font-weight: bold; color: #333; display: block; margin: 24rpx 0 12rpx; }
.stars-row { display: flex; gap: 16rpx; margin-bottom: 8rpx; }
.star { font-size: 60rpx; color: #ddd; }
.star.active { color: #faad14; }
.textarea { background: #f5f5f5; padding: 20rpx; border-radius: 8rpx; width: 100%; min-height: 160rpx; font-size: 28rpx; box-sizing: border-box; }
.img-list { display: flex; flex-wrap: wrap; gap: 16rpx; margin-bottom: 24rpx; }
.img-wrap { position: relative; width: 180rpx; height: 180rpx; }
.preview-img { width: 180rpx; height: 180rpx; border-radius: 8rpx; }
.del-btn { position: absolute; top: -10rpx; right: -10rpx; background: #f5222d; color: #fff; border-radius: 50%; width: 36rpx; height: 36rpx; text-align: center; line-height: 36rpx; font-size: 28rpx; }
.add-img-btn { width: 180rpx; height: 180rpx; background: #f5f5f5; border-radius: 8rpx; display: flex; align-items: center; justify-content: center; font-size: 80rpx; color: #ccc; }
.submit-btn { width: 100%; height: 96rpx; line-height: 96rpx; font-size: 32rpx; }
```

- [ ] **Step 4: Create `pages/review-create/index.js`**

```js
const api = require('../../utils/request');
Page({
  data: { rating: 5, content: '', images: [], loading: false },
  onLoad(options) { this.orderId = options.orderId; },
  onRate(e) { this.setData({ rating: e.currentTarget.dataset.val }); },
  onContentInput(e) { this.setData({ content: e.detail.value }); },
  delImg(e) {
    const imgs = [...this.data.images];
    imgs.splice(e.currentTarget.dataset.idx, 1);
    this.setData({ images: imgs });
  },
  chooseImg() {
    wx.chooseMedia({ count: 6 - this.data.images.length, mediaType: ['image'], success: (res) => {
      const tasks = res.tempFiles.map(f => this.uploadOne(f.tempFilePath));
      Promise.all(tasks).then(urls => {
        this.setData({ images: [...this.data.images, ...urls] });
      });
    }});
  },
  uploadOne(path) {
    return new Promise((resolve, reject) => {
      const app = getApp();
      wx.uploadFile({
        url: 'http://localhost:3000/api/upload',
        filePath: path,
        name: 'file',
        header: { Authorization: `Bearer ${app.globalData.token}` },
        success(res) { const d = JSON.parse(res.data); resolve(d.data.url); },
        fail: reject,
      });
    });
  },
  async onSubmit() {
    if (!this.data.rating) return wx.showToast({ title: '请选择评分', icon: 'none' });
    this.setData({ loading: true });
    try {
      await api.post('/api/reviews', { orderId: parseInt(this.orderId), rating: this.data.rating, content: this.data.content, images: this.data.images });
      wx.showToast({ title: '评价成功！' });
      setTimeout(() => wx.navigateBack({ delta: 2 }), 1500);
    } catch { wx.showToast({ title: '提交失败', icon: 'none' }); }
    finally { this.setData({ loading: false }); }
  }
});
```

- [ ] **Step 5: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/review-create/
git -C D:\code\SJTU commit -m "feat: review create page"
```

---

## Task 14: Profile + Pets pages

**Files:**
- Create: `miniprogram/pages/profile/index.*`
- Create: `miniprogram/pages/pet-list/index.*`
- Create: `miniprogram/pages/pet-edit/index.*`

- [ ] **Step 1: Create `pages/profile/index.json`**

```json
{ "navigationBarTitleText": "我的" }
```

- [ ] **Step 2: Create `pages/profile/index.wxml`**

```xml
<view class="header">
  <image class="avatar" src="{{userInfo.avatarUrl || '/assets/default-avatar.png'}}" />
  <view class="user-info">
    <text class="nickname">{{userInfo.nickname}}</text>
    <text class="role-tag">{{userInfo.role === 'provider' ? '服务商' : '宠物主人'}}</text>
  </view>
</view>
<view class="menu-list">
  <view class="menu-item" bindtap="goPets"><text>我的宠物</text><text class="arrow">›</text></view>
  <view wx:if="{{userInfo.role === 'provider'}}" class="menu-item" bindtap="goShopEdit"><text>管理店铺</text><text class="arrow">›</text></view>
  <view wx:if="{{userInfo.role === 'provider'}}" class="menu-item" bindtap="goProviderOrders"><text>接单管理</text><text class="arrow">›</text></view>
  <view wx:if="{{userInfo.role === 'provider'}}" class="menu-item" bindtap="goProviderReviews"><text>店铺评价</text><text class="arrow">›</text></view>
  <view wx:if="{{userInfo.role !== 'provider'}}" class="menu-item" bindtap="becomeProvider"><text>成为服务商</text><text class="arrow">›</text></view>
  <view class="menu-item logout" bindtap="onLogout"><text>退出登录</text></view>
</view>
```

- [ ] **Step 3: Create `pages/profile/index.wxss`**

```css
.header { background: #FF6B35; padding: 60rpx 40rpx; display: flex; align-items: center; gap: 24rpx; }
.avatar { width: 120rpx; height: 120rpx; border-radius: 50%; border: 4rpx solid rgba(255,255,255,0.5); }
.nickname { color: #fff; font-size: 36rpx; font-weight: bold; display: block; }
.role-tag { color: rgba(255,255,255,0.8); font-size: 24rpx; }
.menu-list { background: #fff; margin: 24rpx; border-radius: 12rpx; overflow: hidden; }
.menu-item { display: flex; justify-content: space-between; padding: 32rpx 24rpx; border-bottom: 1rpx solid #f5f5f5; font-size: 30rpx; }
.arrow { color: #ccc; }
.logout { color: #f5222d; }
```

- [ ] **Step 4: Create `pages/profile/index.js`**

```js
const api = require('../../utils/request');
Page({
  data: { userInfo: {} },
  async onShow() {
    const app = getApp();
    if (!app.isLoggedIn()) return wx.reLaunch({ url: '/pages/login/index' });
    const res = await api.get('/api/users/me');
    app.globalData.userInfo = res.data;
    wx.setStorageSync('userInfo', res.data);
    this.setData({ userInfo: res.data });
  },
  goPets() { wx.navigateTo({ url: '/pages/pet-list/index' }); },
  goShopEdit() { wx.navigateTo({ url: '/pages/shop-edit/index' }); },
  goProviderOrders() { wx.navigateTo({ url: '/pages/provider-orders/index' }); },
  goProviderReviews() { wx.navigateTo({ url: '/pages/provider-reviews/index' }); },
  async becomeProvider() {
    const { confirm } = await wx.showModal({ title: '成为服务商', content: '切换后可创建店铺接受预约，是否继续？' });
    if (!confirm) return;
    await api.put('/api/users/me/role', {});
    wx.showToast({ title: '已成为服务商' });
    this.onShow();
  },
  onLogout() { getApp().logout(); wx.reLaunch({ url: '/pages/login/index' }); }
});
```

- [ ] **Step 5: Create pet-list page (wxml + wxss + js + json)**

`pages/pet-list/index.json`:
```json
{ "navigationBarTitleText": "我的宠物" }
```

`pages/pet-list/index.wxml`:
```xml
<view class="pet-list">
  <view wx:for="{{pets}}" wx:key="id" class="card pet-card" bindtap="goEdit" data-id="{{item.id}}">
    <text class="pet-name">{{item.name}}</text>
    <text class="pet-info">{{item.species}} · {{item.breed || '未知品种'}} · {{item.age}}岁 · {{item.weight}}kg</text>
  </view>
  <view wx:if="{{pets.length===0}}" class="empty">还没有添加宠物</view>
</view>
<button class="btn-primary add-btn" bindtap="goAdd">+ 添加宠物</button>
```

`pages/pet-list/index.wxss`:
```css
.pet-list { padding: 16rpx; }
.pet-card { margin-bottom: 0; }
.pet-name { font-size: 32rpx; font-weight: bold; display: block; margin-bottom: 8rpx; }
.pet-info { font-size: 26rpx; color: #666; }
.empty { text-align: center; color: #ccc; padding: 80rpx; }
.add-btn { position: fixed; bottom: 40rpx; left: 40rpx; right: 40rpx; height: 96rpx; line-height: 96rpx; font-size: 32rpx; }
```

`pages/pet-list/index.js`:
```js
const api = require('../../utils/request');
Page({
  data: { pets: [] },
  async onShow() { const r = await api.get('/api/pets'); this.setData({ pets: r.data || [] }); },
  goEdit(e) { wx.navigateTo({ url: `/pages/pet-edit/index?id=${e.currentTarget.dataset.id}` }); },
  goAdd() { wx.navigateTo({ url: '/pages/pet-edit/index' }); }
});
```

- [ ] **Step 6: Create pet-edit page (wxml + wxss + js + json)**

`pages/pet-edit/index.json`:
```json
{ "navigationBarTitleText": "宠物信息" }
```

`pages/pet-edit/index.wxml`:
```xml
<view class="form card">
  <view class="field"><text class="label">名字</text><input class="input" value="{{name}}" bindinput="e=>setData({name:e.detail.value})" placeholder="宠物名字" /></view>
  <view class="field">
    <text class="label">种类</text>
    <picker range="{{['dog','cat','other']}}" bindchange="e=>setData({species:['dog','cat','other'][e.detail.value]})">
      <view class="picker-val">{{species}}</view>
    </picker>
  </view>
  <view class="field"><text class="label">品种</text><input class="input" value="{{breed}}" bindinput="e=>setData({breed:e.detail.value})" placeholder="如：金毛" /></view>
  <view class="field"><text class="label">年龄</text><input class="input" type="number" value="{{age}}" bindinput="e=>setData({age:e.detail.value})" placeholder="岁" /></view>
  <view class="field"><text class="label">体重(kg)</text><input class="input" type="digit" value="{{weight}}" bindinput="e=>setData({weight:e.detail.value})" placeholder="kg" /></view>
  <view class="field"><text class="label">备注</text><textarea class="textarea" value="{{notes}}" bindinput="e=>setData({notes:e.detail.value})" placeholder="特殊情况、饮食习惯等" /></view>
  <button class="btn-primary submit-btn" bindtap="onSave">保存</button>
  <button wx:if="{{petId}}" class="btn-outline del-btn" bindtap="onDelete">删除宠物</button>
</view>
```

`pages/pet-edit/index.wxss`:
```css
.form { margin: 24rpx; }
.field { margin-bottom: 28rpx; }
.label { font-size: 26rpx; color: #666; display: block; margin-bottom: 8rpx; }
.input { background: #f5f5f5; padding: 16rpx 20rpx; border-radius: 8rpx; font-size: 28rpx; }
.picker-val { background: #f5f5f5; padding: 16rpx 20rpx; border-radius: 8rpx; font-size: 28rpx; }
.textarea { background: #f5f5f5; padding: 16rpx 20rpx; border-radius: 8rpx; width: 100%; min-height: 100rpx; font-size: 28rpx; box-sizing: border-box; }
.submit-btn { width: 100%; height: 96rpx; line-height: 96rpx; font-size: 32rpx; margin-bottom: 20rpx; }
.del-btn { width: 100%; height: 96rpx; line-height: 96rpx; font-size: 32rpx; color: #f5222d; border-color: #f5222d; }
```

`pages/pet-edit/index.js`:
```js
const api = require('../../utils/request');
Page({
  data: { petId: null, name: '', species: 'dog', breed: '', age: '', weight: '', notes: '' },
  async onLoad(options) {
    if (options.id) {
      this.setData({ petId: options.id });
      const res = await api.get('/api/pets');
      const pet = (res.data || []).find(p => p.id === parseInt(options.id));
      if (pet) this.setData({ name: pet.name, species: pet.species, breed: pet.breed||'', age: pet.age||'', weight: pet.weight||'', notes: pet.notes||'' });
    }
  },
  async onSave() {
    const { petId, name, species, breed, age, weight, notes } = this.data;
    if (!name) return wx.showToast({ title: '请填写名字', icon: 'none' });
    if (petId) { await api.put(`/api/pets/${petId}`, { name, species, breed, age: parseInt(age), weight: parseFloat(weight), notes }); }
    else { await api.post('/api/pets', { name, species, breed, age: parseInt(age), weight: parseFloat(weight), notes }); }
    wx.showToast({ title: '保存成功' });
    setTimeout(() => wx.navigateBack(), 1000);
  },
  async onDelete() {
    const { confirm } = await wx.showModal({ title: '确认删除', content: '删除后不可恢复' });
    if (!confirm) return;
    await api.del(`/api/pets/${this.data.petId}`);
    wx.showToast({ title: '已删除' });
    setTimeout(() => wx.navigateBack(), 1000);
  }
});
```

- [ ] **Step 7: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/profile/ pet-boarding/miniprogram/pages/pet-list/ pet-boarding/miniprogram/pages/pet-edit/
git -C D:\code\SJTU commit -m "feat: profile, pet-list, pet-edit pages"
```

---

## Task 15: Provider-side pages (shop-edit, provider-orders, provider-reviews)

**Files:**
- Create: `miniprogram/pages/shop-edit/index.*`
- Create: `miniprogram/pages/provider-orders/index.*`
- Create: `miniprogram/pages/provider-reviews/index.*`

- [ ] **Step 1: Create shop-edit page**

`pages/shop-edit/index.json`:
```json
{ "navigationBarTitleText": "编辑店铺" }
```

`pages/shop-edit/index.wxml`:
```xml
<view class="form card">
  <view class="field"><text class="label">店铺名称</text><input class="input" value="{{shopName}}" bindinput="e=>setData({shopName:e.detail.value})" /></view>
  <view class="field"><text class="label">地址</text><input class="input" value="{{address}}" bindinput="e=>setData({address:e.detail.value})" /></view>
  <view class="field"><text class="label">每日价格(¥)</text><input class="input" type="digit" value="{{pricePerDay}}" bindinput="e=>setData({pricePerDay:e.detail.value})" /></view>
  <view class="field"><text class="label">接受宠物种类</text>
    <view class="check-row">
      <view class="check-item {{acceptedSpecies.includes('dog')?'checked':''}}" bindtap="toggleSpecies" data-val="dog">狗</view>
      <view class="check-item {{acceptedSpecies.includes('cat')?'checked':''}}" bindtap="toggleSpecies" data-val="cat">猫</view>
      <view class="check-item {{acceptedSpecies.includes('other')?'checked':''}}" bindtap="toggleSpecies" data-val="other">其他</view>
    </view>
  </view>
  <view class="field"><text class="label">店铺介绍</text><textarea class="textarea" value="{{description}}" bindinput="e=>setData({description:e.detail.value})" /></view>
  <view class="field"><text class="label">接受预约</text><switch checked="{{isAvailable}}" bindchange="e=>setData({isAvailable:e.detail.value})" /></view>
  <button class="btn-primary submit-btn" bindtap="onSave">保存</button>
</view>
```

`pages/shop-edit/index.wxss`:
```css
.form { margin: 24rpx; }
.field { margin-bottom: 28rpx; }
.label { font-size: 26rpx; color: #666; display: block; margin-bottom: 8rpx; }
.input { background: #f5f5f5; padding: 16rpx 20rpx; border-radius: 8rpx; font-size: 28rpx; }
.textarea { background: #f5f5f5; padding: 16rpx 20rpx; border-radius: 8rpx; width: 100%; min-height: 120rpx; font-size: 28rpx; box-sizing: border-box; }
.check-row { display: flex; gap: 16rpx; }
.check-item { padding: 10rpx 28rpx; border-radius: 30rpx; border: 1rpx solid #ddd; font-size: 28rpx; color: #666; }
.check-item.checked { background: #FF6B35; color: #fff; border-color: #FF6B35; }
.submit-btn { width: 100%; height: 96rpx; line-height: 96rpx; font-size: 32rpx; }
```

`pages/shop-edit/index.js`:
```js
const api = require('../../utils/request');
Page({
  data: { providerId: null, shopName: '', address: '', pricePerDay: '', description: '', acceptedSpecies: [], isAvailable: true },
  async onLoad() {
    const app = getApp();
    const res = await api.get('/api/users/me');
    const me = res.data;
    if (me.role !== 'provider') return wx.showToast({ title: '请先成为服务商', icon: 'none' });
    const listRes = await api.get('/api/providers');
    const myShop = listRes.data.find(p => p.user_id === me.id);
    if (myShop) {
      this.setData({
        providerId: myShop.id, shopName: myShop.shop_name, address: myShop.address || '',
        pricePerDay: String(myShop.price_per_day), description: myShop.description || '',
        acceptedSpecies: myShop.accepted_species || [], isAvailable: myShop.is_available,
      });
    }
  },
  toggleSpecies(e) {
    const val = e.currentTarget.dataset.val;
    const list = [...this.data.acceptedSpecies];
    const idx = list.indexOf(val);
    if (idx >= 0) list.splice(idx, 1); else list.push(val);
    this.setData({ acceptedSpecies: list });
  },
  async onSave() {
    const { providerId, shopName, address, pricePerDay, description, acceptedSpecies, isAvailable } = this.data;
    const payload = { shopName, address, pricePerDay: parseFloat(pricePerDay), description, acceptedSpecies, isAvailable };
    if (providerId) { await api.put(`/api/providers/${providerId}`, payload); }
    else { await api.post('/api/providers', payload); }
    wx.showToast({ title: '保存成功' });
    setTimeout(() => wx.navigateBack(), 1000);
  }
});
```

- [ ] **Step 2: Create provider-orders page**

`pages/provider-orders/index.json`:
```json
{ "navigationBarTitleText": "接单管理" }
```

`pages/provider-orders/index.wxml`:
```xml
<view class="tabs">
  <view wx:for="{{tabs}}" wx:key="*this" class="tab {{activeTab===index?'active':''}}" bindtap="switchTab" data-idx="{{index}}">{{item}}</view>
</view>
<view wx:for="{{filtered}}" wx:key="id" class="card order-card">
  <view class="row"><text class="user">{{item.user_nickname}}</text><text class="tag tag-{{item.status}}">{{statusMap[item.status]}}</text></view>
  <text class="pet-info">🐾 {{item.pet_name}}({{item.pet_species}}) · {{item.start_date}}~{{item.end_date}}</text>
  <text class="price">¥{{item.total_price}}</text>
  <view class="action-row">
    <button wx:if="{{item.status==='pending'}}" class="btn-primary action-btn" bindtap="updateStatus" data-id="{{item.id}}" data-status="confirmed">确认接单</button>
    <button wx:if="{{item.status==='confirmed'}}" class="btn-primary action-btn" bindtap="updateStatus" data-id="{{item.id}}" data-status="ongoing">开始寄养</button>
    <button wx:if="{{item.status==='ongoing'}}" class="btn-primary action-btn" bindtap="updateStatus" data-id="{{item.id}}" data-status="completed">完成寄养</button>
    <button wx:if="{{item.status==='pending'||item.status==='confirmed'}}" class="btn-outline action-btn" bindtap="updateStatus" data-id="{{item.id}}" data-status="cancelled">拒绝/取消</button>
  </view>
</view>
<view wx:if="{{filtered.length===0}}" class="empty">暂无订单</view>
```

`pages/provider-orders/index.wxss`:
```css
.tabs { display: flex; background: #fff; border-bottom: 1rpx solid #f0f0f0; }
.tab { flex: 1; text-align: center; padding: 24rpx 0; font-size: 26rpx; color: #666; }
.tab.active { color: #FF6B35; border-bottom: 4rpx solid #FF6B35; }
.order-card { margin: 16rpx; }
.row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8rpx; }
.user { font-size: 30rpx; font-weight: bold; }
.pet-info { font-size: 26rpx; color: #666; display: block; margin-bottom: 6rpx; }
.price { color: #FF6B35; font-size: 28rpx; font-weight: bold; display: block; margin-bottom: 12rpx; }
.action-row { display: flex; gap: 16rpx; }
.action-btn { flex: 1; height: 72rpx; line-height: 72rpx; font-size: 26rpx; }
.empty { text-align: center; color: #ccc; padding: 80rpx; }
```

`pages/provider-orders/index.js`:
```js
const api = require('../../utils/request');
const STATUS_MAP = { pending: '待确认', confirmed: '已确认', ongoing: '寄养中', completed: '已完成', cancelled: '已取消' };
Page({
  data: { orders: [], filtered: [], tabs: ['全部','待确认','进行中','已完成'], activeTab: 0, statusMap: STATUS_MAP },
  async onShow() {
    const res = await api.get('/api/orders');
    this.allOrders = res.data || [];
    this.filter(this.data.activeTab);
  },
  switchTab(e) { const idx = e.currentTarget.dataset.idx; this.setData({ activeTab: idx }); this.filter(idx); },
  filter(idx) {
    const groups = [null, ['pending'], ['confirmed','ongoing'], ['completed']];
    const statuses = groups[idx];
    this.setData({ filtered: statuses ? this.allOrders.filter(o => statuses.includes(o.status)) : this.allOrders });
  },
  async updateStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    await api.put(`/api/orders/${id}/status`, { status });
    wx.showToast({ title: '更新成功' });
    this.onShow();
  }
});
```

- [ ] **Step 3: Create provider-reviews page**

`pages/provider-reviews/index.json`:
```json
{ "navigationBarTitleText": "店铺评价" }
```

`pages/provider-reviews/index.wxml`:
```xml
<view wx:for="{{reviews}}" wx:key="id" class="card review-card">
  <view class="header-row">
    <image src="{{item.avatar_url || '/assets/default-avatar.png'}}" class="avatar" />
    <text class="nickname">{{item.nickname}}</text>
    <text class="stars">{{item.rating}}★</text>
    <text class="date">{{item.created_at.slice(0,10)}}</text>
  </view>
  <text class="content">{{item.content}}</text>
  <scroll-view scroll-x class="img-row">
    <image wx:for="{{item.images}}" wx:for-item="img" wx:key="*this" src="{{img}}" class="review-img" mode="aspectFill" />
  </scroll-view>
  <view wx:if="{{item.reply}}" class="reply">已回复：{{item.reply}}</view>
  <view wx:else>
    <input class="reply-input" placeholder="回复此评价..." value="{{replyTexts[item.id]}}" bindinput="onReplyInput" data-id="{{item.id}}" />
    <button class="btn-primary reply-btn" bindtap="onReply" data-id="{{item.id}}">回复</button>
  </view>
</view>
<view wx:if="{{reviews.length===0}}" class="empty">暂无评价</view>
```

`pages/provider-reviews/index.wxss`:
```css
.review-card { margin: 16rpx; }
.header-row { display: flex; align-items: center; gap: 12rpx; margin-bottom: 12rpx; }
.avatar { width: 64rpx; height: 64rpx; border-radius: 50%; }
.nickname { font-size: 28rpx; flex: 1; }
.stars { color: #faad14; }
.date { font-size: 22rpx; color: #ccc; }
.content { font-size: 28rpx; color: #555; display: block; margin-bottom: 8rpx; }
.img-row { white-space: nowrap; margin-bottom: 12rpx; }
.review-img { width: 150rpx; height: 150rpx; border-radius: 8rpx; margin-right: 8rpx; display: inline-block; }
.reply { background: #f9f9f9; padding: 8rpx 16rpx; border-radius: 6rpx; font-size: 26rpx; color: #888; }
.reply-input { background: #f5f5f5; padding: 12rpx 16rpx; border-radius: 8rpx; font-size: 26rpx; margin-top: 8rpx; }
.reply-btn { height: 64rpx; line-height: 64rpx; font-size: 26rpx; margin-top: 8rpx; }
.empty { text-align: center; color: #ccc; padding: 80rpx; }
```

`pages/provider-reviews/index.js`:
```js
const api = require('../../utils/request');
Page({
  data: { reviews: [], replyTexts: {} },
  async onLoad() {
    const meRes = await api.get('/api/users/me');
    const listRes = await api.get('/api/providers');
    const myShop = listRes.data.find(p => p.user_id === meRes.data.id);
    if (!myShop) return;
    this.providerId = myShop.id;
    this.loadReviews();
  },
  async loadReviews() {
    const res = await api.get(`/api/reviews/provider/${this.providerId}`);
    this.setData({ reviews: res.data || [], replyTexts: {} });
  },
  onReplyInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`replyTexts.${id}`]: e.detail.value });
  },
  async onReply(e) {
    const id = e.currentTarget.dataset.id;
    const reply = this.data.replyTexts[id];
    if (!reply) return wx.showToast({ title: '请填写回复', icon: 'none' });
    await api.put(`/api/reviews/${id}/reply`, { reply });
    wx.showToast({ title: '回复成功' });
    this.loadReviews();
  }
});
```

- [ ] **Step 4: Commit**

```bash
git -C D:\code\SJTU add pet-boarding/miniprogram/pages/shop-edit/ pet-boarding/miniprogram/pages/provider-orders/ pet-boarding/miniprogram/pages/provider-reviews/
git -C D:\code\SJTU commit -m "feat: provider-side pages"
```

---

## Task 16: Final wiring + test run

- [ ] **Step 1: Start MySQL and run schema if not done**

```bash
mysql -u root -p < D:\code\SJTU\pet-boarding\server\db\schema.sql
```

- [ ] **Step 2: Start backend**

```bash
cd D:\code\SJTU\pet-boarding\server && npm start
```

Expected: `Server running on port 3000`

- [ ] **Step 3: Verify auth endpoint reachable**

```bash
curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{}"
```

Expected: `{"code":400,"message":"code is required","data":null}`

- [ ] **Step 4: Run backend tests**

```bash
cd D:\code\SJTU\pet-boarding\server && npm test
```

Expected: all tests pass

- [ ] **Step 5: Open miniprogram in WeChat DevTools**

1. Open WeChat DevTools
2. Import project from `D:\code\SJTU\pet-boarding\miniprogram`
3. Set AppID (use test AppID or your real one)
4. In DevTools settings → Project → uncheck "Check legal domain" for local dev
5. Verify login page loads without errors

- [ ] **Step 6: Final commit**

```bash
git -C D:\code\SJTU add -A
git -C D:\code\SJTU commit -m "feat: complete pet boarding platform MVP"
```
