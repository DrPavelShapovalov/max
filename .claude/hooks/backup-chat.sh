#!/bin/bash
# Stop-хук: бэкап текущего чата Claude Code в приватный архив claude-archive (см. backup_chat.py).
# Работает в фоне (async), ничего не блокирует. Если архива нет и склонировать его нельзя — тихо выходит.
A="${CLAUDE_ARCHIVE_DIR:-/home/user/claude-archive}"
DIR="$(cd "$(dirname "$0")" && pwd)"
IN="$(cat)"
if [ ! -d "$A/.git" ]; then
  git clone -q https://github.com/DrPavelShapovalov/claude-archive "$A" 2>/dev/null || exit 0
fi
exec 9>"$A/.git/backup-chat.lock"
flock -w 120 9 || exit 0
cd "$A" || exit 0
git pull -q --no-rebase --no-edit origin main >/dev/null 2>&1
printf '%s' "$IN" | CLAUDE_ARCHIVE_DIR="$A" python3 -I "$DIR/backup_chat.py" >/dev/null || exit 0
git add chats/claude-code >/dev/null 2>&1
git diff --cached --quiet && exit 0
SID=$(printf '%s' "$IN" | python3 -I -c "import json,sys;print(json.load(sys.stdin).get('session_id','')[:8])" 2>/dev/null)
git commit -q -m "Бэкап чата Claude Code ${SID} ($(date -u +%Y-%m-%dT%H:%MZ))" >/dev/null 2>&1
for i in 1 2 3 4; do git push -q origin HEAD:main >/dev/null 2>&1 && exit 0
  git pull -q --no-rebase --no-edit origin main >/dev/null 2>&1; sleep $((2 ** i)); done
exit 0
