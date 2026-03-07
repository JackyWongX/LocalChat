console.log('LocalChat client script loaded');
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.message || e.error, e.error || e);
});

// ─────────────────────────────────────────────
// 鉴权模块
// ─────────────────────────────────────────────
const TOKEN_KEY = 'lc_auth_token';
const TOKEN_EXP_KEY = 'lc_auth_exp';
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 与服务器一致：72小时

function getStoredToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const exp = parseInt(localStorage.getItem(TOKEN_EXP_KEY) || '0', 10);
  if (!token || Date.now() > exp) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    return null;
  }
  return token;
}

function storeToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + TOKEN_TTL_MS));
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXP_KEY);
}

// ─────────────────────────────────────────────
// 安全码弹窗逻辑
// ─────────────────────────────────────────────
const passcodeOverlay = document.getElementById('passcodeOverlay');
const passcodeInput = document.getElementById('passcodeInput');
const passcodeError = document.getElementById('passcodeError');
const passcodeSubmit = document.getElementById('passcodeSubmit');

function showPasscodeOverlay() {
  passcodeOverlay.style.setProperty('display', 'flex', 'important');
  passcodeInput.value = '';
  passcodeError.classList.add('hidden');
  passcodeError.textContent = '';
  setTimeout(() => passcodeInput.focus(), 100);
}

function hidePasscodeOverlay() {
  passcodeOverlay.style.setProperty('display', 'none', 'important');
}

async function submitPasscode() {
  const passcode = passcodeInput.value;
  if (!passcode) {
    passcodeError.textContent = '请输入安全码';
    passcodeError.classList.remove('hidden');
    return;
  }
  passcodeSubmit.disabled = true;
  passcodeSubmit.textContent = '验证中...';
  passcodeError.classList.add('hidden');

  try {
    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      storeToken(data.token);
      hidePasscodeOverlay();
      initApp();
    } else {
      passcodeError.textContent = data.error || '安全码错误';
      passcodeError.classList.remove('hidden');
      passcodeInput.value = '';
      passcodeInput.focus();
    }
  } catch (err) {
    passcodeError.textContent = '网络错误，请重试';
    passcodeError.classList.remove('hidden');
  } finally {
    passcodeSubmit.disabled = false;
    passcodeSubmit.textContent = '验证';
  }
}

if (passcodeSubmit) {
  passcodeSubmit.addEventListener('click', submitPasscode);
}
if (passcodeInput) {
  passcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPasscode();
  });
}

// ─────────────────────────────────────────────
// 主应用初始化（鉴权通过后调用）
// ─────────────────────────────────────────────
let socket = null;
let appInitialized = false;
let uiEventsBound = false; // 防止重复绑定 DOM 事件监听器

function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  const token = getStoredToken();
  socket = io({ auth: { token } });

  // Token 失效时（服务器重启后旧 token 失效）重新弹出验证框
  socket.on('connect_error', (err) => {
    if (err.message && (err.message.includes('Token') || err.message.includes('未授权'))) {
      clearToken();
      socket.disconnect();
      appInitialized = false;
      socket = null;
      showPasscodeOverlay();
    }
  });

  bindSocketEvents();
  bindUIEvents();
  // 脚本在 <body> 底部加载，DOM 必定已就绪，直接调用
  initializeNickname();
  enableGlobalDrag();
}

// ─────────────────────────────────────────────
// UI 元素（声明在 bootstrap 之前，避免暂时性死区 TDZ）
// ─────────────────────────────────────────────
let messageInput, sendButton, messagesDiv, nicknameInput, setNicknameButton;
let dragOverlay, imageModal, modalImage, closeModal, zoomIn, zoomOut, zoomReset;
let contextMenu, deleteMessageBtn;

let currentNickname = '';
const uploadPlaceholders = new Map();

// 图片缩放 / 拖拽状态变量
let currentZoom = 1;
let imageStartX = 0;
let imageStartY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// ─────────────────────────────────────────────
// 启动入口
// ─────────────────────────────────────────────

