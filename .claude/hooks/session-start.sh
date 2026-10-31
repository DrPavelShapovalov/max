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
if [ ! -f "$HF_VENDOR/node_modules/gsap/dist/gsap.min.js" ]; then
  npm install --silent --no-audit --no-fund --prefix "$HF_VENDOR" "gsap@$GSAP_VERSION" >/dev/null 2>&1 \
    || echo "HyperFrames: не удалось установить gsap@$GSAP_VERSION"
fi
echo "HyperFrames $HF_VERSION готов (Node, FFmpeg, Chrome Headless Shell). CDN закрыт: в каждом проекте HyperFrames скопируйте $HF_VENDOR/node_modules/gsap/dist/gsap.min.js в vendor/ и подключайте <script src=\"vendor/gsap.min.js\">."
