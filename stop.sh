#!/bin/bash
# ═══════════════════════════════════════════════
#  LocalChat 停止脚本
#  用法：sudo ./stop.sh
# ═══════════════════════════════════════════════

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${APP_DIR}/localchat.pid"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if [[ ! -f "$PID_FILE" ]]; then
  echo -e "${RED}[错误] 未找到 PID 文件，服务可能未在运行${NC}"
  exit 1
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  rm -f "$PID_FILE"
  echo -e "${GREEN}[OK] 服务已停止（PID: ${PID}）${NC}"
else
  echo -e "${RED}[警告] 进程 ${PID} 不存在，清理 PID 文件${NC}"
  rm -f "$PID_FILE"
fi
