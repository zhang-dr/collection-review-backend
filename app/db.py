import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "reports.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


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
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_report(name: str, date_a_label: str, date_b_label: str, data: dict) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO reports (name, date_a_label, date_b_label, data_json, warnings_json) VALUES (?, ?, ?, ?, ?)",
            (name, date_a_label, date_b_label, json.dumps(data), json.dumps(data.get("warnings", []))),
        )
        conn.commit()
        return cur.lastrowid


def list_reports() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, created_at, name, date_a_label, date_b_label FROM reports ORDER BY id DESC"
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


def delete_report(report_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM reports WHERE id = ?", (report_id,))
        conn.commit()
        return cur.rowcount > 0