// 向服务器主动校验缓存的 token 是否仍有效（防止服务器重启后旧 token 失效）
async function verifyTokenOnServer(token) {
  try {
    const res = await fetch('/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.ok;
  } catch (_) {
    // 网络异常时乐观处理，让后续 Socket.IO connect_error 内层先尝试
    return true;
  }
}

(function bootstrap() {
  const token = getStoredToken();
  if (token) {
    // 主动向服务器验证缓存的 token，校验失败则弹窗要求重新输入安全码
    verifyTokenOnServer(token).then((valid) => {
      if (valid) {
        initApp();
      } else {
        clearToken();
        showPasscodeOverlay();
      }
    });
  } else {
    showPasscodeOverlay();
  }
})();


function initDOMRefs() {
  messageInput = document.getElementById('messageInput');
  sendButton = document.getElementById('sendButton');
  messagesDiv = document.getElementById('messages');
  nicknameInput = document.getElementById('nicknameInput');
  setNicknameButton = document.getElementById('setNicknameButton');
  dragOverlay = document.getElementById('dragOverlay');
  imageModal = document.getElementById('imageModal');
  modalImage = document.getElementById('modalImage');
  closeModal = document.getElementById('closeModal');
  zoomIn = document.getElementById('zoomIn');
  zoomOut = document.getElementById('zoomOut');
  zoomReset = document.getElementById('zoomReset');
  contextMenu = document.getElementById('contextMenu');
  deleteMessageBtn = document.getElementById('deleteMessageBtn');
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
  if (nicknameInput) {
    nicknameInput.value = currentNickname;
    nicknameInput.disabled = true;
  }
  if (setNicknameButton) setNicknameButton.textContent = '修改昵称';
  if (socket) socket.emit('set nickname', currentNickname);
}

function bindUIEvents() {
  if (uiEventsBound) return; // 防止重新鉴权时重复绑定
  uiEventsBound = true;
  initDOMRefs();

  // 通知权限
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

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
          if (socket) socket.emit('set nickname', currentNickname);
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
    messageInput.addEventListener('paste', handlePaste);
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
    e.preventDefault(); e.stopPropagation();
    currentZoom = Math.min(currentZoom * 1.2, 5);
    updateImageTransform();
  });

  if (zoomOut) zoomOut.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    currentZoom = Math.max(currentZoom / 1.2, 0.1);
    updateImageTransform();
  });

  if (zoomReset) zoomReset.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    resetImageView();
  });

  if (modalImage) {
    modalImage.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      currentZoom = e.deltaY < 0
        ? Math.min(currentZoom * 1.1, 5)
        : Math.max(currentZoom / 1.1, 0.1);
      updateImageTransform();
    });

    modalImage.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
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
      imageStartX += (e.clientX - dragStartX) / currentZoom;
      imageStartY += (e.clientY - dragStartY) / currentZoom;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      updateImageTransform();
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      if (modalImage) modalImage.style.cursor = currentZoom > 1 ? 'grab' : 'move';
    }
  });

  if (deleteMessageBtn) deleteMessageBtn.addEventListener('click', () => {
    if (currentMessageId && socket) {
      socket.emit('delete message', currentMessageId);
      hideContextMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });
}

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
  if (!currentNickname) initializeNickname();
  const imageFile = new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });
  const formData = new FormData();
  formData.append('file', imageFile);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload');
  // 携带鉴权头
  const token = getStoredToken();
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  xhr.onload = () => {
    if (xhr.status === 401 || xhr.status === 403) {
      clearToken();
      appInitialized = false;
      if (socket) { socket.disconnect(); socket = null; }
      showPasscodeOverlay();
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        if (socket) socket.emit('image message', { ...data });
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
  };
  xhr.send(formData);
}

function sendMessage() {
  const message = messageInput ? messageInput.value : '';
  if (!message.trim()) return;
  if (!currentNickname) initializeNickname();
  if (socket) socket.emit('chat message', message);
  if (messageInput) messageInput.value = '';
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

// 使用认证Token加载图片（解决401错误）
async function loadImageWithAuth(filePath) {
  try {
    const token = getStoredToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const response = await fetch(filePath, { headers });

    if (response.status === 401 || response.status === 403) {
      clearToken();
      appInitialized = false;
      if (socket) { socket.disconnect(); socket = null; }
      showPasscodeOverlay();
      return null;
    }

    if (!response.ok) {
      console.error(`图片加载失败: ${response.status}`);
      return null;
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('图片加载异常:', error);
    return null;
  }
}

// 使用认证Token下载文件（解决401错误）
async function downloadFileWithAuth(downloadUrl, fileName) {
  try {
    const token = getStoredToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const response = await fetch(downloadUrl, { headers });

    if (response.status === 401 || response.status === 403) {
      clearToken();
      appInitialized = false;
      if (socket) { socket.disconnect(); socket = null; }
      showPasscodeOverlay();
      return;
    }

    if (!response.ok) {
      console.error(`文件下载失败: ${response.status}`);
      return;
    }

    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName || '下载文件';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error('文件下载异常:', error);
  }
}

function uploadFile(file) {
  if (!currentNickname) initializeNickname();
  const uploadId = generateUploadId();
  if (socket) socket.emit('file upload started', { uploadId, fileName: file.name, fileSize: file.size });

  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload');
  // 携带鉴权头
  const token = getStoredToken();
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    if (socket) socket.emit('file upload progress', { uploadId, percent });
  };

  xhr.onload = () => {
    if (xhr.status === 401 || xhr.status === 403) {
      clearToken();
      appInitialized = false;
      if (socket) { socket.disconnect(); socket = null; }
      showPasscodeOverlay();
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.error) {
          // 服务器返回业务错误（如文件类型被拒绝）
          if (socket) socket.emit('file upload failed', { uploadId, error: data.error });
          return;
        }
        if (socket) {
          socket.emit('file upload progress', { uploadId, percent: 100 });
          socket.emit('file message', { ...data, uploadId });
        }
      } catch (error) {
        if (socket) socket.emit('file upload failed', { uploadId, error: '文件响应解析失败' });
      }
    } else {
      // 尝试解析服务器错误信息
      let errMsg = '上传失败，请重试';
      try {
        const errData = JSON.parse(xhr.responseText);
        if (errData.error) errMsg = errData.error;
      } catch (_) {}
      if (socket) socket.emit('file upload failed', { uploadId, error: errMsg });
    }
  };

  xhr.onerror = () => {
    if (socket) socket.emit('file upload failed', { uploadId, error: '网络异常，上传失败' });
  };

  xhr.send(formData);
}

