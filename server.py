#!/usr/bin/env python3
"""Платформа продаж — локальный сервер.

Запускается на личном компьютере и больше никуда не ходит: слушает только
127.0.0.1, то есть снаружи к нему не подключиться. Внешних библиотек нет
ни одной — всё из стандартной поставки Python, поэтому ставить ничего не
нужно, достаточно самого Python.

Данные лежат рядом с программой, в папке data:
    data/platforma.db   записи и история правок (SQLite)
    data/files/         вложенные файлы как есть

Запуск:
    python3 server.py            обычный запуск, откроет браузер
    python3 server.py --port 8010 --no-browser
"""

import argparse
import html
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import sys
import threading
import time
import unicodedata
import uuid
import webbrowser
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
FILES_DIR = os.path.join(DATA_DIR, 'files')
DB_PATH = os.path.join(DATA_DIR, 'platforma.db')

# Вложение в 200 МБ — это уже не скан, а чья-то ошибка. Предел защищает
# диск и заодно подсказывает, что файл стоит сжать.
MAX_UPLOAD = 200 * 1024 * 1024

# Сколько версий хранить. Каждая правка пишет снимок целиком; при обычной
# работе это килобайты, но держать их бесконечно незачем.
MAX_REVISIONS = 500

ALLOWED_EXT = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf', '.odt', '.ods',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.bmp', '.tif', '.tiff',
    '.zip', '.rar', '.7z', '.eml', '.msg', '.json',
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS doc (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    json        TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,
    event       TEXT    NOT NULL DEFAULT '',
    json        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id          TEXT    PRIMARY KEY,
    owner_kind  TEXT    NOT NULL,
    owner_id    TEXT    NOT NULL,
    cp_id       TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL,
    mime        TEXT    NOT NULL DEFAULT '',
    size        INTEGER NOT NULL DEFAULT 0,
    kind        TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT '',
    valid_from  TEXT    NOT NULL DEFAULT '',
    uploaded_at TEXT    NOT NULL,
    path        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,
    event       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS files_owner ON files (owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS files_cp    ON files (cp_id);
CREATE INDEX IF NOT EXISTS rev_time    ON revisions (created_at);
"""

_db_lock = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    # WAL спасает от блокировок, когда страница открыта в нескольких вкладках
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    os.makedirs(FILES_DIR, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        row = conn.execute('SELECT json FROM doc WHERE id = 1').fetchone()
        if row is None:
            conn.execute(
                'INSERT INTO doc (id, json, updated_at) VALUES (1, ?, ?)',
                (json.dumps(empty_doc(), ensure_ascii=False), now_iso()),
            )


def empty_doc():
    return {
        'schema': 1,
        'counterparties': [],
        'orders': [],
        'documents': [],
        'payments': [],
        'schedule': [],
    }


# ------------------------------------------------------------------ #
# Имена файлов                                                        #
# ------------------------------------------------------------------ #
def safe_stored_name(file_id, original):
    """Имя файла на диске.

    Исходное имя сохраняется в базе как есть и отдаётся при скачивании, а
    на диске лежит очищенная версия с идентификатором впереди: так файлы
    не перетирают друг друга и не зависят от того, что` разрешает файловая
    система конкретного компьютера.
    """
    original = unicodedata.normalize('NFC', original or '')
    name = os.path.basename(original.replace('\\', '/'))
    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    stem = re.sub(r'[^\w.\- ]+', '_', stem, flags=re.UNICODE).strip() or 'file'
    return f'{file_id}__{stem[:80]}{ext[:12]}'


def ext_allowed(name):
    ext = os.path.splitext(name or '')[1].lower()
    return ext in ALLOWED_EXT


# ------------------------------------------------------------------ #
# Запросы к базе                                                      #
# ------------------------------------------------------------------ #
def read_doc():
    with connect() as conn:
        row = conn.execute('SELECT json, updated_at FROM doc WHERE id = 1').fetchone()
    if row is None:
        return empty_doc(), ''
    try:
        return json.loads(row['json']), row['updated_at']
    except json.JSONDecodeError:
        return empty_doc(), row['updated_at']


def write_doc(doc, event):
    """Сохранить документ и положить предыдущий в историю.

    В историю пишется состояние ДО правки: так «вернуть версию» означает
    вернуть то, что было видно на экране в тот момент.
    """
    payload = json.dumps(doc, ensure_ascii=False)
    stamp = now_iso()
    with _db_lock, connect() as conn:
        prev = conn.execute('SELECT json FROM doc WHERE id = 1').fetchone()
        if prev is not None and prev['json'] != payload:
            conn.execute(
                'INSERT INTO revisions (created_at, event, json) VALUES (?, ?, ?)',
                (stamp, (event or '')[:200], prev['json']),
            )
        conn.execute('UPDATE doc SET json = ?, updated_at = ? WHERE id = 1', (payload, stamp))
        extra = conn.execute(
            'SELECT id FROM revisions ORDER BY id DESC LIMIT -1 OFFSET ?', (MAX_REVISIONS,)
        ).fetchall()
        if extra:
            conn.executemany('DELETE FROM revisions WHERE id = ?', [(r['id'],) for r in extra])
    return stamp


def log_event(text):
    """Событие, которое не меняет записи: загрузка или удаление файла.

    Такие действия тоже часть истории, но снимок базы для них заводить
    незачем — вернуть «состояние до загрузки файла» всё равно нельзя.
    """
    if not text:
        return
    with connect() as conn:
        conn.execute('INSERT INTO events (created_at, event) VALUES (?, ?)', (now_iso(), text[:200]))
        extra = conn.execute(
            'SELECT id FROM events ORDER BY id DESC LIMIT -1 OFFSET ?', (MAX_REVISIONS * 4,)
        ).fetchall()
        if extra:
            conn.executemany('DELETE FROM events WHERE id = ?', [(r['id'],) for r in extra])


def list_revisions(limit=100):
    """Единая лента: снимки базы и события по файлам вперемешку, по времени.

    У снимка есть номер — к нему можно вернуться. У события номера нет:
    оно только рассказывает, что произошло.
    """
    with connect() as conn:
        revs = conn.execute(
            'SELECT id, created_at, event, length(json) AS size '
            'FROM revisions ORDER BY id DESC LIMIT ?', (limit,)
        ).fetchall()
        evs = conn.execute(
            'SELECT created_at, event FROM events ORDER BY id DESC LIMIT ?', (limit,)
        ).fetchall()
    feed = [dict(r, restorable=True) for r in revs]
    feed += [{'id': None, 'created_at': r['created_at'], 'event': r['event'],
              'size': 0, 'restorable': False} for r in evs]
    feed.sort(key=lambda r: r['created_at'], reverse=True)
    return feed[:limit]


def revision_doc(rev_id):
    with connect() as conn:
        row = conn.execute('SELECT json FROM revisions WHERE id = ?', (rev_id,)).fetchone()
    return json.loads(row['json']) if row else None


def list_files(owner_kind=None, owner_id=None, cp_id=None):
    sql = 'SELECT * FROM files'
    where, args = [], []
    if owner_kind:
        where.append('owner_kind = ?')
        args.append(owner_kind)
    if owner_id:
        where.append('owner_id = ?')
        args.append(owner_id)
    if cp_id:
        where.append('cp_id = ?')
        args.append(cp_id)
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY uploaded_at DESC, rowid DESC'
    with connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [file_row(r) for r in rows]


def file_row(r):
    return {
        'id': r['id'], 'ownerKind': r['owner_kind'], 'ownerId': r['owner_id'],
        'cpId': r['cp_id'], 'name': r['name'], 'mime': r['mime'], 'size': r['size'],
        'kind': r['kind'], 'note': r['note'], 'validFrom': r['valid_from'],
        'uploadedAt': r['uploaded_at'],
    }


def get_file(file_id):
    with connect() as conn:
        row = conn.execute('SELECT * FROM files WHERE id = ?', (file_id,)).fetchone()
    return row


def save_file(owner_kind, owner_id, cp_id, name, mime, data, kind='', note='', valid_from=''):
    file_id = uuid.uuid4().hex
    stored = safe_stored_name(file_id, name)
    path = os.path.join(FILES_DIR, stored)
    with open(path, 'wb') as fh:
        fh.write(data)
    with connect() as conn:
        conn.execute(
            'INSERT INTO files (id, owner_kind, owner_id, cp_id, name, mime, size, kind, note,'
            ' valid_from, uploaded_at, path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (file_id, owner_kind, owner_id, cp_id, name, mime, len(data), kind, note,
             valid_from, now_iso(), stored),
        )
        row = conn.execute('SELECT * FROM files WHERE id = ?', (file_id,)).fetchone()
    return file_row(row)


def update_file(file_id, fields):
    allowed = {'kind': 'kind', 'note': 'note', 'validFrom': 'valid_from', 'name': 'name'}
    sets, args = [], []
    for key, column in allowed.items():
        if key in fields:
            sets.append(f'{column} = ?')
            args.append(str(fields[key])[:300])
    if not sets:
        return None
    args.append(file_id)
    with connect() as conn:
        conn.execute(f'UPDATE files SET {", ".join(sets)} WHERE id = ?', args)
        row = conn.execute('SELECT * FROM files WHERE id = ?', (file_id,)).fetchone()
    return file_row(row) if row else None


def delete_file(file_id):
    row = get_file(file_id)
    if row is None:
        return False
    try:
        os.remove(os.path.join(FILES_DIR, row['path']))
    except FileNotFoundError:
        pass
    with connect() as conn:
        conn.execute('DELETE FROM files WHERE id = ?', (file_id,))
    return True


def delete_files_for(owner_kind, owner_id):
    for meta in list_files(owner_kind, owner_id):
        delete_file(meta['id'])


def storage_stats():
    with connect() as conn:
        row = conn.execute('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files').fetchone()
        revs = conn.execute('SELECT COUNT(*) AS n FROM revisions').fetchone()
    return {
        'files': row['n'], 'bytes': row['bytes'], 'revisions': revs['n'],
        'dbBytes': os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0,
        'dataDir': DATA_DIR,
    }


def cleanup_orphans(known_ids):
    """Убрать вложения, на которые больше никто не ссылается."""
    known = set(known_ids or [])
    removed = 0
    for meta in list_files():
        owner_kind, owner_id = meta['ownerKind'], meta['ownerId']
        if f'{owner_kind}:{owner_id}' not in known:
            delete_file(meta['id'])
            removed += 1
    # Файлы на диске без записи в базе — остатки от сбоя при загрузке
    with connect() as conn:
        paths = {r['path'] for r in conn.execute('SELECT path FROM files').fetchall()}
    for entry in os.listdir(FILES_DIR):
        if entry not in paths:
            try:
                os.remove(os.path.join(FILES_DIR, entry))
                removed += 1
            except OSError:
                pass
    return removed


# ------------------------------------------------------------------ #
# HTTP                                                                #
# ------------------------------------------------------------------ #
STATIC_ROOT = BASE_DIR
STATIC_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
}


class Handler(BaseHTTPRequestHandler):
    server_version = 'PlatformaProdazh'
    protocol_version = 'HTTP/1.1'

    # -- служебное -------------------------------------------------- #
    def log_message(self, fmt, *args):
        if self.path.startswith('/api/'):
            sys.stderr.write('%s  %s\n' % (datetime.now().strftime('%H:%M:%S'), fmt % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        self.send_json({'error': message}, status)

    def read_body(self, limit=MAX_UPLOAD):
        length = int(self.headers.get('Content-Length') or 0)
        if length > limit:
            raise ValueError('Файл больше допустимого размера')
        return self.rfile.read(length) if length else b''

    def read_json(self):
        raw = self.read_body(limit=64 * 1024 * 1024)
        if not raw:
            return {}
        return json.loads(raw.decode('utf-8'))

    # -- маршруты --------------------------------------------------- #
    def do_GET(self):
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            if path.startswith('/api/'):
                return self.api_get(path, query)
            return self.serve_static(path)
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001 — иначе падает всё приложение
            self.fail(500, f'{type(exc).__name__}: {exc}')

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            return self.api_post(parsed.path, parse_qs(parsed.query))
        except ValueError as exc:
            self.fail(413, str(exc))
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001
            self.fail(500, f'{type(exc).__name__}: {exc}')

    def do_DELETE(self):
        parsed = urlparse(self.path)
        try:
            match = re.fullmatch(r'/api/files/([0-9a-f]{32})', parsed.path)
            if match:
                row = get_file(match.group(1))
                ok = delete_file(match.group(1))
                if ok and row is not None:
                    log_event('Удалён файл «%s»' % row['name'])
                return self.send_json({'ok': ok}) if ok else self.fail(404, 'Файл не найден')
            return self.fail(404, 'Неизвестный адрес')
        except Exception as exc:  # noqa: BLE001
            self.fail(500, f'{type(exc).__name__}: {exc}')

    # -- API ---------------------------------------------------------- #
    def api_get(self, path, query):
        if path == '/api/state':
            doc, updated = read_doc()
            return self.send_json({
                'doc': doc,
                'updatedAt': updated,
                'files': list_files(),
                'storage': storage_stats(),
            })

        if path == '/api/history':
            limit = min(int(query.get('limit', ['100'])[0] or 100), 500)
            return self.send_json({'revisions': list_revisions(limit)})

        if path == '/api/files':
            return self.send_json({'files': list_files(
                (query.get('ownerKind') or [None])[0],
                (query.get('ownerId') or [None])[0],
                (query.get('cpId') or [None])[0],
            )})

        match = re.fullmatch(r'/api/files/([0-9a-f]{32})', path)
        if match:
            return self.serve_attachment(match.group(1), query.get('download'))

        if path == '/api/storage':
            return self.send_json(storage_stats())

        return self.fail(404, 'Неизвестный адрес')

    def api_post(self, path, query):
        if path == '/api/state':
            payload = self.read_json()
            doc = payload.get('doc')
            if not isinstance(doc, dict) or 'counterparties' not in doc:
                return self.fail(400, 'Ожидался документ с полем counterparties')
            stamp = write_doc(doc, payload.get('event', ''))
            return self.send_json({'ok': True, 'updatedAt': stamp})

        if path == '/api/files':
            return self.upload(query)

        match = re.fullmatch(r'/api/files/([0-9a-f]{32})', path)
        if match:
            meta = update_file(match.group(1), self.read_json())
            return self.send_json({'file': meta}) if meta else self.fail(404, 'Файл не найден')

        match = re.fullmatch(r'/api/history/(\d+)/restore', path)
        if match:
            doc = revision_doc(int(match.group(1)))
            if doc is None:
                return self.fail(404, 'Версия не найдена')
            write_doc(doc, 'Возврат к сохранённой версии')
            return self.send_json({'ok': True, 'doc': doc})

        if path == '/api/cleanup':
            payload = self.read_json()
            removed = cleanup_orphans(payload.get('owners') or [])
            return self.send_json({'removed': removed})

        if path == '/api/owner-removed':
            payload = self.read_json()
            delete_files_for(payload.get('ownerKind', ''), payload.get('ownerId', ''))
            return self.send_json({'ok': True})

        return self.fail(404, 'Неизвестный адрес')

    def upload(self, query):
        name = unquote((query.get('name') or [''])[0]) or 'file'
        owner_kind = (query.get('ownerKind') or [''])[0]
        owner_id = (query.get('ownerId') or [''])[0]
        cp_id = (query.get('cpId') or [''])[0]
        kind = (query.get('kind') or [''])[0]
        if not owner_kind or not owner_id:
            return self.fail(400, 'Не указано, к чему относится файл')
        if not ext_allowed(name):
            return self.fail(415, 'Такой тип файла не принимается: ' + os.path.splitext(name)[1])
        data = self.read_body()
        if not data:
            return self.fail(400, 'Пустой файл')
        mime = self.headers.get('Content-Type') or mimetypes.guess_type(name)[0] or 'application/octet-stream'
        meta = save_file(owner_kind, owner_id, cp_id, name, mime, data, kind=kind)
        label = unquote((query.get('label') or [''])[0])
        log_event('Загружен файл «%s»%s' % (name, (' — ' + label) if label else ''))
        return self.send_json({'file': meta})

    def serve_attachment(self, file_id, download):
        row = get_file(file_id)
        if row is None:
            return self.fail(404, 'Файл не найден')
        full = os.path.join(FILES_DIR, row['path'])
        if not os.path.exists(full):
            return self.fail(410, 'Файл удалён с диска')
        size = os.path.getsize(full)
        disposition = 'attachment' if download else 'inline'
        # Имя отдаём и в ASCII, и в UTF-8: старые клиенты возьмут первое,
        # современные — filename*, и кириллица не потеряется
        ascii_name = re.sub(r'[^\x20-\x7e]', '_', row['name']) or 'file'
        self.send_response(200)
        self.send_header('Content-Type', row['mime'] or 'application/octet-stream')
        self.send_header('Content-Length', str(size))
        self.send_header(
            'Content-Disposition',
            f'{disposition}; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote_name(row['name'])}",
        )
        self.send_header('Cache-Control', 'private, max-age=60')
        self.end_headers()
        with open(full, 'rb') as fh:
            shutil.copyfileobj(fh, self.wfile)

    # -- статика ------------------------------------------------------ #
    def serve_static(self, path):
        rel = '/index.html' if path in ('/', '') else path
        target = os.path.normpath(os.path.join(STATIC_ROOT, rel.lstrip('/')))
        # Защита от выхода за пределы папки программы (../../etc/passwd)
        if not target.startswith(STATIC_ROOT + os.sep) and target != STATIC_ROOT:
            return self.fail(403, 'Доступ запрещён')
        if os.path.isdir(target):
            target = os.path.join(target, 'index.html')
        if not os.path.exists(target):
            self.send_response(404)
            body = b'<h1>404</h1>'
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        ext = os.path.splitext(target)[1].lower()
        ctype = STATIC_TYPES.get(ext) or mimetypes.guess_type(target)[0] or 'application/octet-stream'
        size = os.path.getsize(target)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        with open(target, 'rb') as fh:
            shutil.copyfileobj(fh, self.wfile)


def quote_name(name):
    from urllib.parse import quote
    return quote(name, safe='')


def local_ip():
    """Адрес компьютера в домашней сети — чтобы подсказать его для телефона."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('10.255.255.255', 1))
            return sock.getsockname()[0]
    except OSError:
        return '127.0.0.1'


def run(port, host='127.0.0.1', open_browser=True):
    init_db()
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f'http://127.0.0.1:{port}/'
    print('\n  Платформа продаж запущена')
    print(f'  Откройте в браузере:  {url}')
    if host != '127.0.0.1':
        print(f'  С телефона в той же сети:  http://{local_ip()}:{port}/')
        print('  ВНИМАНИЕ: пароля у платформы нет. Любой в этой же сети')
        print('            сможет открыть ваши данные. Включайте только дома.')
    print(f'  Данные лежат здесь:   {DATA_DIR}')
    print('  Остановить: Ctrl+C в этом окне\n')
    if open_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n  Остановлено. Данные сохранены.\n')
    finally:
        httpd.server_close()


def main():
    parser = argparse.ArgumentParser(description='Платформа продаж — локальный сервер')
    parser.add_argument('--port', type=int, default=8765, help='порт (по умолчанию 8765)')
    parser.add_argument('--host', default='127.0.0.1',
                        help='0.0.0.0 — открыть доступ из домашней сети (по умолчанию только этот компьютер)')
    parser.add_argument('--no-browser', action='store_true', help='не открывать браузер')
    args = parser.parse_args()

    port = args.port
    for attempt in range(20):
        try:
            run(port, host=args.host, open_browser=not args.no_browser)
            return
        except OSError as exc:
            # Порт занят — обычно это уже запущенная копия программы
            if getattr(exc, 'errno', None) in (48, 98, 10048) and attempt < 19:
                print(f'  Порт {port} занят, пробуем {port + 1}')
                port += 1
                continue
            raise


if __name__ == '__main__':
    main()
