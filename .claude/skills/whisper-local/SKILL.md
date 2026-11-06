---
name: whisper-local
description: Расшифровка аудио и видео в текст и субтитры (SRT/VTT) локально через whisper.cpp, без облачных сервисов и ключей. Используй, когда нужно расшифровать речь из рилса, интервью, доклада или голосового, сделать субтитры или найти, что сказано в записи.
---

# whisper-local (whisper.cpp)

Локальная расшифровка речи программой `whisper-cli` из [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT).
Звук не уходит в интернет: модель работает на процессоре этого компьютера.

## Подготовка (один раз за сессию)

```bash
bash .claude/skills/whisper-local/scripts/ensure.sh            # собрать whisper-cli v1.9.5, если его нет
bash .claude/skills/whisper-local/scripts/ensure.sh small      # + скачать модель (tiny, base, small, medium, large-v3-turbo)
```

- Программа ставится в `~/whisper.cpp`, модели — в `~/whisper.cpp/models/ggml-<имя>.bin`.
- Модели лежат на huggingface.co. Если сайт закрыт сетью среды, скрипт так и скажет: попросите пользователя добавить
  `huggingface.co` в Allowed domains (настройки среды → Network access) или прислать файл модели.
- Для русской речи берите `small` или `medium` (у `tiny`/`base` много ошибок); `large-v3-turbo` точнее, но медленнее.
  На 4 ядрах без видеокарты расшифровка заметно медленнее реального времени у крупных моделей — предупредите заранее.

## Расшифровка

whisper-cli читает wav/mp3/flac/ogg. Видео и другие форматы сначала переводим в WAV 16 кГц моно:

```bash
ffmpeg -y -i input.mp4 -ar 16000 -ac 1 -c:a pcm_s16le audio.wav
~/whisper.cpp/build/bin/whisper-cli -m ~/whisper.cpp/models/ggml-small.bin -l ru -t 4 \
  -f audio.wav -otxt -osrt -of result        # → result.txt и result.srt
```

- `-l ru` — язык (по умолчанию определяет сам: `-l auto`); `-ovtt` — субтитры VTT; `-ml 42` — короче строки субтитров.
- Проверьте, что файлы появились и не пустые, и покажите пользователю начало текста. Не выдавайте расшифровку,
  которой нет: если модель не скачана или программа упала — скажите об этом.
- Имена пациентов и личные данные в расшифровках не публикуйте; файлы с ними не коммитьте.

## Источник

whisper.cpp v1.9.5, коммит d1be6fde11ac6e0407606b4e42fe72d34add8037, лицензия MIT. Сборку разрешил пользователь 05.11.2026.
