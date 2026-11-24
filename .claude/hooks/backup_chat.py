"""Бэкап чата Claude Code в приватный архив claude-archive (по просьбе доктора от 24.11.2026).

Вызывается Stop-хуком после каждого хода: stdin — JSON хука (session_id, transcript_path, cwd).
Кладёт копию транскрипта в <архив>/chats/claude-code/<дата начала>_<session_id>.jsonl и читаемую версию .md.
- Картинки и файлы в base64 вырезаются (фото пациентов не уходят в git, файл остаётся небольшим).
- Похожее на секреты (токены GitHub/OpenAI/Anthropic/AWS/Slack, приватные ключи, Bearer) заменяется на [СКРЫТО].
- Коммит и push — только если файл изменился; параллельные запуски разводит flock в backup-chat.sh.
Только стандартная библиотека Python.
"""
import datetime, json, os, pathlib, re, sys

ARCHIVE = pathlib.Path(os.environ.get('CLAUDE_ARCHIVE_DIR', '/home/user/claude-archive'))
SECRET = re.compile(
    r'(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9_\-]{20,}'
    r'|AKIA[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9\-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'
    r'|(?i:bearer)\s+[A-Za-z0-9._\-]{20,})')
B64 = re.compile(r'^[A-Za-z0-9+/=\s]{2000,}$')
# служебные записи и поля Claude Code без содержания переписки
DROP_TYPES = {'frame-link', 'custom-title', 'agent-name', 'cost-state', 'atis-latch', 'mode', 'tools-used', 'queue-operation', 'last-prompt'}
DROP_KEYS = {'signature', 'input_transformations', 'hookInfos'}


def clean(x):
    """Рекурсивно: base64-вложения → заглушка, секреты → [СКРЫТО]."""
    if isinstance(x, dict):
        src = x.get('source')
        if isinstance(src, dict) and src.get('type') == 'base64':
            return {'type': x.get('type', 'file'), 'omitted': f"{src.get('media_type', 'base64')} вырезано из бэкапа"}
        return {k: clean(v) for k, v in x.items() if k not in DROP_KEYS}
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, str):
        if len(x) >= 2000 and B64.match(x):
            return '[base64 вырезано из бэкапа]'
        return SECRET.sub('[СКРЫТО]', x)
    return x


def text_of(content):
    if isinstance(content, str):
        return content
    out = []
    for c in content or []:
        if not isinstance(c, dict):
            continue
        t = c.get('type')
        if t == 'text':
            out.append(c.get('text', ''))
        elif t == 'tool_use':
            out.append(f"[инструмент {c.get('name')}]")
        elif t in ('image', 'document'):
            out.append(f'[{t}]')
    return '\n'.join(o for o in out if o)


def main():
    hook = json.load(sys.stdin)
    tp = pathlib.Path(hook.get('transcript_path') or '')
    sid = re.sub(r'[^A-Za-z0-9_-]', '', str(hook.get('session_id') or tp.stem))
    if not tp.is_file() or not sid:
        return
    rows, md, start = [], [], None
    with tp.open(encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if raw.get('type') in DROP_TYPES:
                continue
            obj = clean(raw)
            rows.append(json.dumps(obj, ensure_ascii=False))
            ts = obj.get('timestamp')
            start = start or ts
            msg = obj.get('message') if isinstance(obj.get('message'), dict) else None
            if obj.get('type') in ('user', 'assistant') and msg and not obj.get('isMeta'):
                txt = text_of(msg.get('content')).strip()
                if txt and not txt.startswith('<'):
                    who = 'Доктор' if obj['type'] == 'user' else 'Claude'
                    md.append(f"### {who} · {str(ts or '')[:16].replace('T', ' ')}\n\n{txt}\n")
    day = (start or datetime.date.today().isoformat())[:10]
    out = ARCHIVE / 'chats' / 'claude-code'
    out.mkdir(parents=True, exist_ok=True)
    base = out / f'{day}_{sid}'
    (base.with_suffix('.jsonl')).write_text('\n'.join(rows) + '\n', encoding='utf-8')
    title = f"# Чат Claude Code {sid}\n\nНачат: {day}. Папка: {hook.get('cwd', '')}. Картинки вырезаны, секреты скрыты.\n\n"
    (base.with_suffix('.md')).write_text(title + '\n'.join(md), encoding='utf-8')
    print(base)


if __name__ == '__main__':
    main()
