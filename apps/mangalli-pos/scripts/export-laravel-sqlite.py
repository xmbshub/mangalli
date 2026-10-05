#!/usr/bin/env python3
"""Export the legacy Laravel SQLite database into a reviewed JSON handoff.

The export contains password and device-token hashes. Keep it root/operator-only,
never commit it, and delete working copies after the cutover rehearsal.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path


TABLES = (
    "outlets",
    "users",
    "categories",
    "products",
    "product_photos",
    "product_modifier_groups",
    "product_modifier_options",
    "qr_tables",
    "pos_shifts",
    "orders",
    "order_items",
    "payments",
    "pos_audit_logs",
    "pos_cash_handovers",
    "android_pos_devices",
    "android_pos_staff_sessions",
    "android_pos_sync_events",
)


def fail(message: str) -> None:
    raise SystemExit(message)


arguments = [argument for argument in sys.argv[1:] if argument != "--"]
if len(arguments) != 2:
    fail("Usage: export-laravel-sqlite.py <source.sqlite> <output.json>")

source = Path(arguments[0]).resolve()
target = Path(arguments[1]).resolve()
if not source.is_file():
    fail(f"SQLite source does not exist: {source}")
if target.exists():
    fail(f"Refusing to overwrite existing export: {target}")

source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
try:
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        fail(f"SQLite integrity check failed: {integrity}")
    available = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    missing = sorted(set(TABLES) - available)
    if missing:
        fail(f"Required legacy tables are missing: {', '.join(missing)}")
    tables = {
        table: [dict(row) for row in connection.execute(f'SELECT * FROM "{table}" ORDER BY id')]
        for table in TABLES
    }
finally:
    connection.close()

payload = {
    "format": "mangalli-laravel-sqlite-v1",
    "sourceSha256": source_hash,
    "counts": {table: len(rows) for table, rows in tables.items()},
    "tables": tables,
}
target.parent.mkdir(parents=True, exist_ok=True)
descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w", encoding="utf-8") as output:
    json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))
    output.write("\n")

print(json.dumps({
    "format": payload["format"],
    "sourceSha256": source_hash,
    "counts": payload["counts"],
    "output": str(target),
}, separators=(",", ":")))
