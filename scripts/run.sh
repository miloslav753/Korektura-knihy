#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${KOREKTURA_PYTHON:-}" ]]; then
  app_python="$KOREKTURA_PYTHON"
elif [[ -x .venv/bin/python ]]; then
  app_python=.venv/bin/python
elif [[ -x /workspace/.cloud-setup/korektura-knihy/venv/bin/python ]]; then
  app_python=/workspace/.cloud-setup/korektura-knihy/venv/bin/python
else
  app_python=python3
fi
exec "$app_python" -m streamlit run app.py --browser.gatherUsageStats=false "$@"
