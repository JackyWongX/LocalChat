'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Readable } = require('stream');
const { initEncryptionKey, encryptText, decryptText, createEncryptStream, createDecryptStream } = require('./crypto-utils');

// ─────────────────────────────────────────────
// 加载配置文件
// ─────────────────────────────────────────────
let config = { allowedOrigins: [] };
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
  console.warn('[配置] config.json 读取失败，使用默认配置');
}

// ─────────────────────────────────────────────
// 初始化加密密钥（独立于安全码）
// ─────────────────────────────────────────────
const ENCRYPTION_KEY = initEncryptionKey();

// ─────────────────────────────────────────────
// 安全码（启动时通过交互式输入，仅存内存）
// JWT 密钥每次启动随机生成，重启后所有旧 token 自动失效
// ─────────────────────────────────────────────
let PASSCODE = '';
const JWT_SECRET = crypto.randomBytes(64).toString('hex');

async function promptPasscode() {
  // 支持通过环境变量传入安全码（用于后台/守护进程启动）
  if (process.env.LOCALCHAT_PASSCODE) {
    const passcode = process.env.LOCALCHAT_PASSCODE;
    delete process.env.LOCALCHAT_PASSCODE; // 立即清除，避免子进程继承或被读取
    console.log('[安全] 已从环境变量读取安全码');
    return passcode;
  }

  return new Promise((resolve) => {
    process.stdout.write('请输入聊天室安全码（输入不可见）：');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let input = '';
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0003') {
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(); }
        process.stdout.write('\n');
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        resolve(input);
      } else if (ch === '\u007F' || ch === '\b') {
        if (input.length > 0) input = input.slice(0, -1);
      } else {
        input += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

// ─────────────────────────────────────────────
// 禁止上传的文件扩展名（可执行/脚本/危险类型）
// ─────────────────────────────────────────────
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.fish',
  '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.wsf', '.wsh',
  '.msi', '.msp', '.msc', '.reg',
  '.php', '.php3', '.php4', '.php5', '.php7', '.phtml', '.phar',
  '.asp', '.aspx', '.jsp', '.jspx', '.cfm',
  '.py', '.pyc', '.pyo', '.rb', '.pl', '.cgi',
  '.dll', '.so', '.dylib', '.sys', '.drv',
  '.scr', '.pif', '.lnk', '.jar', '.war', '.ear',
  '.htaccess', '.htpasswd'
]);

const app = express();
const PORT = 3001;
const HTTPS_PORT = 3443;

// ─────────────────────────────────────────────
// 安全头（Helmet）
// ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true
}));
app.disable('x-powered-by');

// ─────────────────────────────────────────────
// CORS（白名单）
// ─────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[CORS] 拒绝来源：${origin}`);
    callback(null, false);
  },
  credentials: true
};
app.use(cors(corsOptions));

// ─────────────────────────────────────────────
// HTTP 速率限制
// ─────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '验证次数过多，请 15 分钟后再试' }
});

// ─────────────────────────────────────────────
// IP 暴力破解封禁
// ─────────────────────────────────────────────
const authFailMap = new Map();
const AUTH_MAX_FAILURES = 5;
const AUTH_BLOCK_MS = 15 * 60 * 1000;

function isIpBlocked(ip) {
  const record = authFailMap.get(ip);
  if (!record) return false;
  if (record.blockedUntil && Date.now() < record.blockedUntil) return true;
  if (record.blockedUntil && Date.now() >= record.blockedUntil) authFailMap.delete(ip);
  return false;
}

function recordAuthFailure(ip) {
  const record = authFailMap.get(ip) || { count: 0, blockedUntil: null };
  record.count += 1;
  if (record.count >= AUTH_MAX_FAILURES) {
    record.blockedUntil = Date.now() + AUTH_BLOCK_MS;
    console.warn(`[安全] IP ${ip} 验证失败 ${AUTH_MAX_FAILURES} 次，封禁 15 分钟`);
  }
  authFailMap.set(ip, record);
}

function clearAuthFailure(ip) {
  authFailMap.delete(ip);
}

// ─────────────────────────────────────────────
// JWT 鉴权中间件
// ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权，请先验证安全码' });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token 无效或已过期，请重新验证安全码' });
  }
}

// ─────────────────────────────────────────────
// SSL 服务器
// ─────────────────────────────────────────────

let server;
try {
  const key = fs.readFileSync('key.pem');
  const cert = fs.readFileSync('cert.pem');
  server = https.createServer({ key, cert }, app);
  console.log('[服务器] 使用 HTTPS');
} catch (err) {
  server = http.createServer(app);
  console.log('[服务器] 使用 HTTP（未找到 SSL 证书）');
}