function bindSocketEvents() {
  socket.on('chat message', (msg) => {
    displayMessage(msg);
    if (msg.nickname !== currentNickname) showNotification(msg);
  });

  socket.on('file message', (msg) => {
    displayFileMessage(msg);
    if (msg.nickname !== currentNickname) showNotification(msg);
  });

  socket.on('image message', (msg) => {
    displayImageMessage(msg);
    if (msg.nickname !== currentNickname) showNotification(msg);
  });

  socket.on('load messages', (msgs) => {
    if (!messagesDiv) initDOMRefs();
    messagesDiv.innerHTML = '';
    msgs.forEach(msg => {
      if (msg.type === 'file') displayFileMessage(msg);
      else if (msg.type === 'image') displayImageMessage(msg);
      else displayMessage(msg);
    });
    scrollMessagesToBottom();
  });

  socket.on('file upload started', renderUploadPlaceholder);
  socket.on('file upload progress', updateUploadProgress);
  socket.on('file upload failed', handleUploadFailure);

  socket.on('message deleted', (messageId) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.remove();
  });
}

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

  // 图片（使用认证Token加载）
  const img = document.createElement('img');
  img.className = 'max-w-full h-auto rounded cursor-pointer mt-1';
  img.style.opacity = '0.5';
  img.style.pointerEvents = 'none';

  loadImageWithAuth(msg.filePath).then((blobUrl) => {
    if (blobUrl) {
      img.src = blobUrl;
      img.style.opacity = '1';
      img.style.pointerEvents = 'auto';
      img.onclick = () => openImageModal(msg.filePath);
    }
  });

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

  const downloadBtn = document.createElement('button');
  const downloadHref = msg.downloadPath || msg.filePath;
  downloadBtn.textContent = '下载';
  downloadBtn.className = 'text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-full transition duration-200 ml-2';
  downloadBtn.onclick = (e) => {
    e.preventDefault();
    downloadFileWithAuth(downloadHref, msg.fileName);
  };
  tile.appendChild(downloadBtn);

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
  if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
  if (modalImage) modalImage.style.transform = `scale(${currentZoom}) translate(${imageStartX}px, ${imageStartY}px)`;
}

function resetImageView() {
  currentZoom = 1;
  imageStartX = 0;
  imageStartY = 0;
  updateImageTransform();
}

async function openImageModal(src) {
  if (!modalImage || !imageModal) return;

  // 加载图片（使用认证Token）
  const blobUrl = await loadImageWithAuth(src);
  if (blobUrl) {
    modalImage.src = blobUrl;
    resetImageView();
    imageModal.style.opacity = '1';
    imageModal.style.pointerEvents = 'auto';
    modalImage.style.cursor = 'move';
    disableGlobalDrag();
  }
}

// ─────────────────────────────────────────────
// 右键菜单
// ─────────────────────────────────────────────
let currentMessageId = null;

function showContextMenu(e, messageId) {
  e.preventDefault();
  currentMessageId = messageId;
  if (!contextMenu) return;
  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.style.opacity = '1';
  contextMenu.style.pointerEvents = 'auto';
}

function hideContextMenu() {
  if (!contextMenu) return;
  contextMenu.style.opacity = '0';
  contextMenu.style.pointerEvents = 'none';
  currentMessageId = null;
}

