#!/bin/bash
# Загружает видео-скиллы в облачной сессии Claude Code:
#   video-shotcraft  -> ~/.claude/skills/video-shotcraft
#   reelmimic skills -> ~/.claude/skills/*, весь проект -> ~/reelmimic
# Версии закреплены на проверенных коммитах. Чтобы обновить, поменяйте SHA ниже
# и сначала просмотрите изменения в новой версии.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

SHOTCRAFT_REPO=https://github.com/Vincentwei1021/video-shotcraft.git
SHOTCRAFT_SHA=43bd349a136651865ecfa6ea1cf012f6e957d304
REELMIMIC_REPO=https://github.com/edenfunf/reelmimic.git
REELMIMIC_SHA=1be183e593fbdb52734ce49a75d65c924f3b925a

SKILLS="$HOME/.claude/skills"
mkdir -p "$SKILLS"

# Скачать один коммит репозитория в каталог $3
fetch_commit() {
  local repo=$1 sha=$2 dest=$3
  rm -rf "$dest"
  mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" remote add origin "$repo"
  git -C "$dest" fetch -q --depth 1 origin "$sha"
  git -C "$dest" -c advice.detachedHead=false checkout -q FETCH_HEAD
}

# video-shotcraft: весь репозиторий и есть скилл (SKILL.md в корне)
marker="$SKILLS/video-shotcraft/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$SHOTCRAFT_SHA" ]; then
  tmp=$(mktemp -d)
  fetch_commit "$SHOTCRAFT_REPO" "$SHOTCRAFT_SHA" "$tmp/repo"
  rm -rf "$tmp/repo/.git" "$SKILLS/video-shotcraft"
  mv "$tmp/repo" "$SKILLS/video-shotcraft"
  rm -rf "$tmp"
  echo "$SHOTCRAFT_SHA" > "$marker"
fi

# reelmimic: проект в ~/reelmimic, его скиллы в ~/.claude/skills
marker="$HOME/reelmimic/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$REELMIMIC_SHA" ]; then
  fetch_commit "$REELMIMIC_REPO" "$REELMIMIC_SHA" "$HOME/reelmimic"
  cp -r "$HOME/reelmimic/.claude/skills/." "$SKILLS/"
  echo "$REELMIMIC_SHA" > "$marker"
fi

# Видео-скиллы (версии закреплены; перед обновлением SHA просмотрите изменения):
#   ghost-editor      — монтаж говорящей головы в рилс        (MIT)
#   ffmpeg-skill      — правки видео и звука локальным FFmpeg (MIT)
#   davinci-resolve   — resolve-* для DaVinci Resolve MCP      (MIT; сам Resolve и MCP — на компьютере пользователя)
#   hyperframes       — reverse-any-video                      (Apache-2.0)
#   OpenMontage       — проект в ~/OpenMontage, его скиллы глобально, кроме ffmpeg (AGPL-3.0)
GHOST_REPO=https://github.com/kurbaitaev/ghost-editor.git
GHOST_SHA=ce172726c36293722b08eb57b5b307d4f06389e8
FFSKILL_REPO=https://github.com/kajisho5/ffmpeg-skill.git
FFSKILL_SHA=1dc2f52013956daa1d97fd9d9d53c79b9305bc43
RESOLVE_REPO=https://github.com/samuelgursky/davinci-resolve-mcp.git
RESOLVE_SHA=6dea2f3dd2524a81dff18d8eafc8711f90108964
HFREPO=https://github.com/heygen-com/hyperframes.git
HFREPO_SHA=a04b45a6db0d1f724be9cf1985c3b13657195f0d
MONTAGE_REPO=https://github.com/calesthio/OpenMontage.git
MONTAGE_SHA=195eab24478dc9363326aec437aefc3701635ddf

