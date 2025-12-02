const socket = io();

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesDiv = document.getElementById('messages');
const nicknameInput = document.getElementById('nicknameInput');
const setNicknameButton = document.getElementById('setNicknameButton');
const onlineUsersUl = document.getElementById('onlineUsers');
const dragOverlay = document.getElementById('dragOverlay');

let currentNickname = '';
const uploadPlaceholders = new Map();

function generateRandomNickname() {
  const adjectives = ['快乐的', '聪明的', '勇敢的', '温柔的', '活泼的', '神秘的', '阳光的', '文艺的'];
  const nouns = ['小猫', '小狗', '小兔', '小熊', '小鸟', '小鱼', '小鹿', '小猴'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`;
}

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

document.addEventListener('DOMContentLoaded', initializeNickname);

setNicknameButton.addEventListener('click', () => {
  if (nicknameInput.disabled) {
    nicknameInput.disabled = false;
    setNicknameButton.textContent = '保存';
    nicknameInput.focus();
  } else {
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

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const message = messageInput.value;
  if (!message.trim()) return;
  socket.emit('chat message', message);
  messageInput.value = '';
}

function generateUploadId() {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uploadFile(file) {
  const uploadId = generateUploadId();
  socket.emit('file upload started', {
    uploadId,
    fileName: file.name,
    fileSize: file.size
  });

  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload');

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    socket.emit('file upload progress', { uploadId, percent });
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        socket.emit('file upload progress', { uploadId, percent: 100 });
        socket.emit('file message', { ...data, uploadId });
      } catch (error) {
        socket.emit('file upload failed', { uploadId, error: '文件响应解析失败' });
      }
    } else {
      socket.emit('file upload failed', { uploadId, error: '上传失败，请重试' });
    }
  };

  xhr.onerror = () => {
    socket.emit('file upload failed', { uploadId, error: '网络异常，上传失败' });
  };

  xhr.send(formData);
}

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  dragOverlay.style.opacity = '1';
  dragOverlay.style.pointerEvents = 'auto';
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (e.target === document.body || (e.clientX === 0 && e.clientY === 0)) {
    dragOverlay.style.opacity = '0';
    dragOverlay.style.pointerEvents = 'none';
  }
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragOverlay.style.opacity = '0';
  dragOverlay.style.pointerEvents = 'none';
  const files = e.dataTransfer.files;
  Array.from(files).forEach(uploadFile);
});

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

socket.on('file upload started', (payload) => {
  renderUploadPlaceholder(payload);
});

socket.on('file upload progress', (payload) => {
  updateUploadProgress(payload);
});

socket.on('file upload failed', (payload) => {
  handleUploadFailure(payload);
});

socket.on('update online users', (users) => {
  onlineUsersUl.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.className = 'mb-1';
    li.textContent = user;
    onlineUsersUl.appendChild(li);
  });
});

function displayMessage(msg) {
  const element = createTextMessageElement(msg);
  messagesDiv.appendChild(element);
  scrollMessagesToBottom();
}

function createTextMessageElement(msg) {
  const isOwnMessage = msg.nickname === currentNickname;
  const container = document.createElement('div');
  container.className = `message flex mb-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'rounded-lg p-3 max-w-xs lg:max-w-md bg-white bg-opacity-30 text-gray-700';

  // 第一行：昵称 + 时间，字体小
  const headerDiv = document.createElement('div');
  headerDiv.className = 'text-xs opacity-75 mb-1 flex items-center justify-between px-2';

  const nicknameSpan = document.createElement('span');
  nicknameSpan.className = 'font-semibold';
  nicknameSpan.textContent = isOwnMessage ? '我' : msg.nickname;
  headerDiv.appendChild(nicknameSpan);

  const separator = document.createElement('span');
  separator.className = 'mx-2';
  separator.textContent = '·';
  headerDiv.appendChild(separator);

  const timestampSpan = document.createElement('span');
  timestampSpan.textContent = formatTimestamp(msg.timestamp);
  headerDiv.appendChild(timestampSpan);

  messageDiv.appendChild(headerDiv);

  // 第二行：消息内容，字体大
  appendMessageContent(messageDiv, msg.message || '');

  container.appendChild(messageDiv);
  return container;
}

function appendMessageContent(wrapper, text) {
  const codeBlock = parseCodeBlock(text);
  if (codeBlock) {
    const label = document.createElement('div');
    label.className = 'text-xs uppercase tracking-widest opacity-70';
    label.textContent = codeBlock.lang || 'CODE';
    wrapper.appendChild(label);

    const pre = document.createElement('pre');
    pre.className = 'code-block mt-2 text-lg';
    pre.textContent = codeBlock.code;
    wrapper.appendChild(pre);
    return;
  }

  if (text.includes('\n')) {
    const pre = document.createElement('pre');
    pre.className = 'whitespace-pre-wrap break-words text-lg';
    pre.textContent = text;
    wrapper.appendChild(pre);
    return;
  }

  const paragraph = document.createElement('p');
  paragraph.className = 'mb-2 break-words text-lg';
  paragraph.textContent = text;
  wrapper.appendChild(paragraph);
}

function parseCodeBlock(content) {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```')) return null;

  const inner = trimmed.slice(3, -3);
  const firstNewline = inner.indexOf('\n');
  let lang = '';
  let code = inner;

  if (firstNewline !== -1) {
    lang = inner.slice(0, firstNewline).trim();
    code = inner.slice(firstNewline + 1);
  }

  return { lang, code };
}

function displayFileMessage(msg) {
  const element = createFileMessageElement(msg);
  const placeholder = msg.uploadId ? uploadPlaceholders.get(msg.uploadId) : null;
  if (placeholder) {
    placeholder.container.replaceWith(element);
    uploadPlaceholders.delete(msg.uploadId);
  } else {
    messagesDiv.appendChild(element);
  }
  scrollMessagesToBottom();
}

function createFileMessageElement(msg) {
  const isOwnMessage = msg.nickname === currentNickname;
  const container = document.createElement('div');
  container.className = `message flex mb-3 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;

  const wrapper = document.createElement('div');
  wrapper.className = 'rounded-xl p-4 max-w-xs lg:max-w-md bg-white bg-opacity-30 text-gray-700';

  if (!isOwnMessage) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'font-bold text-sm text-gray-600 mb-2';
    nameDiv.textContent = msg.nickname;
    wrapper.appendChild(nameDiv);
  }

  const tile = document.createElement('div');
  tile.className = 'flex items-center space-x-3';

  const iconDiv = document.createElement('div');
  iconDiv.className = 'text-2xl';
  iconDiv.textContent = getFileIcon(msg.fileName);
  tile.appendChild(iconDiv);

  const metaDiv = document.createElement('div');
  metaDiv.className = 'flex-1 min-w-0';

  const fileName = document.createElement('div');
  fileName.className = 'font-medium text-sm truncate';
  fileName.textContent = msg.fileName;
  metaDiv.appendChild(fileName);

  const size = document.createElement('div');
  size.className = 'text-xs text-gray-500';
  size.textContent = formatFileSize(msg.fileSize);
  metaDiv.appendChild(size);

  tile.appendChild(metaDiv);
  wrapper.appendChild(tile);

  const footer = document.createElement('div');
  footer.className = 'mt-3 flex justify-between items-center';

  const link = document.createElement('a');
  link.href = msg.filePath;
  link.download = msg.fileName;
  link.textContent = '下载';
  link.className = 'text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-full transition duration-200';
  footer.appendChild(link);

  const time = document.createElement('div');
  time.className = 'text-xs text-gray-500';
  time.textContent = formatTimestamp(msg.timestamp);
  footer.appendChild(time);

  wrapper.appendChild(footer);
  container.appendChild(wrapper);

  return container;
}

