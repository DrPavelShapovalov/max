#!/bin/bash
# Собирает whisper-cli (whisper.cpp v1.9.5) в ~/whisper.cpp, если его нет; при аргументе — скачивает модель.
set -euo pipefail
TAG=v1.9.5
SHA=d1be6fde11ac6e0407606b4e42fe72d34add8037
D="$HOME/whisper.cpp"
BIN="$D/build/bin/whisper-cli"
if [ ! -x "$BIN" ]; then
  rm -rf "$D"
  git clone -q --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp.git "$D"
  [ "$(git -C "$D" rev-parse HEAD)" = "$SHA" ] || { echo "whisper.cpp: коммит тега $TAG не совпал с ожидаемым $SHA — остановлено"; exit 1; }
  cmake -S "$D" -B "$D/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF >/dev/null
  cmake --build "$D/build" -j"$(nproc)" --config Release --target whisper-cli >/dev/null
fi
echo "whisper-cli: $BIN"
MODEL=${1:-}
[ -z "$MODEL" ] && exit 0
case "$MODEL" in tiny|base|small|medium|large-v3-turbo) ;; *) echo "Неизвестная модель: $MODEL"; exit 1 ;; esac
F="$D/models/ggml-$MODEL.bin"
if [ ! -s "$F" ]; then
  if ! curl -fL --retry 2 -o "$F.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"; then
    rm -f "$F.part"
    echo "Не удалось скачать модель с huggingface.co. Если сайт закрыт сетью среды — добавьте huggingface.co в Allowed domains."
    exit 2
  fi
  mv "$F.part" "$F"
fi
echo "модель: $F ($(du -h "$F" | cut -f1))"
