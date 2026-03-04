console.log('LocalChat client script loaded');
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.message || e.error, e.error || e);
});

const socket = io();

const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesDiv = document.getElementById('messages');
const nicknameInput = document.getElementById('nicknameInput');
const setNicknameButton = document.getElementById('setNicknameButton');
const dragOverlay = document.getElementById('dragOverlay');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const closeModal = document.getElementById('closeModal');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const zoomReset = document.getElementById('zoomReset');
const contextMenu = document.getElementById('contextMenu');
const deleteMessageBtn = document.getElementById('deleteMessageBtn');

let currentNickname = '';
const uploadPlaceholders = new Map();

// Request notification permission on page load
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

function showNotification(msg) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    const title = `${msg.nickname} 发送了消息`;
    let body = '';
    if (msg.message) {
      body = msg.message;
    } else if (msg.type === 'file') {
      body = `发送了文件: ${msg.fileName}`;
    } else if (msg.type === 'image') {
      body = '发送了图片';
    }
    const notification = new Notification(title, {
      body: body
    });
    // Auto close after 5 seconds
    setTimeout(() => notification.close(), 5000);
  }
}

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

document.addEventListener('DOMContentLoaded', () => {
  initializeNickname();

  // Initialize drag and drop handlers
  enableGlobalDrag();
});

if (setNicknameButton) {
  setNicknameButton.addEventListener('click', () => {
    if (nicknameInput && nicknameInput.disabled) {
      nicknameInput.disabled = false;
      setNicknameButton.textContent = '保存';
      nicknameInput.focus();
    } else if (nicknameInput) {
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
}

if (sendButton) sendButton.addEventListener('click', sendMessage);
if (messageInput) {
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

if (messageInput) messageInput.addEventListener('paste', handlePaste);

function handlePaste(e) {
  const items = e.clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      const file = items[i].getAsFile();
      uploadImage(file);
      return;
    }
  }
}

function uploadImage(file) {
  if (!currentNickname) {
    initializeNickname(); // Ensure nickname is set before uploading
  }
  // Create a blob with a filename
  const imageFile = new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });

  const formData = new FormData();
  formData.append('file', imageFile);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload');

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        socket.emit('image message', { ...data });
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
  };

  xhr.send(formData);
}

function sendMessage() {
  const message = messageInput.value;
  if (!message.trim()) return;
  if (!currentNickname) {
    initializeNickname(); // Ensure nickname is set before sending
  }
  socket.emit('chat message', message);
  messageInput.value = '';
}

function generateUploadId() {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function linkify(text) {
  // 先对 HTML 进行转义以防止 XSS
  const div = document.createElement('div');
  div.textContent = text;
  const escapedText = div.innerHTML;

  // 正则表达式匹配链接，更加精准地处理边界字符（如中文标点符号）
  const urlRegex = /https?:\/\/[^\s\u4e00-\u9fa5\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g;
  return escapedText.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline break-all">${url}</a>`;
  });
}

