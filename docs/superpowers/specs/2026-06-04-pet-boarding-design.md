# 宠物寄养预约平台 — 设计文档

**日期**: 2026-06-04  
**项目路径**: `D:\code\SJTU\pet-boarding`

---

## 概述

双端微信小程序平台，宠物主人可浏览服务商、在线预约寄养、提交图文评价；服务商可管理店铺、接单、回复评价。线下支付，微信一键授权登录。

---

## 架构

```
[微信小程序（原生）] ←→ [Node.js + Express 后端] ←→ [MySQL]
```

- **前端**: 单小程序项目，按 `role`（user / provider）渲染不同界面
- **后端**: Express 单体服务，路由按领域拆模块
- **数据库**: MySQL，6张核心表
- **认证**: 微信 `wx.login()` → 后端 `code2session` → 签发 JWT → 小程序存 `storage`
- **图片**: `multipart/form-data` 上传至服务器本地 `uploads/`，Express 静态服务

---

## 目录结构

```
D:\code\SJTU\pet-boarding\
├── miniprogram/               # 微信小程序前端
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   ├── pages/
│   │   ├── login/             # 登录授权
│   │   ├── index/             # 首页（主人端：搜索服务商）
│   │   ├── provider-list/     # 服务商列表
│   │   ├── provider-detail/   # 服务商详情+评价
│   │   ├── order-create/      # 创建预约
│   │   ├── order-list/        # 我的订单
│   │   ├── order-detail/      # 订单详情
│   │   ├── review-create/     # 提交评价
│   │   ├── profile/           # 个人中心（双角色）
│   │   ├── pet-list/          # 我的宠物
│   │   ├── pet-edit/          # 新增/编辑宠物
│   │   ├── shop-edit/         # 服务商：编辑店铺
│   │   ├── provider-orders/   # 服务商：订单管理
│   │   └── provider-reviews/  # 服务商：查看评价
│   └── utils/
│       ├── request.js         # 封装 wx.request，自动带 JWT header
│       └── auth.js            # 登录态检查工具
│
└── server/                    # Node.js 后端
    ├── src/
    │   ├── app.js             # Express 入口
    │   ├── config/
    │   │   └── db.js          # MySQL 连接池
    │   ├── middleware/
    │   │   └── auth.js        # JWT 验证中间件
    │   └── routes/
    │       ├── auth.js        # POST /api/auth/login
    │       ├── users.js       # GET/PUT /api/users/me
    │       ├── pets.js        # CRUD /api/pets
    │       ├── providers.js   # GET /api/providers, CRUD /api/providers/:id
    │       ├── orders.js      # CRUD /api/orders, PUT /api/orders/:id/status
    │       ├── reviews.js     # POST /api/reviews, GET /api/reviews/provider/:id
    │       └── upload.js      # POST /api/upload
    ├── uploads/               # 图片静态文件
    └── package.json
```

---

## 数据模型

### users
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK AUTO_INCREMENT | |
| openid | VARCHAR(64) UNIQUE | 微信 openid |
| nickname | VARCHAR(64) | |
| avatar_url | VARCHAR(255) | |
| phone | VARCHAR(20) | |
| role | ENUM('user','provider') DEFAULT 'user' | |
| created_at | DATETIME DEFAULT NOW() | |

### pets
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| user_id | INT FK→users | |
| name | VARCHAR(32) | |
| species | ENUM('dog','cat','other') | |
| breed | VARCHAR(64) | |
| age | INT | 年龄（岁） |
| weight | FLOAT | 体重（kg） |
| notes | TEXT | 特殊需求备注 |

### providers
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| user_id | INT FK→users | |
| shop_name | VARCHAR(64) | |
| description | TEXT | |
| address | VARCHAR(255) | |
| price_per_day | DECIMAL(8,2) | 每日价格 |
| accepted_species | JSON | 如 ["dog","cat"] |
| avg_rating | FLOAT DEFAULT 0 | 平均评分（更新触发器） |
| images | JSON | 店铺图片 URL 列表 |
| is_available | BOOLEAN DEFAULT TRUE | 是否接受预约 |

### orders
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| user_id | INT FK→users | |
| provider_id | INT FK→providers | |
| pet_id | INT FK→pets | |
| start_date | DATE | |
| end_date | DATE | |
| total_price | DECIMAL(8,2) | |
| status | ENUM('pending','confirmed','ongoing','completed','cancelled') DEFAULT 'pending' | |
| note | TEXT | 主人备注 |
| created_at | DATETIME | |

**状态流转**: pending → confirmed → ongoing → completed；任意阶段可 → cancelled

### reviews
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| order_id | INT FK→orders UNIQUE | 一单一评 |
| user_id | INT FK→users | |
| provider_id | INT FK→providers | |
| rating | TINYINT | 1-5 |
| content | TEXT | |
| reply | TEXT | 服务商回复 |
| created_at | DATETIME | |