# скопировать каталоги-скиллы, не затирая уже установленные с тем же именем
copy_skills() {
  local src=$1; shift
  for d in "$src"/*/; do
    local name; name=$(basename "$d")
    case " $* " in *" $name "*) continue ;; esac
    [ -f "$d/SKILL.md" ] || continue
    [ -e "$SKILLS/$name" ] || cp -r "$d" "$SKILLS/$name"
  done
}

marker="$SKILLS/ghost-editor/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$GHOST_SHA" ]; then
  tmp=$(mktemp -d)
  fetch_commit "$GHOST_REPO" "$GHOST_SHA" "$tmp/repo"
  rm -rf "$tmp/repo/.git" "$SKILLS/ghost-editor"
  mv "$tmp/repo" "$SKILLS/ghost-editor"
  rm -rf "$tmp"
  echo "$GHOST_SHA" > "$marker"
fi

marker="$SKILLS/ffmpeg-skill/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$FFSKILL_SHA" ]; then
  tmp=$(mktemp -d)
  fetch_commit "$FFSKILL_REPO" "$FFSKILL_SHA" "$tmp/repo"
  rm -rf "$SKILLS/ffmpeg-skill"
  node "$tmp/repo/bin/install.js" >/dev/null
  rm -rf "$tmp"
  echo "$FFSKILL_SHA" > "$marker"
fi

marker="$SKILLS/resolve-mcp/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$RESOLVE_SHA" ]; then
  tmp=$(mktemp -d)
  fetch_commit "$RESOLVE_REPO" "$RESOLVE_SHA" "$tmp/repo"
  for d in "$tmp"/repo/.claude/skills/resolve-*/; do rm -rf "$SKILLS/$(basename "$d")"; cp -r "$d" "$SKILLS/"; done
  rm -rf "$tmp"
  echo "$RESOLVE_SHA" > "$marker"
fi

marker="$SKILLS/reverse-any-video/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$HFREPO_SHA" ]; then
  tmp=$(mktemp -d)
  git clone -q --depth 1 --filter=blob:none --sparse "$HFREPO" "$tmp/repo"
  git -C "$tmp/repo" sparse-checkout set skills/reverse-any-video
  git -C "$tmp/repo" fetch -q --depth 1 origin "$HFREPO_SHA"
  git -C "$tmp/repo" -c advice.detachedHead=false checkout -q FETCH_HEAD
  rm -rf "$SKILLS/reverse-any-video"
  cp -r "$tmp/repo/skills/reverse-any-video" "$SKILLS/"
  rm -rf "$tmp"
  echo "$HFREPO_SHA" > "$marker"
fi

marker="$HOME/OpenMontage/.pinned-sha"
if [ "$(cat "$marker" 2>/dev/null)" != "$MONTAGE_SHA" ]; then
  fetch_commit "$MONTAGE_REPO" "$MONTAGE_SHA" "$HOME/OpenMontage"
  echo "$MONTAGE_SHA" > "$marker"
fi
copy_skills "$HOME/OpenMontage/.claude/skills" ffmpeg

# Python-зависимости ghost-editor, которые ставятся из PyPI
python3 -c "import numpy, cv2; from google import genai" 2>/dev/null \
  || python3 -m pip install -q numpy opencv-python-headless google-genai >/dev/null 2>&1 \
  || echo "ghost-editor: не удалось поставить numpy/opencv/google-genai"

# Браузерные проверки дизайна (hallmark sloplint --render, taste-skill inspect): puppeteer-core
# и обёртка Chromium с --no-sandbox (в контейнере всё запускается от root). CHROME_PATH задан в settings.json.
CHROME_BIN=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1 || true)
if [ -n "$CHROME_BIN" ]; then
  mkdir -p "$HOME/.local/bin"
  printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$CHROME_BIN" > "$HOME/.local/bin/chrome-nosandbox"
  chmod +x "$HOME/.local/bin/chrome-nosandbox"
fi
[ -d "$(npm root -g)/puppeteer-core" ] || npm install -g --silent --no-audit --no-fund puppeteer-core >/dev/null 2>&1 \
  || echo "Не удалось поставить puppeteer-core — браузерные проверки hallmark пропустятся"

# HyperFrames: видео из HTML. Node.js и FFmpeg в облачном контейнере уже есть,
# не хватает только Chrome Headless Shell для рендера и локальной копии GSAP
# (CDN jsdelivr из браузера рендера закрыт).
HF_VERSION=0.8.223
GSAP_VERSION=3.12.5
HF_VENDOR="$HOME/.cache/hyperframes-vendor"
if ! ls "$HOME"/.cache/hyperframes/chrome/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell >/dev/null 2>&1; then
  npx --yes "hyperframes@$HF_VERSION" browser ensure >/dev/null 2>&1 \
    || echo "HyperFrames: не удалось скачать Chrome Headless Shell — запустите: npx hyperframes browser ensure"
fi
if [ ! -f "$SKILLS/hyperframes-cli/SKILL.md" ]; then
  (cd /tmp && npx --yes "hyperframes@$HF_VERSION" skills update >/dev/null 2>&1) \
    || echo "HyperFrames: не удалось обновить скиллы — запустите: npx hyperframes skills update"
fi
if [ ! -f "$HF_VENDOR/node_modules/gsap/dist/gsap.min.js" ]; then
  npm install --silent --no-audit --no-fund --prefix "$HF_VENDOR" "gsap@$GSAP_VERSION" >/dev/null 2>&1 \
    || echo "HyperFrames: не удалось установить gsap@$GSAP_VERSION"
fi
echo "HyperFrames $HF_VERSION готов (Node, FFmpeg, Chrome Headless Shell). CDN закрыт: в каждом проекте HyperFrames скопируйте $HF_VENDOR/node_modules/gsap/dist/gsap.min.js в vendor/ и подключайте <script src=\"vendor/gsap.min.js\">."
