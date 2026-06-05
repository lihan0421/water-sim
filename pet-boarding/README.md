# 宠物寄养预约平台

微信小程序 + Node.js 后端，支持宠物主人在线预约寄养、查看价格评价，服务商接单管理。

## 目录结构

```
pet-boarding/
├── server/         # Node.js + Express 后端
└── miniprogram/    # 微信小程序前端
```

## 后端启动

1. 安装 MySQL，运行数据库初始化脚本：
   ```bash
   mysql -u root -p < server/db/schema.sql
   ```

2. 配置环境变量：
   ```bash
   cp server/.env.example server/.env
   # 编辑 .env，填写 DB 密码、微信 AppID/Secret、JWT Secret
   ```

3. 安装依赖并启动：
   ```bash
   cd server && npm install && npm start
   ```

## 小程序启动

1. 下载微信开发者工具
2. 导入项目：选择 `miniprogram/` 目录
3. 填写你的 AppID（在 `project.config.json` 中）
4. 开发设置 → 关闭"校验合法域名"（本地开发用）
5. 后端地址在 `miniprogram/utils/request.js` 的 `BASE_URL` 中修改

## 功能

- 微信一键授权登录
- 浏览 / 搜索 / 筛选寄养服务商
- 在线预约，价格自动计算
- 订单状态全程跟踪（待确认 → 已确认 → 寄养中 → 已完成）
- 图文评价（最多6张图）+ 服务商回复
- 服务商端：店铺管理、接单、完成订单
- 角色切换（普通用户 → 服务商）

## API 文档

见 `docs/superpowers/specs/2026-06-04-pet-boarding-design.md`