function uploadFile(file) {
  if (!currentNickname) {
    initializeNickname(); // Ensure nickname is set before uploading
  }
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

socket.on('chat message', (msg) => {
  displayMessage(msg);
  if (msg.nickname !== currentNickname) {
    showNotification(msg);
  }
});

socket.on('file message', (msg) => {
  displayFileMessage(msg);
  if (msg.nickname !== currentNickname) {
    showNotification(msg);
  }
});

socket.on('image message', (msg) => {
  displayImageMessage(msg);
  if (msg.nickname !== currentNickname) {
    showNotification(msg);
  }
});

socket.on('load messages', (messages) => {
  messagesDiv.innerHTML = ''; // Clear existing messages
  messages.forEach(msg => {
    if (msg.type === 'file') {
      displayFileMessage(msg);
    } else if (msg.type === 'image') {
      displayImageMessage(msg);
    } else {
      displayMessage(msg);
    }
  });
  scrollMessagesToBottom();
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

// 在线用户显示已移除 — 不再处理 'update online users' 事件

function displayMessage(msg) {
  const element = createTextMessageElement(msg);
  messagesDiv.appendChild(element);
  scrollMessagesToBottom();
}

function createTextMessageElement(msg) {
  const isOwnMessage = msg.nickname === currentNickname;
  const container = document.createElement('div');
  container.className = `message flex mb-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;
  container.setAttribute('data-message-id', msg.id);
  container.addEventListener('contextmenu', (e) => showContextMenu(e, msg.id));

  const messageDiv = document.createElement('div');
  messageDiv.className = 'rounded-lg p-3 max-w-lg lg:max-w-3xl bg-white bg-opacity-30 text-gray-700';

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
    // 对于多行文本也要经过 linkify 处理，但需要小心换行符
    // 为简单起见，这里先转义 HTML，再处理链接，最后处理换行
    const div = document.createElement('div');
    div.textContent = text;
    let processed = div.innerHTML;

    // 同样使用新的正则表达式
    const urlRegex = /https?:\/\/[^\s\u4e00-\u9fa5\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g;
    processed = processed.replace(urlRegex, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline break-all">${url}</a>`;
    });

    pre.innerHTML = processed;
    wrapper.appendChild(pre);
    return;
  }

  const paragraph = document.createElement('p');
  paragraph.className = 'mb-2 break-words text-lg';
  paragraph.innerHTML = linkify(text);
  wrapper.appendChild(paragraph);
}

function displayImageMessage(msg) {
  const element = createImageMessageElement(msg);
  messagesDiv.appendChild(element);
  scrollMessagesToBottom();
}

function createImageMessageElement(msg) {
  const isOwnMessage = msg.nickname === currentNickname;
  const container = document.createElement('div');
  container.className = `message flex mb-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`;
  container.setAttribute('data-message-id', msg.id);
  container.addEventListener('contextmenu', (e) => showContextMenu(e, msg.id));

  const messageDiv = document.createElement('div');
  messageDiv.className = 'rounded-lg p-3 max-w-lg lg:max-w-3xl bg-white bg-opacity-30 text-gray-700';

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

  // 图片
  const img = document.createElement('img');
  img.src = msg.filePath;
  img.className = 'max-w-full h-auto rounded cursor-pointer mt-1';
  img.onclick = () => openImageModal(msg.filePath);
  messageDiv.appendChild(img);

  container.appendChild(messageDiv);
  return container;
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
  container.setAttribute('data-message-id', msg.id);
  container.addEventListener('contextmenu', (e) => showContextMenu(e, msg.id));

  const wrapper = document.createElement('div');
  wrapper.className = 'rounded-xl p-4 max-w-lg lg:max-w-3xl bg-white bg-opacity-30 text-gray-700';

  // 第一行：昵称 + 时间，字体小
  const headerDiv = document.createElement('div');
  headerDiv.className = 'text-xs opacity-75 mb-2 flex items-center justify-between px-2';

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

  wrapper.appendChild(headerDiv);

  const tile = document.createElement('div');
  tile.className = 'flex items-center justify-between';

  const leftDiv = document.createElement('div');
  leftDiv.className = 'flex items-center space-x-3 flex-1 min-w-0';

  const iconDiv = document.createElement('div');
  iconDiv.className = 'text-2xl';
  iconDiv.textContent = getFileIcon(msg.fileName);
  leftDiv.appendChild(iconDiv);

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

  leftDiv.appendChild(metaDiv);
  tile.appendChild(leftDiv);

  const link = document.createElement('a');
  const downloadHref = msg.downloadPath || msg.filePath;
  link.href = downloadHref;
  // 移除 target="_blank"，因为它在某些浏览器中会导致下载时出现“网络问题”
  // 同时由于服务器已经设置了 Content-Disposition，浏览器会自动处理下载
  link.textContent = '下载';
  link.className = 'text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-full transition duration-200 ml-2';
  tile.appendChild(link);

  wrapper.appendChild(tile);

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

// Image modal functionality
const dragOverHandler = (e) => {
  e.preventDefault();
  dragOverlay.style.opacity = '1';
  dragOverlay.style.pointerEvents = 'auto';
};

const dragLeaveHandler = (e) => {
  e.preventDefault();
  if (e.target === document.body || (e.clientX === 0 && e.clientY === 0)) {
    dragOverlay.style.opacity = '0';
    dragOverlay.style.pointerEvents = 'none';
  }
};

const dropHandler = (e) => {
  e.preventDefault();
  dragOverlay.style.opacity = '0';
  dragOverlay.style.pointerEvents = 'none';
  const files = e.dataTransfer.files;
  Array.from(files).forEach(uploadFile);
};

function disableGlobalDrag() {
  document.removeEventListener('dragover', dragOverHandler);
  document.removeEventListener('dragleave', dragLeaveHandler);
  document.removeEventListener('drop', dropHandler);
}

function enableGlobalDrag() {
  // 先移除再添加，防止重复绑定
  disableGlobalDrag();
  document.addEventListener('dragover', dragOverHandler);
  document.addEventListener('dragleave', dragLeaveHandler);
  document.addEventListener('drop', dropHandler);
}

function updateImageTransform() {
  modalImage.style.transform = `scale(${currentZoom}) translate(${imageStartX}px, ${imageStartY}px)`;
}

function resetImageView() {
  currentZoom = 1;
  imageStartX = 0;
  imageStartY = 0;
  updateImageTransform();
}

if (closeModal) closeModal.addEventListener('click', () => {
  imageModal.style.opacity = '0';
  imageModal.style.pointerEvents = 'none';
  resetImageView();
  enableGlobalDrag();
});

if (imageModal) imageModal.addEventListener('click', (e) => {
  if (e.target === imageModal) {
    imageModal.style.opacity = '0';
    imageModal.style.pointerEvents = 'none';
    resetImageView();
    enableGlobalDrag();
  }
});

if (zoomIn) zoomIn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  currentZoom = Math.min(currentZoom * 1.2, 5);
  updateImageTransform();
});

