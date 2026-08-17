#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

API_URL="http://127.0.0.1:8000/health"
WEB_URL="http://127.0.0.1:3000/"
PID_DIR="storage/local/pids"

listener_pid() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | awk '/^n/ { sub(/^n/, ""); print; exit }' || true
}

stop_project_listener() {
  local port="$1"
  local label="$2"
  local pid
  pid="$(listener_pid "$port")"
  if [[ -z "$pid" ]]; then
    return 0
  fi

  local cwd
  cwd="$(process_cwd "$pid")"
  if [[ "$cwd" == "$PWD"* ]]; then
    echo "$label 端口 $port 被旧的本项目进程占用，正在清理..."
    kill "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if [[ -z "$(listener_pid "$port")" ]]; then
        return 0
      fi
      sleep 0.5
    done
    echo "$label 端口 $port 仍未释放。请重启电脑后再试。"
    read -r -p "按 Enter 退出。" _
    exit 1
  fi

  echo "$label 端口 $port 已被其他程序占用。"
  echo "占用进程 PID：$pid"
  echo "请关闭占用端口的程序后再双击启动。"
  read -r -p "按 Enter 退出。" _
  exit 1
}

echo "正在启动股票交易平台..."
echo "项目目录：$PWD"

if ! command -v python3 >/dev/null 2>&1; then
  echo "没有找到 python3。请先安装 Python 3。"
  read -r -p "按 Enter 退出。" _
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node.js。"
  read -r -p "按 Enter 退出。" _
  exit 1
fi

if [[ ! -x ".venv/bin/python" ]]; then
  echo "正在准备后端 Python 环境，第一次运行会稍慢..."
  python3 -m venv .venv
  .venv/bin/pip install -r apps/api/requirements.txt
fi

if [[ ! -d "apps/web/node_modules" ]]; then
  echo "正在准备网页端依赖，第一次运行会稍慢..."
  npm --prefix apps/web ci
fi

mkdir -p storage/local "$PID_DIR"

export STOCK_APP_INSTALL_ROOT="$PWD"
export STOCK_APP_DATA_HOME="$PWD/storage/local"
export STOCK_APP_DB_PATH="$PWD/storage/local/app.db"
export STOCK_APP_TEMPLATE_HOME="$PWD/storage/templates"
export BACKEND_API_URL="http://127.0.0.1:8000"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_DIR/api.pid" "$PID_DIR/web.pid"
}
trap cleanup EXIT

if curl -fsS "$API_URL" >/dev/null 2>&1 && curl -fsS "$WEB_URL" >/dev/null 2>&1; then
  echo "平台已经在运行，正在打开浏览器..."
  open "$WEB_URL"
  exit 0
fi

stop_project_listener 8000 "后端"
stop_project_listener 3000 "网页端"

echo "正在启动后端服务..."
.venv/bin/python -m uvicorn app.main:app \
  --reload \
  --reload-dir apps/api \
  --app-dir apps/api \
  --host 127.0.0.1 \
  --port 8000 \
  > storage/local/api.log 2>&1 &
API_PID=$!
printf "%s" "$API_PID" > "$PID_DIR/api.pid"

echo "正在启动网页端服务..."
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3000 \
  > storage/local/web.log 2>&1 &
WEB_PID=$!
printf "%s" "$WEB_PID" > "$PID_DIR/web.pid"

for _ in $(seq 1 90); do
  if curl -fsS "$API_URL" >/dev/null 2>&1 && curl -fsS "$WEB_URL" >/dev/null 2>&1; then
    echo "启动完成：$WEB_URL"
    open "$WEB_URL"
    echo "使用期间请不要关闭这个窗口。"
    read -r -p "按 Enter 关闭平台并退出。" _
    exit 0
  fi
  sleep 1
done

echo "启动超时。"
echo "后端日志：$PWD/storage/local/api.log"
echo "网页日志：$PWD/storage/local/web.log"
read -r -p "按 Enter 退出。" _
exit 1
