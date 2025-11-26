@echo off
echo ========================================
echo    局域网聊天室启动脚本
echo ========================================
echo.

echo 检查Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: Node.js未安装。请先安装Node.js。
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo 安装项目依赖...
npm install
if %errorlevel% neq 0 (
    echo 错误: 依赖安装失败。
    pause
    exit /b 1
)

echo.
echo 启动聊天室服务器...
echo 服务器将在端口3001启动
echo 在浏览器中访问: http://localhost:3001
echo.
echo 服务器将在新窗口中启动，按任意键关闭此窗口...
echo.

start cmd /k "npm start"