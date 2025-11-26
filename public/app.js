const socket = io();

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesDiv = document.getElementById('messages');
const nicknameInput = document.getElementById('nicknameInput');
const setNicknameButton = document.getElementById('setNicknameButton');
const onlineUsersUl = document.getElementById('onlineUsers');
const dragOverlay = document.getElementById('dragOverlay');

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

// Global drag and drop events
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  dragOverlay.style.opacity = '1';
  dragOverlay.style.pointerEvents = 'auto';
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  // Only hide if leaving the document
  if (e.clientX === 0 && e.clientY === 0) {
    dragOverlay.style.opacity = '0';
    dragOverlay.style.pointerEvents = 'none';
  }
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragOverlay.style.opacity = '0';
  dragOverlay.style.pointerEvents = 'none';
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
  messageContainer.className = `message flex mb-3 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;

  const messageDiv = document.createElement('div');
  messageDiv.className = `rounded-xl p-4 max-w-xs lg:max-w-md shadow-lg ${isOwnMessage ? 'bg-blue-500 text-white' : 'bg-white text-gray-800'}`;

  const timestamp = new Date(msg.timestamp).toLocaleString('zh-CN');
  const fileSizeMB = (msg.fileSize / (1024 * 1024)).toFixed(2);
  const fileExtension = msg.fileName.split('.').pop().toLowerCase();

  // 文件图标映射
  const fileIcons = {
    'pdf': '📄',
    'doc': '📝', 'docx': '📝',
    'xls': '📊', 'xlsx': '📊',
    'ppt': '📽️', 'pptx': '📽️',
    'txt': '📄',
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
    'mp4': '🎥', 'avi': '🎥', 'mov': '🎥',
    'mp3': '🎵', 'wav': '🎵',
    'zip': '📦', 'rar': '📦'
  };
  const fileIcon = fileIcons[fileExtension] || '📎';

  if (isOwnMessage) {
    messageDiv.innerHTML = `
      <div class="flex items-center space-x-3">
        <div class="text-2xl">${fileIcon}</div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm truncate">${msg.fileName}</div>
          <div class="text-xs opacity-75">${fileSizeMB} MB</div>
        </div>
      </div>
      <div class="mt-3 flex justify-between items-center">
        <a href="${msg.filePath}" download="${msg.fileName}" class="text-xs bg-white bg-opacity-20 hover:bg-opacity-30 px-3 py-1 rounded-full transition duration-200 inline-flex items-center space-x-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m-3 3V4"></path>
          </svg>
          <span>下载</span>
        </a>
        <div class="text-xs opacity-75">${timestamp}</div>
      </div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="mb-2">
        <div class="font-bold text-sm text-gray-600">${msg.nickname}</div>
      </div>
      <div class="flex items-center space-x-3">
        <div class="text-2xl">${fileIcon}</div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm truncate">${msg.fileName}</div>
          <div class="text-xs text-gray-500">${fileSizeMB} MB</div>
        </div>
      </div>
      <div class="mt-3 flex justify-between items-center">
        <a href="${msg.filePath}" download="${msg.fileName}" class="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-full transition duration-200 inline-flex items-center space-x-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m-3 3V4"></path>
          </svg>
          <span>下载</span>
        </a>
        <div class="text-xs text-gray-500">${timestamp}</div>
      </div>
    `;
  }

  messageContainer.appendChild(messageDiv);
  messagesDiv.appendChild(messageContainer);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}// Update online users
socket.on('update online users', (users) => {
  onlineUsersUl.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.className = 'mb-1';
    li.textContent = user;
    onlineUsersUl.appendChild(li);
  });
});