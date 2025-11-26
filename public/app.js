const socket = io();

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesDiv = document.getElementById('messages');
const nicknameInput = document.getElementById('nicknameInput');
const setNicknameButton = document.getElementById('setNicknameButton');
const onlineUsersUl = document.getElementById('onlineUsers');
const fileDropArea = document.getElementById('fileDropArea');
const fileInput = document.getElementById('fileInput');

let currentNickname = '';

function generateRandomNickname() {
  const adjectives = ['快乐的', '聪明的', '勇敢的', '温柔的', '活泼的', '神秘的', '阳光的', '文艺的'];
  const nouns = ['小猫', '小狗', '小兔', '小熊', '小鸟', '小鱼', '小鹿', '小猴'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}

// Initialize nickname
function initializeNickname() {
  let storedNickname = localStorage.getItem('chatNickname');
  if (!storedNickname) {
    storedNickname = generateRandomNickname();
    localStorage.setItem('chatNickname', storedNickname);
  }
  currentNickname = storedNickname;
  nicknameInput.value = currentNickname;
  nicknameInput.disabled = true;
  setNicknameButton.textContent = '修改昵称';
  socket.emit('set nickname', currentNickname);
}

// Modify nickname
setNicknameButton.addEventListener('click', () => {
  if (nicknameInput.disabled) {
    // Enable editing
    nicknameInput.disabled = false;
    setNicknameButton.textContent = '保存';
    nicknameInput.focus();
  } else {
    // Save new nickname
    const newNickname = nicknameInput.value.trim();
    if (newNickname && newNickname !== currentNickname) {
      currentNickname = newNickname;
      localStorage.setItem('chatNickname', currentNickname);
      socket.emit('set nickname', currentNickname);
    }
    nicknameInput.disabled = true;
    setNicknameButton.textContent = '修改昵称';
  }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializeNickname);

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

// File handling
function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  fetch('/upload', {
    method: 'POST',
    body: formData
  })
  .then(response => response.json())
  .then(data => {
    socket.emit('file message', data);
  })
  .catch(error => {
    console.error('File upload error:', error);
  });
}

// File drop area events
fileDropArea.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const files = e.target.files;
  for (let file of files) {
    uploadFile(file);
  }
  fileInput.value = '';
});

fileDropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileDropArea.classList.add('border-blue-500', 'bg-blue-50');
});

fileDropArea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  fileDropArea.classList.remove('border-blue-500', 'bg-blue-50');
});

fileDropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDropArea.classList.remove('border-blue-500', 'bg-blue-50');
  const files = e.dataTransfer.files;
  for (let file of files) {
    uploadFile(file);
  }
});

// Receive messages
socket.on('chat message', (msg) => {
  displayMessage(msg);
});

socket.on('file message', (msg) => {
  displayFileMessage(msg);
});

socket.on('load messages', (messages) => {
  messages.forEach(msg => {
    if (msg.type === 'file') {
      displayFileMessage(msg);
    } else {
      displayMessage(msg);
    }
  });
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

function displayFileMessage(msg) {
  const isOwnMessage = msg.nickname === currentNickname;
  const messageContainer = document.createElement('div');
  messageContainer.className = `message flex mb-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;

  const messageDiv = document.createElement('div');
  messageDiv.className = `rounded-lg p-3 max-w-xs lg:max-w-md ${isOwnMessage ? 'bg-blue-500 text-white' : 'bg-white bg-opacity-30 text-gray-700'}`;

  const timestamp = new Date(msg.timestamp).toLocaleString('zh-CN');
  const fileSizeMB = (msg.fileSize / (1024 * 1024)).toFixed(2);

  if (isOwnMessage) {
    messageDiv.innerHTML = `
      <div class="mb-1">📎 ${msg.fileName}</div>
      <div class="text-xs opacity-75 mb-1">${fileSizeMB} MB</div>
      <a href="${msg.filePath}" download class="text-xs underline opacity-75">下载</a>
      <div class="text-xs opacity-75 mt-1">${timestamp}</div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="font-bold text-gray-800 mb-1">${msg.nickname}</div>
      <div class="mb-1">📎 ${msg.fileName}</div>
      <div class="text-xs text-gray-600 mb-1">${fileSizeMB} MB</div>
      <a href="${msg.filePath}" download class="text-xs underline text-blue-600">下载</a>
      <div class="text-xs text-gray-600 mt-1">${timestamp}</div>
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