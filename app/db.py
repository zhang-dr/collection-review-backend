import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "reports.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _column_exists(conn, table: str, column: str) -> bool:
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    return column in cols


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                name TEXT NOT NULL,
                date_a_label TEXT NOT NULL,
                date_b_label TEXT NOT NULL,
                data_json TEXT NOT NULL,
                warnings_json TEXT NOT NULL DEFAULT '[]'
            )
        """)
        # migration: older deployments may not have these columns yet.
        if not _column_exists(conn, "reports", "author"):
            conn.execute("ALTER TABLE reports ADD COLUMN author TEXT NOT NULL DEFAULT ''")
        if not _column_exists(conn, "reports", "granularity"):
            conn.execute("ALTER TABLE reports ADD COLUMN granularity TEXT NOT NULL DEFAULT 'day'")
        if not _column_exists(conn, "reports", "insights"):
            conn.execute("ALTER TABLE reports ADD COLUMN insights TEXT")
        if not _column_exists(conn, "reports", "insights_provider"):
            conn.execute("ALTER TABLE reports ADD COLUMN insights_provider TEXT")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        if not _column_exists(conn, "users", "can_use_ai"):
            conn.execute("ALTER TABLE users ADD COLUMN can_use_ai INTEGER NOT NULL DEFAULT 0")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

def save_report(name: str, date_a_label: str, date_b_label: str, data: dict,
                 author: str = "", granularity: str = "day") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO reports (name, date_a_label, date_b_label, data_json, warnings_json, author, granularity) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, date_a_label, date_b_label, json.dumps(data), json.dumps(data.get("warnings", [])),
             author, granularity),
        )
        conn.commit()
        return cur.lastrowid


def list_reports() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, created_at, name, date_a_label, date_b_label, author, granularity "
            "FROM reports ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_report(report_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["data"] = json.loads(d.pop("data_json"))
        d["warnings"] = json.loads(d.pop("warnings_json"))
        return d


def save_insights(report_id: int, text: str, provider: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE reports SET insights = ?, insights_provider = ? WHERE id = ?",
                     (text, provider, report_id))
        conn.commit()


def delete_report(report_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM reports WHERE id = ?", (report_id,))
        conn.commit()
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Users / sessions (lightweight auth — no email verification, no password
# reset flow; a username is unique per account and a password is optional)
# ---------------------------------------------------------------------------

def get_user_by_username(username: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_user(username: str, password_salt: str, password_hash: str) -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_salt, password_hash) VALUES (?, ?, ?)",
            (username, password_salt, password_hash),
        )
        conn.commit()
        return {"id": cur.lastrowid, "username": username,
                "password_salt": password_salt, "password_hash": password_hash,
                "can_use_ai": 0}


def list_users() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, username, can_use_ai, created_at FROM users ORDER BY username COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]


def set_user_ai_access(user_id: int, allowed: bool) -> bool:
    with get_conn() as conn:
        cur = conn.execute("UPDATE users SET can_use_ai = ? WHERE id = ?", (1 if allowed else 0, user_id))
        conn.commit()
        return cur.rowcount > 0


def create_session(user_id: int, token: str) -> None:
    with get_conn() as conn:
        conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        conn.commit()


def get_user_by_token(token: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("""
            SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
        """, (token,)).fetchone()
        return dict(row) if row else None


def delete_session(token: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def get_setting(key: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            (key, value),
        )
        conn.commit()


def delete_setting(key: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM settings WHERE key = ?", (key,))
        conn.commit()