// ─────────────────────────────────────────────
// Socket.IO（含鉴权中间件）
// ─────────────────────────────────────────────
const io = socketIo(server, { cors: corsOptions });

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('未授权：缺少 Token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    next(new Error('Token 无效或已过期'));
  }
});

// ─────────────────────────────────────────────
// 数据路径与工具函数
// ─────────────────────────────────────────────
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const FILES_DIR = path.join(__dirname, 'data', 'files');
const EXPIRY_DAYS = 3;
const fileMetaByStoredName = new Map();

function loadMessages() {
  try {
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
    if (!raw || raw.trim() === '') return [];
    try {
      const decrypted = decryptText(raw.trim(), ENCRYPTION_KEY);
      return JSON.parse(decrypted);
    } catch (_) {
      // 兼容旧版明文 JSON（首次迁移）
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          console.log('[加密] 检测到旧版明文消息，正在迁移加密...');
          saveMessages(parsed);
          return parsed;
        }
      } catch (__) {}
      console.error('[加密] 消息解密失败，返回空列表');
      return [];
    }
  } catch (err) {
    return [];
  }
}

function saveMessages(msgs) {
  const encrypted = encryptText(JSON.stringify(msgs), ENCRYPTION_KEY);
  fs.writeFileSync(MESSAGES_FILE, encrypted, 'utf8');
}

function cleanExpiredMessages() {
  const now = Date.now();
  const expiryTime = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  let msgs = loadMessages();
  const expired = msgs.filter(msg => now - msg.timestamp >= expiryTime);
  msgs = msgs.filter(msg => now - msg.timestamp < expiryTime);
  expired.forEach(msg => {
    if (msg.type === 'file' || msg.type === 'image') {
      const storedFileName = msg.storedFileName || (msg.filePath ? path.basename(msg.filePath) : null);
      if (storedFileName) {
        const fp = path.join(FILES_DIR, storedFileName);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
      }
    }
  });
  saveMessages(msgs);
  return msgs;
}