### review_images
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| review_id | INT FK→reviews | |
| image_url | VARCHAR(255) | |
| sort_order | INT DEFAULT 0 | |

---

## API 设计

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 微信 code → openid → JWT |

### 用户
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/users/me | 获取当前用户信息 |
| PUT | /api/users/me | 更新昵称/头像/手机号 |
| PUT | /api/users/me/role | 切换为服务商角色 |

### 宠物
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/pets | 获取我的宠物列表 |
| POST | /api/pets | 新增宠物 |
| PUT | /api/pets/:id | 编辑宠物 |
| DELETE | /api/pets/:id | 删除宠物 |

### 服务商
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/providers | 列表（支持 species/minPrice/maxPrice/minRating 过滤） |
| GET | /api/providers/:id | 详情 |
| POST | /api/providers | 创建店铺（role=provider 时调用） |
| PUT | /api/providers/:id | 更新店铺信息 |

### 订单
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/orders | 创建预约 |
| GET | /api/orders | 我的订单列表（user 看自己的，provider 看店铺的） |
| GET | /api/orders/:id | 订单详情 |
| PUT | /api/orders/:id/status | 更新状态（服务商 confirm/start/complete；双方 cancel） |

### 评价
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/reviews | 提交评价（含图片 URL 列表） |
| GET | /api/reviews/provider/:id | 获取服务商的评价列表 |
| PUT | /api/reviews/:id/reply | 服务商回复评价 |

### 图片上传
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/upload | multipart/form-data，返回图片 URL |

---

## 前端页面清单

### 宠物主人端
| 页面 | 路径 | 核心功能 |
|------|------|------|
| 首页 | /pages/index/index | 搜索框、推荐服务商卡片列表、按物种筛选 |
| 服务商列表 | /pages/provider-list/index | 带过滤器的列表，支持价格/评分排序 |
| 服务商详情 | /pages/provider-detail/index | 店铺信息、价格、图片轮播、评价列表、预约按钮 |
| 创建预约 | /pages/order-create/index | 选宠物、选日期、填备注、确认价格 |
| 订单列表 | /pages/order-list/index | 按状态分 tab，展示订单卡片 |
| 订单详情 | /pages/order-detail/index | 完整订单信息、状态时间线、取消/评价入口 |
| 提交评价 | /pages/review-create/index | 评星、文字、上传图片（最多 6 张） |
| 个人中心 | /pages/profile/index | 头像昵称、我的宠物、角色切换入口 |
| 宠物列表 | /pages/pet-list/index | 宠物卡片列表、新增入口 |
| 宠物编辑 | /pages/pet-edit/index | 新增/编辑宠物表单 |

### 服务商端
| 页面 | 路径 | 核心功能 |
|------|------|------|
| 店铺编辑 | /pages/shop-edit/index | 编辑店名/介绍/地址/价格/可接受物种/图片 |
| 订单管理 | /pages/provider-orders/index | 按状态分 tab，确认/开始/完成订单 |
| 评价查看 | /pages/provider-reviews/index | 评价列表，回复入口 |

### 公共
| 页面 | 路径 | 核心功能 |
|------|------|------|
| 登录 | /pages/login/index | wx.getUserProfile + wx.login，一键授权 |

---

## 关键实现细节

### JWT 认证流程
1. 小程序调 `wx.login()` 获取 `code`
2. 发送 `code` 到 `POST /api/auth/login`
3. 后端用 `code` + `appid` + `secret` 调微信接口获取 `openid`
4. 查 users 表，不存在则插入新用户
5. 签发 JWT（payload: `{userId, role}`，24h 过期），返回给小程序
6. 小程序存入 `wx.setStorageSync('token', token)`
7. `utils/request.js` 所有请求自动带 `Authorization: Bearer <token>` header

### 图片上传流程
1. 小程序 `wx.chooseMedia()` 选取图片
2. `wx.uploadFile()` POST 到 `/api/upload`
3. 后端 Multer 保存到 `uploads/` 目录，返回访问 URL
4. 前端收集 URL 列表，随评价数据一起提交

### avg_rating 更新
每次插入 review 后，后端计算该 provider 所有评价的平均分并更新 `providers.avg_rating`。

### 价格计算
`total_price = price_per_day × (end_date - start_date 天数)`，在前端实时展示，后端插入时校验。

---

## 错误处理

- 所有 API 返回统一格式：`{ code, message, data }`
- HTTP 状态码：200 成功 / 400 参数错误 / 401 未授权 / 403 无权限 / 404 不存在 / 500 服务器错误
- 小程序 `request.js` 统一拦截 401，跳转到登录页

---

## 不在本期范围内

- 在线支付（微信支付）
- 地图定位搜索
- 实时消息（WebSocket）
- 管理后台