function getFileIcon(fileName = '') {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const icons = {
    pdf: '📄',
    doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊',
    ppt: '📽️', pptx: '📽️',
    txt: '📄',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
    mp4: '🎥', avi: '🎥', mov: '🎥',
    mp3: '🎵', wav: '🎵',
    zip: '📦', rar: '📦'
  };
  return icons[extension] || '📎';
}

function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '';
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024)
    return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function scrollMessagesToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderUploadPlaceholder(payload) {
  if (!payload.uploadId) return;
  const placeholder = createUploadPlaceholderElement(payload);
  uploadPlaceholders.set(payload.uploadId, placeholder);
  messagesDiv.appendChild(placeholder.container);
  scrollMessagesToBottom();
}

function createUploadPlaceholderElement(payload) {
  const isOwn = payload.nickname === currentNickname;
  const container = document.createElement('div');
  container.className = `message flex mb-3 ${isOwn ? 'justify-end' : 'justify-start'}`;

  const wrapper = document.createElement('div');
  wrapper.className = `rounded-xl p-4 max-w-xs lg:max-w-md shadow-inner ${isOwn ? 'bg-blue-500 text-white' : 'bg-white text-gray-800'}`;

  if (!isOwn) {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'font-bold text-sm text-gray-600 mb-2';
    nameDiv.textContent = payload.nickname;
    wrapper.appendChild(nameDiv);
  }

  const title = document.createElement('div');
  title.className = 'font-medium text-sm truncate';
  title.textContent = payload.fileName;
  wrapper.appendChild(title);

  const size = document.createElement('div');
  size.className = `text-xs ${isOwn ? 'opacity-80' : 'text-gray-500'}`;
  size.textContent = formatFileSize(payload.fileSize);
  wrapper.appendChild(size);

  const track = document.createElement('div');
  track.className = 'w-full h-2 rounded-full bg-black bg-opacity-20 mt-3';

  const bar = document.createElement('div');
  bar.className = `${isOwn ? 'bg-white' : 'bg-blue-500'} h-2 rounded-full transition-all duration-200`;
  bar.style.width = `${payload.percent || 0}%`;
  track.appendChild(bar);
  wrapper.appendChild(track);

  const status = document.createElement('div');
  status.className = `text-xs mt-2 ${isOwn ? 'opacity-80' : 'text-gray-600'}`;
  status.textContent = `上传中... ${payload.percent || 0}%`;
  wrapper.appendChild(status);

  container.appendChild(wrapper);
  return { container, progressBar: bar, statusText: status };
}

function updateUploadProgress(payload) {
  const placeholder = uploadPlaceholders.get(payload.uploadId);
  if (!placeholder) return;
  placeholder.progressBar.style.width = `${payload.percent}%`;
  placeholder.statusText.textContent = `上传中... ${payload.percent}%`;
}

function handleUploadFailure(payload) {
  const placeholder = uploadPlaceholders.get(payload.uploadId);
  if (!placeholder) return;
  placeholder.progressBar.style.width = '100%';
  placeholder.progressBar.classList.add('bg-red-500');
  placeholder.statusText.textContent = payload.error || '上传失败';
  placeholder.statusText.classList.remove('text-gray-600');
  placeholder.statusText.classList.add('text-red-600');
  setTimeout(() => {
    placeholder.container.remove();
    uploadPlaceholders.delete(payload.uploadId);
  }, 5000);
}
