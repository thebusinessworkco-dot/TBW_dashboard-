#!/usr/bin/env python3
"""READ-ONLY SQLite inventory. No customer rows or credentials are exported."""
import json
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

if len(sys.argv) != 2:
    raise SystemExit('Usage: python scripts/audit_sqlite.py PATH_TO_SAFE_BACKUP.db')
path = Path(sys.argv[1]).resolve(strict=True)
uri = 'file:' + quote(str(path), safe='/') + '?mode=ro'
conn = sqlite3.connect(uri, uri=True)
try:
    integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
    foreign_key_violations = conn.execute('PRAGMA foreign_key_check').fetchall()
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    report = {
        'integrity_check': integrity,
        'foreign_key_violation_count': len(foreign_key_violations),
        'tables': [],
    }
    for table in tables:
        quoted = '"' + table.replace('"', '""') + '"'
        columns = [dict(name=c[1], type=c[2], not_null=bool(c[3]), primary_key=bool(c[5])) for c in conn.execute(f'PRAGMA table_info({quoted})')]
        row_count = conn.execute(f'SELECT count(*) FROM {quoted}').fetchone()[0]
        report['tables'].append({'table': table, 'rows': row_count, 'columns': columns})
    print(json.dumps(report, indent=2))
    if integrity != 'ok' or foreign_key_violations:
        raise SystemExit('Database integrity issues found. Stop migration.')
finally:
    conn.close()
