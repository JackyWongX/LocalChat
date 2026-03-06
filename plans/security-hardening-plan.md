# 计划：LocalChat 外网部署安全加固

## 概述

项目当前无任何鉴权、数据明文存储、无速率限制。为部署至外网，本计划分三个阶段系统性加固安全性：
① 身份鉴权（安全码 + JWT），② 数据加密存储（独立密钥 + AES-256-GCM），③ 速率限制与整体防护。
安全码仅用于连接鉴权，加密密钥独立管理，二者无耦合关系。

---

## Phase 1：身份鉴权系统

- **Objective：** 实现安全码鉴权，仅持有安全码的用户可访问聊天室，token 有效期 3 天
- **Files/Functions to Modify/Create：**
  - `server.js` — 启动时交互式输入安全码（不回显）、`POST /auth` 接口、`authMiddleware` JWT 验证中间件、Socket.IO 握手鉴权
  - `public/index.html` — 新增安全码输入弹窗 UI
  - `public/app.js` — token 存储/读取/过期检测、`/auth` 调用逻辑、所有 HTTP 请求添加 Authorization 头、Socket.IO 连接携带 token
  - `config.json`（新建）— 外网 IP/域名白名单（CORS allowedOrigins）
- **Steps：**
  1. `npm install jsonwebtoken` 安装依赖
  2. 创建 `config.json`，包含 `allowedOrigins`（IP 白名单数组）字段
  3. 服务器启动时用 Node.js `readline` 交互式读取安全码，不回显，仅保存在内存变量中
  4. 新增 `POST /auth` 接口：接收 `{ passcode }`，与内存中安全码比对（`crypto.timingSafeEqual` 防时序攻击），验证通过则用 `jsonwebtoken` 签发 JWT（有效期 72h），返回 `{ token }`
  5. 编写 `authMiddleware`：从 `Authorization: Bearer <token>` 提取并验证 JWT，验证失败返回 401，所有 `/upload`、`/download/:file`、`/files/:file` 路由均应用此中间件
  6. Socket.IO `io.use()` 握手中间件：从 `socket.handshake.auth.token` 验证 JWT，不通过则拒绝连接
  7. 前端启动时检查 `localStorage` 中 token 是否存在且 `exp` 时间戳未过期，否则显示安全码弹窗
  8. 安全码弹窗提交后调用 `POST /auth`，成功则存储 token + 过期时间到 `localStorage`，初始化 Socket.IO 连接
  9. `/auth` 接口针对 IP 做失败计数：同一 IP 连续失败 5 次则封禁 15 分钟（内存 Map 实现）

---

## Phase 2：数据加密存储

- **Objective：** 消息文件和上传文件在磁盘上全部加密，密钥独立于安全码管理
- **Files/Functions to Modify/Create：**
  - `crypto-utils.js`（新建）— AES-256-GCM 加解密工具函数
  - `server.js` — 服务器启动时初始化密钥、`saveMessages()`/`loadMessages()` 改为加密读写、文件上传加密写入/下载解密输出
- **Steps：**
  1. 使用 Node.js 内置 `crypto` 模块，无需安装额外依赖
  2. 新建 `crypto-utils.js`，实现：
     - `encryptText(plaintext, key)` → 随机生成 12 字节 IV，用 AES-256-GCM 加密，返回 `iv:authTag:ciphertext`（Base64 拼接）
     - `decryptText(encoded, key)` → 解析拼接格式，AES-256-GCM 解密，返回明文
     - `encryptStream(inputStream, key)` → 返回加密 Transform 流（用于文件写入）
     - `decryptStream(inputStream, key)` → 返回解密 Transform 流（用于文件读取）
  3. 密钥管理：服务器启动时检查 `data/secret.key` 是否存在；不存在则 `crypto.randomBytes(32)` 生成新密钥并写入该文件（hex 格式）；存在则读取。密钥文件不加入 git（`.gitignore` 添加 `data/secret.key`）
  4. 修改 `saveMessages()`：`JSON.stringify` → `encryptText` → 写入 `messages.json`
  5. 修改 `loadMessages()`：读取文件 → `decryptText` → `JSON.parse`；若文件是旧版明文格式（解密失败）则尝试直接解析（兼容首次迁移），迁移后立即重新加密保存
  6. 修改文件上传逻辑：接收文件 buffer 后，用 `encryptStream` 加密写入 `data/files/`
  7. 修改下载接口：读取加密文件 → 通过 `decryptStream` 管道解密 → pipe 给响应流
  8. 修改 `/files/:filename` 静态服务：改为与下载接口相同的加密读取方式（不再直接静态托管 `data/files/`）

---

## Phase 3：速率限制、安全头与整体加固

- **Objective：** 防暴力/DDoS、安全 HTTP 头、文件上传类型限制、输入校验、WebSocket 限速
- **Files/Functions to Modify/Create：**
  - `server.js` — 添加 Helmet、rate-limit、输入校验、WebSocket 限速、CORS 限制
  - `package.json` — 新增依赖
- **Steps：**
  1. `npm install helmet express-rate-limit` 安装依赖
  2. 添加 `helmet()` 中间件：启用 CSP（限制脚本来源）、HSTS（强制 HTTPS）、X-Frame-Options（禁止 iframe 嵌套）等安全响应头
  3. 设置 CORS：从 `config.json` 读取 `allowedOrigins` 白名单，替换现有全局开放的 `cors()`
  4. 全局 HTTP 速率限制：每 IP 每 15 分钟最多 300 次请求（`express-rate-limit`）
  5. `/auth` 接口单独限速：每 IP 每 15 分钟最多 10 次（与 Phase 1 的失败封禁配合使用）
  6. 文件上传 MIME 白名单校验：允许图片（`image/*`）、常见文档、压缩包，拒绝可执行文件（`.exe`、`.sh`、`.php` 等）
  7. WebSocket 消息频率限制：每个 socket 每秒最多发送 10 个事件，超过则警告并断开连接
  8. 输入长度校验：昵称 ≤ 50 字符，消息内容 ≤ 5000 字符，超长直接拒绝
  9. 统一错误响应格式：所有错误只返回通用信息，不泄露堆栈或内部路径
  10. 禁用 `X-Powered-By` 头（`app.disable('x-powered-by')`），隐藏技术栈信息

---

## 安全加固覆盖范围

| 安全领域 | 措施 |
|---|---|
| 访问控制 | JWT token + 安全码鉴权，所有接口和 WebSocket 全保护 |
| 认证暴力攻击 | IP 失败次数限制 + 临时封禁 + `/auth` 独立限速 |
| 数据隐私（存储） | AES-256-GCM 加密消息和文件，密钥独立管理 |
| 数据隐私（传输） | 已有 HTTPS，补充 HSTS 强制头 |
| 流量控制 | 全局 HTTP 限速 + 接口级限速 + WebSocket 事件限速 |
| XSS 防护 | 已有 textContent 转义，补充 CSP 响应头 |
| 文件安全 | MIME 白名单拦截恶意文件，无大小限制（用户需求） |
| 路径穿越 | 已有 basename 防护（保留并加固） |
| 信息泄露 | 隐藏技术栈，统一错误响应 |
| CORS | 从全局开放改为白名单域名限制 |
| WebSocket 安全 | 握手验证 token，实时消息限速 |
| 密钥管理 | 加密密钥与安全码解耦，独立文件存储，不入 git |
