# 局域网聊天室

一个使用Node.js和Socket.IO构建的简单局域网聊天室应用。

## 功能

- 实时聊天
- 用户昵称设置
- 消息历史记录（缓存7天）
- 在线用户列表
- 现代化UI界面
- 文件分享（拖拽上传和下载）

## 安装和运行

### 方式1：使用批处理脚本（推荐）
双击 `start.bat` 文件，一键安装依赖并启动服务器。

### 方式2：手动操作
1. 安装依赖：
   ```
   npm install
   ```

2. 启动服务器：
   ```
   npm start
   ```

3. 在浏览器中打开 `http://localhost:3001` 开始聊天。

## HTTPS配置（可选，用于消除不安全提示）

为了在局域网中使用HTTPS并消除浏览器的不安全提示：

1. 安装OpenSSL（Windows用户可通过Chocolatey安装：`choco install openssl`）

2. 生成自签名证书：
   ```
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/C=CN/ST=State/L=City/O=Organization/CN=your-server-ip"
   ```

3. 修改`server.js`中的端口和HTTPS：
   ```javascript
   const https = require('https');
   const server = https.createServer({
     key: fs.readFileSync('key.pem'),
     cert: fs.readFileSync('cert.pem')
   }, app);
   const PORT = 3443; // HTTPS端口
   ```

4. 访问 `https://your-server-ip:3443`

注意：自签名证书会被浏览器标记为不安全，但对于内网使用是安全的。

## 性能优化

如果页面加载慢，请检查：
- 服务器是否正常运行
- 网络连接是否稳定
- 防火墙是否阻止了端口3001