function cleanOrphanedFiles() {
  if (!fs.existsSync(FILES_DIR)) return;
  const now = Date.now();
  const expiryTime = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  try {
    fs.readdirSync(FILES_DIR).forEach(file => {
      const fp = path.join(FILES_DIR, file);
      try {
        if (now - fs.statSync(fp).mtimeMs >= expiryTime) fs.unlinkSync(fp);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}

function decodeUploadedFileName(rawName = '') {
  if (!rawName) return rawName;
  const utf8Name = Buffer.from(rawName, 'latin1').toString('utf8');
  return utf8Name.includes('\uFFFD') ? rawName : utf8Name;
}

function rebuildFileMetaMap() {
  fileMetaByStoredName.clear();
  messages.forEach(msg => {
    if ((msg.type === 'file' || msg.type === 'image') && msg.fileName) {
      const storedName = msg.storedFileName || (msg.filePath ? path.basename(msg.filePath) : null);
      if (storedName) fileMetaByStoredName.set(storedName, msg.fileName);
    }
  });
}

// ─────────────────────────────────────────────
// 中间件
// ─────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(fileUpload());
app.use(express.static('public'));
// /files 不再静态托管（已改为加密读取路由）

// ─────────────────────────────────────────────
// 鉴权接口
// ─────────────────────────────────────────────
app.post('/auth', authLimiter, (req, res) => {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  if (isIpBlocked(ip)) {
    return res.status(429).json({ error: '验证失败次数过多，请 15 分钟后再试' });
  }
  const { passcode } = req.body || {};
  if (typeof passcode !== 'string' || passcode.length === 0) {
    return res.status(400).json({ error: '请提供安全码' });
  }
  const inputBuf = Buffer.from(passcode, 'utf8');
  const expectedBuf = Buffer.from(PASSCODE, 'utf8');
  let valid = false;
  if (inputBuf.length === expectedBuf.length) {
    valid = crypto.timingSafeEqual(inputBuf, expectedBuf);
  }
  if (!valid) {
    recordAuthFailure(ip);
    const record = authFailMap.get(ip);
    const remaining = AUTH_MAX_FAILURES - (record ? record.count : 0);
    if (remaining <= 0) {
      return res.status(429).json({ error: '验证失败次数过多，IP 已封禁 15 分钟' });
    }
    return res.status(401).json({ error: `安全码错误，还剩 ${remaining} 次机会` });
  }
  clearAuthFailure(ip);
  const token = jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: '72h' });
  return res.json({ token });
});

// ─────────────────────────────────────────────
// Token 验证接口（页面加载时主动校验缓存 token 是否仍有效）
// ─────────────────────────────────────────────
app.get('/verify', authMiddleware, (req, res) => {
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// 文件下载（解密输出）
// ─────────────────────────────────────────────
app.get('/download/:storedFileName', authMiddleware, (req, res) => {
  const storedFileName = path.basename(req.params.storedFileName);
  const fileLocation = path.join(FILES_DIR, storedFileName);
  if (!fs.existsSync(fileLocation)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  const originalFileName = fileMetaByStoredName.get(storedFileName) || storedFileName;
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalFileName)}`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-cache');
  const readStream = fs.createReadStream(fileLocation);
  const decryptStream = createDecryptStream(ENCRYPTION_KEY);
  readStream.on('error', () => { if (!res.headersSent) res.status(500).json({ error: '文件读取失败' }); });
  decryptStream.on('error', () => { if (!res.headersSent) res.status(500).json({ error: '文件解密失败' }); else res.destroy(); });
  readStream.pipe(decryptStream).pipe(res);
});

// ─────────────────────────────────────────────
// 文件内联访问（图片等，解密输出）
// ─────────────────────────────────────────────
app.get('/files/:filename', authMiddleware, (req, res) => {
  const filename = path.basename(req.params.filename);
  const fileLocation = path.join(FILES_DIR, filename);
  if (!fs.existsSync(fileLocation)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  const imageMimes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
  };
  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', imageMimes[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-cache');
  const readStream = fs.createReadStream(fileLocation);
  const decryptStream = createDecryptStream(ENCRYPTION_KEY);
  readStream.on('error', () => { if (!res.headersSent) res.status(500).json({ error: '文件读取失败' }); });
  decryptStream.on('error', () => { if (!res.headersSent) res.status(500).json({ error: '文件解密失败' }); else res.destroy(); });
  readStream.pipe(decryptStream).pipe(res);
});

// ─────────────────────────────────────────────
// 文件上传（加密写入磁盘）
// ─────────────────────────────────────────────
app.post('/upload', authMiddleware, (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: '没有文件被上传' });
  }
  const file = req.files.file;
  const originalFileName = decodeUploadedFileName(file.name);
  const extension = path.extname(originalFileName).toLowerCase() || path.extname(file.name).toLowerCase() || '';

  // 拒绝危险文件类型并提示用户
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return res.status(400).json({
      error: `不允许上传此类型的文件（${extension || '无扩展名'}）。出于安全考虑，禁止上传可执行文件、脚本及服务端代码等危险文件类型。`
    });
  }

  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

  const storedFileName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`;
  const filePath = path.join(FILES_DIR, storedFileName);

  const readable = new Readable();
  readable._read = () => {};
  readable.push(file.data);
  readable.push(null);

  const encryptStream = createEncryptStream(ENCRYPTION_KEY);
  const writeStream = fs.createWriteStream(filePath);

  encryptStream.on('error', (err) => {
    console.error('[上传] 加密出错:', err);
    if (!res.headersSent) res.status(500).json({ error: '文件加密失败' });
  });
  writeStream.on('error', (err) => {
    console.error('[上传] 写入出错:', err);
    if (!res.headersSent) res.status(500).json({ error: '文件保存失败' });
  });
  writeStream.on('finish', () => {
    res.json({
      fileName: originalFileName,
      storedFileName,
      filePath: `/files/${storedFileName}`,
      downloadPath: `/download/${storedFileName}`,
      fileSize: file.size
    });
  });

  readable.pipe(encryptStream).pipe(writeStream);
});

// ─────────────────────────────────────────────
// WebSocket 事件处理
// ─────────────────────────────────────────────
let messages = [];
let onlineUsers = {};

// 消息频率限制：每个 socket 每秒最多 10 个事件
function createSocketRateLimiter() {
  let count = 0;
  let windowStart = Date.now();
  return () => {
    const now = Date.now();
    if (now - windowStart >= 1000) { count = 0; windowStart = now; }
    return ++count <= 10;
  };
}

io.on('connection', (socket) => {
  const rateLimiter = createSocketRateLimiter();

  function rateGuard(handler) {
    return (...args) => {
      if (!rateLimiter()) {
        console.warn(`[安全] Socket ${socket.id} 消息频率超限，断开连接`);
        socket.emit('error', { message: '消息发送过于频繁，已断开连接' });
        socket.disconnect(true);
        return;
      }
      handler(...args);
    };
  }

  console.log('[连接] 用户已连接');
  socket.emit('load messages', messages);
  socket.emit('update online users', Object.values(onlineUsers));

  socket.on('set nickname', rateGuard((nickname) => {
    if (typeof nickname !== 'string') return;
    onlineUsers[socket.id] = nickname.trim().slice(0, 50);
    io.emit('update online users', Object.values(onlineUsers));
  }));

  socket.on('chat message', rateGuard((msg) => {
    if (typeof msg !== 'string') return;
    const message = {
      id: Date.now(),
      nickname: onlineUsers[socket.id] || 'Anonymous',
      message: msg.slice(0, 5000),
      timestamp: Date.now()
    };
    messages.push(message);
    saveMessages(messages);
    io.emit('chat message', message);
  }));

  socket.on('file message', rateGuard((fileData) => {
    if (!fileData || typeof fileData !== 'object') return;
    const message = {
      id: Date.now(),
      nickname: onlineUsers[socket.id] || 'Anonymous',
      type: 'file',
      fileName: (fileData.fileName || '').slice(0, 255),
      filePath: fileData.filePath,
      downloadPath: fileData.downloadPath,
      storedFileName: fileData.storedFileName,
      fileSize: fileData.fileSize,
      timestamp: Date.now(),
      uploadId: fileData.uploadId || null
    };
    if (fileData.storedFileName && fileData.fileName) {
      fileMetaByStoredName.set(fileData.storedFileName, fileData.fileName);
    }
    messages.push(message);
    saveMessages(messages);
    io.emit('file message', message);
  }));

  socket.on('image message', rateGuard((imageData) => {
    if (!imageData || typeof imageData !== 'object') return;
    const message = {
      id: Date.now(),
      nickname: onlineUsers[socket.id] || 'Anonymous',
      type: 'image',
      fileName: (imageData.fileName || '').slice(0, 255),
      filePath: imageData.filePath,
      downloadPath: imageData.downloadPath,
      storedFileName: imageData.storedFileName,
      fileSize: imageData.fileSize,
      timestamp: Date.now()
    };
    messages.push(message);
    saveMessages(messages);
    io.emit('image message', message);
  }));

  socket.on('file upload started', rateGuard((uploadInfo = {}) => {
    if (!uploadInfo.uploadId) return;
    io.emit('file upload started', {
      uploadId: uploadInfo.uploadId,
      fileName: (uploadInfo.fileName || '未命名文件').slice(0, 255),
      fileSize: uploadInfo.fileSize || 0,
      nickname: onlineUsers[socket.id] || 'Anonymous',
      timestamp: Date.now()
    });
  }));

  socket.on('file upload progress', rateGuard((progressInfo = {}) => {
    if (!progressInfo.uploadId || typeof progressInfo.percent !== 'number') return;
    io.emit('file upload progress', {
      uploadId: progressInfo.uploadId,
      percent: Math.max(0, Math.min(100, Math.round(progressInfo.percent))),
      nickname: onlineUsers[socket.id] || 'Anonymous'
    });
  }));

  socket.on('file upload failed', rateGuard((failInfo = {}) => {
    if (!failInfo.uploadId) return;
    io.emit('file upload failed', {
      uploadId: failInfo.uploadId,
      error: (failInfo.error || '上传失败').slice(0, 200),
      nickname: onlineUsers[socket.id] || 'Anonymous'
    });
  }));

  socket.on('delete message', rateGuard((messageId) => {
    const index = messages.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
      const message = messages[index];
      if (message.type === 'file' || message.type === 'image') {
        const storedFileName = message.storedFileName || (message.filePath ? path.basename(message.filePath) : null);
        if (storedFileName) {
          const fp = path.join(FILES_DIR, storedFileName);
          try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
        }
      }
      messages.splice(index, 1);
      saveMessages(messages);
      io.emit('message deleted', messageId);
    }
  }));

  socket.on('disconnect', () => {
    console.log('[连接] 用户已断开');
    delete onlineUsers[socket.id];
    io.emit('update online users', Object.values(onlineUsers));
  });
});

// ─────────────────────────────────────────────
// 定时清理（每分钟）
// ─────────────────────────────────────────────
setInterval(() => {
  const oldLength = messages.length;
  messages = cleanExpiredMessages();
  cleanOrphanedFiles();
  rebuildFileMetaMap();
  if (messages.length !== oldLength) {
    io.emit('load messages', messages);
  }
}, 60 * 1000);

// ─────────────────────────────────────────────
// 启动服务器（需先输入安全码）
// ─────────────────────────────────────────────
(async () => {
  PASSCODE = await promptPasscode();
  if (!PASSCODE) {
    console.error('[错误] 安全码不能为空，服务器退出');
    process.exit(1);
  }
  console.log('[安全] 安全码已设置');

  messages = cleanExpiredMessages();
  cleanOrphanedFiles();
  rebuildFileMetaMap();

  const currentPort = server instanceof https.Server ? HTTPS_PORT : PORT;
  const protocol = server instanceof https.Server ? 'https' : 'http';

  server.keepAliveTimeout = 61000;
  server.headersTimeout = 121000;

  server.listen(currentPort, '0.0.0.0', () => {
    console.log(`[服务器] 运行中: ${protocol}://0.0.0.0:${currentPort}`);
    console.log(`[服务器] 从其他设备访问: ${protocol}://<your-ip>:${currentPort}`);
    if (server instanceof http.Server) {
      console.log('[提示] 如需 HTTPS，请生成 SSL 证书 (key.pem 和 cert.pem)');
    }
  });
})();