#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

API_BIN="./api/stock-platform-api"
NODE_BIN="./runtime/node/node"
WEB_SERVER="./web/server.js"
if [[ ! -f "$WEB_SERVER" ]]; then
  WEB_SERVER="./web/apps/web/server.js"
fi
API_URL="http://127.0.0.1:8000/health"
WEB_URL="http://127.0.0.1:3000/"

running_platform() {
  curl -fsS "$API_URL" >/dev/null 2>&1 && curl -fsS "$WEB_URL" >/dev/null 2>&1
}

assert_port_available() {
  local port="$1"
  local pid
  pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "$pid" ]]; then
    echo "端口 $port 已被其他程序占用（PID：$pid）。请关闭占用程序后再启动。"
    exit 1
  fi
}

if [[ ! -x "$API_BIN" ]]; then
  osascript -e 'display dialog "没有找到内置 API 程序。请重新下载 macOS 压缩包并完整解压。" buttons {"好"} default button "好"'
  exit 1
fi

if [[ ! -x "$NODE_BIN" ]]; then
  osascript -e 'display dialog "没有找到内置 Node.js。请重新下载 macOS 压缩包并完整解压。" buttons {"好"} default button "好"'
  exit 1
fi

if [[ ! -f "$WEB_SERVER" ]]; then
  osascript -e 'display dialog "没有找到网页端程序。请重新下载 macOS 压缩包并完整解压。" buttons {"好"} default button "好"'
  exit 1
fi

if running_platform; then
  open "$WEB_URL"
  exit 0
fi

assert_port_available 8000
assert_port_available 3000

mkdir -p storage/local
mkdir -p storage/local/pids

export STOCK_APP_INSTALL_ROOT="$PWD"
export STOCK_APP_DATA_HOME="$PWD/storage/local"
export STOCK_APP_DB_PATH="$PWD/storage/local/app.db"
export STOCK_APP_TEMPLATE_HOME="$PWD/storage/templates"
export STOCK_APP_API_HOST="127.0.0.1"
export STOCK_APP_API_PORT="8000"
export BACKEND_API_URL="http://127.0.0.1:8000"
export HOSTNAME="127.0.0.1"
export PORT="3000"

"$API_BIN" > storage/local/api.log 2>&1 &
API_PID=$!
"$NODE_BIN" "$WEB_SERVER" > storage/local/web.log 2>&1 &
WEB_PID=$!
printf "%s" "$API_PID" > storage/local/pids/api.pid
printf "%s" "$WEB_PID" > storage/local/pids/web.pid

cleanup() {
  kill "$API_PID" "$WEB_PID" >/dev/null 2>&1 || true
  rm -f storage/local/pids/api.pid storage/local/pids/web.pid
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if running_platform; then
    open "$WEB_URL"
    echo "股票交易平台已启动：$WEB_URL"
    echo "使用期间请不要关闭这个窗口。"
    read -r -p "按 Enter 关闭服务并退出。" _
    exit 0
  fi
  sleep 1
done

echo "启动超时。请查看 storage/local/api.log 和 storage/local/web.log。"
read -r -p "按 Enter 退出。" _
exit 1
