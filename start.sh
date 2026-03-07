#!/bin/bash
# ═══════════════════════════════════════════════
#  LocalChat 后台启动脚本（无需 sudo）
#  用法：chmod +x start.sh && ./start.sh
#  效果：交互输入安全码 → 进程转入后台 → 日志写入 logs/app.log
# ═══════════════════════════════════════════════

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${APP_DIR}/logs"
LOG_FILE="${LOG_DIR}/app.log"
PID_FILE="${APP_DIR}/localchat.pid"

# ─── 颜色输出 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── 检查是否已在运行 ───
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo -e "${YELLOW}[警告] LocalChat 已在运行，PID: ${OLD_PID}${NC}"
    echo -e "       如需重启，请先执行：${BLUE}./stop.sh${NC}"
    exit 1
  else
    # PID 文件残留但进程不存在，清理掉
    rm -f "$PID_FILE"
  fi
fi

# ─── 确保日志目录存在 ───
mkdir -p "$LOG_DIR"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}   LocalChat 启动${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo ""

# ─── 安全读取安全码（终端不回显）───
printf "请输入聊天室安全码（输入不可见）："
stty -echo
read -r PASSCODE
stty echo
printf "\n"

if [[ -z "$PASSCODE" ]]; then
  echo -e "${RED}[错误] 安全码不能为空${NC}"
  exit 1
fi

echo -e "${BLUE}[启动] 正在后台启动服务...${NC}"
echo -e "       日志文件：${BLUE}${LOG_FILE}${NC}"

# ─── 后台启动，安全码通过环境变量传入 ───
nohup env LOCALCHAT_PASSCODE="$PASSCODE" node "$APP_DIR/server.js" >> "$LOG_FILE" 2>&1 &
PID=$!

# ─── 立即清除内存中的安全码变量 ───
unset PASSCODE

# ─── 等待片刻确认进程启动成功 ───
sleep 2
if kill -0 "$PID" 2>/dev/null; then
  echo "$PID" > "$PID_FILE"
  echo ""
  echo -e "${GREEN}[OK] 服务已成功启动${NC}"
  echo -e "     PID：${BLUE}${PID}${NC}"
  echo -e "     日志：${BLUE}${LOG_FILE}${NC}"
  echo ""
  echo -e "  实时查看日志：${BLUE}tail -f ${LOG_FILE}${NC}"
  echo -e "  停止服务：    ${BLUE}./stop.sh${NC}"
  echo ""
else
  echo -e "${RED}[错误] 服务启动失败，请检查日志：${LOG_FILE}${NC}"
  tail -20 "$LOG_FILE"
  exit 1
fi
