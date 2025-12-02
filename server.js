const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const fileUpload = require('express-fileupload');

const app = express();

// Check if SSL certificates exist
let server;
const PORT = 3001;
const HTTPS_PORT = 3443;

try {
  const key = fs.readFileSync('key.pem');
  const cert = fs.readFileSync('cert.pem');
  server = https.createServer({ key, cert }, app);
  console.log('Using HTTPS');
} catch (err) {
  server = http.createServer(app);
  console.log('Using HTTP (SSL certificates not found)');
}

const io = socketIo(server);

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const EXPIRY_DAYS = 7;

// Load messages from file
function loadMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Save messages to file
function saveMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Clean up expired messages
function cleanExpiredMessages() {
  const now = Date.now();
  const expiryTime = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  let messages = loadMessages();
  messages = messages.filter(msg => now - msg.timestamp < expiryTime);
  saveMessages(messages);
  return messages;
}

let messages = cleanExpiredMessages();
let onlineUsers = {};

app.use(fileUpload());
app.use(express.static('public'));

// File upload route
app.post('/upload', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const file = req.files.file;
  const fileName = Date.now() + '_' + file.name;
  const filePath = path.join(__dirname, 'public', 'files', fileName);

  file.mv(filePath, (err) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.json({ fileName: file.name, filePath: `/files/${fileName}`, fileSize: file.size });
  });
});

io.on('connection', (socket) => {
  console.log('A user connected');

  // Send current messages and online users
  socket.emit('load messages', messages);
  socket.emit('update online users', Object.values(onlineUsers));

  socket.on('set nickname', (nickname) => {
    onlineUsers[socket.id] = nickname;
    io.emit('update online users', Object.values(onlineUsers));
  });

  socket.on('chat message', (msg) => {
    const message = {
      id: Date.now(),
      nickname: onlineUsers[socket.id] || 'Anonymous',
      message: msg,
      timestamp: Date.now()
    };
    messages.push(message);
    saveMessages(messages);
    io.emit('chat message', message);
  });

  socket.on('file message', (fileData) => {
    const message = {
      id: Date.now(),
      nickname: onlineUsers[socket.id] || 'Anonymous',
      type: 'file',
      fileName: fileData.fileName,
      filePath: fileData.filePath,
      fileSize: fileData.fileSize,
      timestamp: Date.now(),
      uploadId: fileData.uploadId || null
    };
    messages.push(message);
    saveMessages(messages);
    io.emit('file message', message);
  });

  socket.on('image message', (imageData) => {
    const message = {
      id: Date.now(),
      nickname: onlineUsers[socket.id] || 'Anonymous',
      type: 'image',
      fileName: imageData.fileName,
      filePath: imageData.filePath,
      fileSize: imageData.fileSize,
      timestamp: Date.now()
    };
    messages.push(message);
    saveMessages(messages);
    io.emit('image message', message);
  });

  socket.on('file upload started', (uploadInfo = {}) => {
    if (!uploadInfo.uploadId) return;
    const payload = {
      uploadId: uploadInfo.uploadId,
      fileName: uploadInfo.fileName || '未命名文件',
      fileSize: uploadInfo.fileSize || 0,
      nickname: onlineUsers[socket.id] || 'Anonymous',
      timestamp: Date.now()
    };
    io.emit('file upload started', payload);
  });

  socket.on('file upload progress', (progressInfo = {}) => {
    if (!progressInfo.uploadId || typeof progressInfo.percent !== 'number') return;
    const percent = Math.max(0, Math.min(100, Math.round(progressInfo.percent)));
    const payload = {
      uploadId: progressInfo.uploadId,
      percent,
      nickname: onlineUsers[socket.id] || 'Anonymous'
    };
    io.emit('file upload progress', payload);
  });

  socket.on('file upload failed', (failInfo = {}) => {
    if (!failInfo.uploadId) return;
    const payload = {
      uploadId: failInfo.uploadId,
      error: failInfo.error || '上传失败',
      nickname: onlineUsers[socket.id] || 'Anonymous'
    };
    io.emit('file upload failed', payload);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    delete onlineUsers[socket.id];
    io.emit('update online users', Object.values(onlineUsers));
  });
});

// Clean expired messages every hour
setInterval(cleanExpiredMessages, 60 * 60 * 1000);

const currentPort = server instanceof https.Server ? HTTPS_PORT : PORT;
const protocol = server instanceof https.Server ? 'https' : 'http';

server.listen(currentPort, () => {
  console.log(`Server running on ${protocol}://localhost:${currentPort}`);
  if (server instanceof http.Server) {
    console.log('To enable HTTPS, generate SSL certificates (key.pem and cert.pem)');
  }
});