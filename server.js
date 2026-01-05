const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const fileUpload = require('express-fileupload');
const cors = require('cors');

const app = express();

app.use(cors());

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

const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const EXPIRY_DAYS = 3;

const fileMetaByStoredName = new Map();

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
  const expiredMessages = messages.filter(msg => now - msg.timestamp >= expiryTime);
  messages = messages.filter(msg => now - msg.timestamp < expiryTime);

  // Delete expired files
  expiredMessages.forEach(msg => {
    if (msg.type === 'file' && msg.storedFileName) {
      const filePath = path.join(__dirname, 'data', 'files', msg.storedFileName);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Deleted expired file: ${filePath}`);
        }
      } catch (err) {
        console.error(`Failed to delete file ${filePath}:`, err);
      }
    }
  });

  saveMessages(messages);
  return messages;
}

function decodeUploadedFileName(rawName = '') {
  if (!rawName) return rawName;
  const buffer = Buffer.from(rawName, 'latin1');
  const utf8Name = buffer.toString('utf8');
  return utf8Name.includes('\uFFFD') ? rawName : utf8Name;
}

function rebuildFileMetaMap() {
  fileMetaByStoredName.clear();
  messages.forEach(msg => {
    if (msg.type === 'file' && msg.fileName) {
      const storedName = msg.storedFileName || path.basename(msg.downloadPath || msg.filePath || '');
      if (storedName) {
        fileMetaByStoredName.set(storedName, msg.fileName);
      }
    }
  });
}

let messages = cleanExpiredMessages();
let onlineUsers = {};
rebuildFileMetaMap();

app.use(fileUpload());
app.use(express.static('public'));
app.use('/files', express.static(path.join(__dirname, 'data', 'files')));

app.get('/download/:storedFileName', (req, res) => {
  const storedFileName = path.basename(req.params.storedFileName);
  const fileLocation = path.join(__dirname, 'data', 'files', storedFileName);

  if (!fs.existsSync(fileLocation)) {
    return res.status(404).send('文件不存在');
  }

  const originalFileName = fileMetaByStoredName.get(storedFileName) || storedFileName;

  // Use sendFile with manual header to ensure better compatibility with Chinese filenames
  // and avoid potential issues with res.download in some environments
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalFileName)}`);

  res.sendFile(fileLocation, (err) => {
    if (err) {
      console.error('File download error:', err);
      if (!res.headersSent) {
        res.status(500).send('文件下载失败');
      }
    }
  });
});

// File upload route
app.post('/upload', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const file = req.files.file;
  const originalFileName = decodeUploadedFileName(file.name);
  const extension = path.extname(originalFileName) || path.extname(file.name) || '';
  const storedFileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
  const filePath = path.join(__dirname, 'data', 'files', storedFileName);

  file.mv(filePath, (err) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.json({
      fileName: originalFileName,
      storedFileName,
      filePath: `/files/${storedFileName}`,
      downloadPath: `/download/${storedFileName}`,
      fileSize: file.size
    });
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

  socket.on('delete message', (messageId) => {
    const index = messages.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
      const message = messages[index];
      // Delete associated file if it's a file or image message
      if ((message.type === 'file' || message.type === 'image') && message.storedFileName) {
        const filePath = path.join(__dirname, 'data', 'files', message.storedFileName);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted file: ${filePath}`);
          }
        } catch (err) {
          console.error(`Failed to delete file ${filePath}:`, err);
        }
      }
      messages.splice(index, 1);
      saveMessages(messages);
      io.emit('message deleted', messageId);
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    delete onlineUsers[socket.id];
    io.emit('update online users', Object.values(onlineUsers));
  });
});

// Clean expired messages every minute
setInterval(() => {
  const oldLength = messages.length;
  messages = cleanExpiredMessages();
  rebuildFileMetaMap();
  if (messages.length !== oldLength) {
    io.emit('load messages', messages); // Broadcast updated messages to all clients
  }
}, 60 * 1000);

const currentPort = server instanceof https.Server ? HTTPS_PORT : PORT;
const protocol = server instanceof https.Server ? 'https' : 'http';

server.listen(currentPort, '0.0.0.0', () => {
  console.log(`Server running on ${protocol}://0.0.0.0:${currentPort}`);
  console.log(`Access from other devices using ${protocol}://<your-ip>:${currentPort}`);
  if (server instanceof http.Server) {
    console.log('To enable HTTPS, generate SSL certificates (key.pem and cert.pem)');
  }
});

// Increase Keep-Alive timeout to prevent "Network Error" on downloads
// when the browser tries to reuse an idle connection that the server has closed.
server.keepAliveTimeout = 120000 * 100; // 2 minutes
server.headersTimeout = 121000 * 100;   // Must be greater than keepAliveTimeout