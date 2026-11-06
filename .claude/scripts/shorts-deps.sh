#!/bin/bash
# Зависимости скилла shorts (claude-shorts) для облачной сессии без видеокарты.
# Запускать по необходимости, перед первой работой со shorts в сессии (около 1–2 минут):
#   bash .claude/scripts/shorts-deps.sh
# PyTorch не ставится: download.pytorch.org закрыт сетью среды, а без него скилл сам считает на процессоре.
# Модели faster-whisper скачиваются с huggingface.co при первой расшифровке; нужен HF_HUB_DISABLE_XET=1
# (задан в среде Default), иначе библиотека идёт на закрытый cas-server.xethub.hf.co.
set -euo pipefail
V="$HOME/.shorts-skill"
R="$HOME/.claude/skills/shorts/remotion"
[ -f "$R/package.json" ] || { echo "Скилл shorts не установлен (нет $R) — его ставит .claude/hooks/session-start.sh"; exit 1; }
[ -x "$V/bin/python" ] || python3 -m venv "$V"
"$V/bin/python" -c "import faster_whisper, mediapipe, cv2, numpy" 2>/dev/null \
  || "$V/bin/pip" install -q faster-whisper mediapipe numpy opencv-python
[ -d "$R/node_modules" ] || (cd "$R" && npm install --silent --no-audit --no-fund)
command -v jq >/dev/null || echo "Нет jq — нужен скриптам shorts"
echo "shorts: Python $V, Remotion $R — готово. Для расшифровки: export HF_HUB_DISABLE_XET=1"
