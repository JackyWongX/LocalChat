const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3001;
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

app.use(express.static('public'));

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

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    delete onlineUsers[socket.id];
    io.emit('update online users', Object.values(onlineUsers));
  });
});

// Clean expired messages every hour
setInterval(cleanExpiredMessages, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});