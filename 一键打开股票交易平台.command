#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

AGENT_PYTHON="$PWD/storage/local/agent-dev-venv/bin/python"

if [[ ! -x "$AGENT_PYTHON" ]]; then
  echo "没有找到 Agent Python 3.12 环境：$AGENT_PYTHON"
  echo "请按 docs/implementation/ai-journal-agent/RUNTIME_PY312.md 准备环境后再启动。"
  echo "旧 .venv 不会被修改，也不会自动安装依赖。"
  if [[ -t 0 ]]; then read -r -p "按 Enter 退出。" _ || true; fi
  exit 1
fi

exec "$AGENT_PYTHON" scripts/runtime/local_launcher.py
