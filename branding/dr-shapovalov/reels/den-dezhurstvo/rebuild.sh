#!/bin/bash
# Полная пересборка рилса: куски → склейка → музыка (две версии) → подписи → три файла в out/.
set -e
cd "$(dirname "$0")"
PY=${PY:-python3}
$PY prep.py
$PY base.py
read A B TOT < <($PY -c "from segments import *; st,t=timeline(); print(round(st[13],3), round(st[16],3), round(t,3))")
$PY -c "from segments import *; import json; st,t=timeline(); print(json.dumps([round(x+T/2,3) for x in st[1:]]+[round(t-FINAL-T+T/2,3)]))" > work/whoosh.json
$PY music_future.py work/music.wav $TOT "$(cat work/whoosh.json)"
$PY music_moods.py work/music-moods.wav $TOT $A $B "$(cat work/whoosh.json)"
$PY compose.py
ffmpeg -v error -y -i out/den-dezhurstvo.mp4 -i work/music-moods.wav -map 0:v -map 1:a -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=9 -c:a aac -b:a 192k -shortest -movflags +faststart out/den-dezhurstvo-moods.mp4
ffmpeg -v error -y -i out/den-dezhurstvo.mp4 -map 0:v -c:v copy -an -movflags +faststart out/den-dezhurstvo-bez-muzyki.mp4
echo "DONE $TOT rest=$A evening=$B"
