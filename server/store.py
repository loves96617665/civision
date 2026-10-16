"""store.py — SQLite 持久化层（线程安全，WAL 模式）。"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any, Iterable, Optional

from config import DATA_DIR

DB_FILE = os.path.join(DATA_DIR, "gateway.db")

_local = threading.local()
_write_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  key_tail    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  models      TEXT NOT NULL DEFAULT '["*"]',
  rpm         INTEGER NOT NULL DEFAULT 0,
  quota       INTEGER NOT NULL DEFAULT 0,
  used        INTEGER NOT NULL DEFAULT 0,
  note        TEXT NOT NULL DEFAULT '',
  created     REAL NOT NULL,
  last_used   REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  cookie         TEXT NOT NULL DEFAULT '',
  token          TEXT NOT NULL DEFAULT '',
  password       TEXT NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,
  healthy        INTEGER NOT NULL DEFAULT 1,
  cooldown_until REAL NOT NULL DEFAULT 0,
  requests       INTEGER NOT NULL DEFAULT 0,
  failures       INTEGER NOT NULL DEFAULT 0,
  quota          TEXT NOT NULL DEFAULT '{}',
  last_error     TEXT NOT NULL DEFAULT '',
  disabled_reason TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'manual',
  created        REAL NOT NULL,
  last_used      REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS models (
  alias       TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  sd_version  TEXT NOT NULL DEFAULT '',
  sub_version TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  sub_label   TEXT NOT NULL DEFAULT '',
  version_id  INTEGER NOT NULL DEFAULT 0,
  model       TEXT NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 1,
  note        TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  model        TEXT NOT NULL DEFAULT '',
  prompt       TEXT NOT NULL DEFAULT '',
  params       TEXT NOT NULL DEFAULT '{}',
  outputs      TEXT NOT NULL DEFAULT '[]',
  error        TEXT NOT NULL DEFAULT '',
  account_id   TEXT NOT NULL DEFAULT '',
  account_label TEXT NOT NULL DEFAULT '',
  upstream     TEXT NOT NULL DEFAULT '{}',
  key_id       TEXT NOT NULL DEFAULT '',
  starred      INTEGER NOT NULL DEFAULT 0,
  created      REAL NOT NULL,
  started      REAL NOT NULL DEFAULT 0,
  finished     REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);

CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      REAL NOT NULL,
  level   TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  meta    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);

CREATE TABLE IF NOT EXISTS usage (
  key_id TEXT NOT NULL,
  day    TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);

CREATE TABLE IF NOT EXISTS jobs (
  id      TEXT PRIMARY KEY,
  kind    TEXT NOT NULL,
  status  TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  steps   TEXT NOT NULL DEFAULT '[]',
  created REAL NOT NULL,
  updated REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
"""


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(DB_FILE, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA busy_timeout=30000")
        _local.conn = c
    return c


def init() -> None:
    with _write_lock:
        conn().executescript(SCHEMA)
        conn().commit()


def q(sql: str, args: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return list(conn().execute(sql, tuple(args)))


def q1(sql: str, args: Iterable[Any] = ()) -> Optional[sqlite3.Row]:
    rows = q(sql, args)
    return rows[0] if rows else None


def execute(sql: str, args: Iterable[Any] = ()) -> None:
    with _write_lock:
        c = conn()
        c.execute(sql, tuple(args))
        c.commit()


def executemany(sql: str, rows: Iterable[Iterable[Any]]) -> None:
    with _write_lock:
        c = conn()
        c.executemany(sql, [tuple(r) for r in rows])
        c.commit()


def jload(v: Any, default: Any = None) -> Any:
    if v is None or v == "":
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except Exception:
        return default


def jdump(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)


# ------------------------------------------------------------------ 日志
_LOG_BUFFER: list[tuple] = []
_LOG_LOCK = threading.Lock()
_MAX_BUFFER = 50


def log(level: str, source: str, message: str, **meta: Any) -> None:
    row = (time.time(), level, source, message[:4000], jdump(meta))
    with _LOG_LOCK:
        _LOG_BUFFER.append(row)
        if len(_LOG_BUFFER) >= _MAX_BUFFER:
            flush_logs()


def flush_logs() -> None:
    with _LOG_LOCK:
        if not _LOG_BUFFER:
            return
        rows = list(_LOG_BUFFER)
        _LOG_BUFFER.clear()
    try:
        executemany("INSERT INTO logs (ts,level,source,message,meta) VALUES (?,?,?,?,?)", rows)
    except Exception:
        pass


def recent_logs(limit: int = 200, level: str = "") -> list[dict]:
    flush_logs()
    if level:
        rows = q("SELECT * FROM logs WHERE level=? ORDER BY ts DESC LIMIT ?", (level, limit))
    else:
        rows = q("SELECT * FROM logs ORDER BY ts DESC LIMIT ?", (limit,))
    return [dict(r) | {"meta": jload(r["meta"], {})} for r in rows]


def prune_logs(keep: int = 5000) -> None:
    execute("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY ts DESC LIMIT ?)", (keep,))