if (zoomOut) zoomOut.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  currentZoom = Math.max(currentZoom / 1.2, 0.1);
  updateImageTransform();
});

if (zoomReset) zoomReset.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetImageView();
});

if (modalImage) {
  modalImage.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) {
      currentZoom = Math.min(currentZoom * 1.1, 5);
    } else {
      currentZoom = Math.max(currentZoom / 1.1, 0.1);
    }
    updateImageTransform();
  });

  modalImage.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentZoom > 1) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      modalImage.style.cursor = 'grabbing';
    }
  });
}

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    imageStartX += deltaX / currentZoom;
    imageStartY += deltaY / currentZoom;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    updateImageTransform();
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    modalImage.style.cursor = currentZoom > 1 ? 'grab' : 'move';
  }
});

function openImageModal(src) {
  modalImage.src = src;
  resetImageView();
  imageModal.style.opacity = '1';
  imageModal.style.pointerEvents = 'auto';
  modalImage.style.cursor = 'move';
  disableGlobalDrag();
}

// Context menu functionality
let currentMessageId = null;

function showContextMenu(e, messageId) {
  e.preventDefault();
  currentMessageId = messageId;
  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.style.opacity = '1';
  contextMenu.style.pointerEvents = 'auto';
}

function hideContextMenu() {
  contextMenu.style.opacity = '0';
  contextMenu.style.pointerEvents = 'none';
  currentMessageId = null;
}

if (deleteMessageBtn) deleteMessageBtn.addEventListener('click', () => {
  if (currentMessageId) {
    socket.emit('delete message', currentMessageId);
    hideContextMenu();
  }
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

socket.on('message deleted', (messageId) => {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    messageElement.remove();
  }
});
