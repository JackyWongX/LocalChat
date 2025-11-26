const socket = io();

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesDiv = document.getElementById('messages');
const nicknameInput = document.getElementById('nicknameInput');
const setNicknameButton = document.getElementById('setNicknameButton');
const onlineUsersUl = document.getElementById('onlineUsers');

let currentNickname = '';

// Set nickname
setNicknameButton.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  if (nickname) {
    currentNickname = nickname;
    socket.emit('set nickname', nickname);
    nicknameInput.disabled = true;
    setNicknameButton.disabled = true;
    setNicknameButton.textContent = '已设置';
  }
});

// Send message
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const message = messageInput.value.trim();
  if (message) {
    socket.emit('chat message', message);
    messageInput.value = '';
  }
}

// Receive messages
socket.on('chat message', (msg) => {
  displayMessage(msg);
});

socket.on('load messages', (messages) => {
  messages.forEach(displayMessage);
});

function displayMessage(msg) {
  const isOwnMessage = msg.nickname === currentNickname;
  const messageContainer = document.createElement('div');
  messageContainer.className = `message flex mb-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `rounded-lg p-3 max-w-xs lg:max-w-md ${isOwnMessage ? 'bg-blue-500 text-white' : 'bg-white bg-opacity-30 text-gray-700'}`;
  
  const timestamp = new Date(msg.timestamp).toLocaleString('zh-CN');
  if (isOwnMessage) {
    messageDiv.innerHTML = `
      <p class="mb-1">${msg.message}</p>
      <span class="text-xs opacity-75">${timestamp}</span>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="font-bold text-gray-800 mb-1">${msg.nickname}</div>
      <p class="mb-1">${msg.message}</p>
      <span class="text-xs text-gray-600">${timestamp}</span>
    `;
  }
  
  messageContainer.appendChild(messageDiv);
  messagesDiv.appendChild(messageContainer);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Update online users
socket.on('update online users', (users) => {
  onlineUsersUl.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.className = 'mb-1';
    li.textContent = user;
    onlineUsersUl.appendChild(li);
  });
});