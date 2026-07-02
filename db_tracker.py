"""
db_tracker.py — 追踪 SQLite 数据库内容变化并写入日志文件。

用法:
    python3 db_tracker.py [db_path] [log_path]

默认 db_path: data.db
默认 log_path: db_tracker.log

行为:
    1. 启动时全量解析 DB 内容写入 log 文件
    2. 轮询检测 DB 文件 mtime 变化，变化时重新解析并追加到 log
    3. 终端只显示状态信息，不显示具体数据内容
    4. Ctrl+C 干净退出
"""

import sys
import os
import time
import json
import sqlite3
import datetime
from pathlib import Path

SENSITIVE_FIELDS = {"password", "api_key"}
TRUNCATE_FIELDS = {"messages"}  # JSON 长字段截断显示长度
JSON_FIELDS = {"roles", "models", "agent_config", "agents", "pipeline", "prompts", "detail"}
SKIP_TABLES = {"schema_version", "messages_fts", "messages_fts_config", "messages_fts_data",
               "messages_fts_idx", "messages_fts_content", "messages_fts_docsize"}
# 只关注这些表，其他忽略
WATCH_TABLES = {"users", "user_configs", "projects"}


def fmt_time():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def fmt_header(text: str, width: int = 50) -> str:
    side = (width - len(text) - 2) // 2
    return f"{'=' * side} {text} {'=' * (width - side - len(text) - 2)}"


def parse_val(val, col_name: str) -> str:
    if val is None:
        return "NULL"
    if col_name in SENSITIVE_FIELDS:
        return "***"
    if col_name in JSON_FIELDS and isinstance(val, str):
        try:
            parsed = json.loads(val)
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        except (json.JSONDecodeError, TypeError):
            pass
    if col_name in TRUNCATE_FIELDS and isinstance(val, str) and len(val) > 200:
        return val[:200] + "..."
    s = str(val)
    if len(s) > 500:
        return s[:500] + "..."
    return s


def parse_database(db_path: str) -> str:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows_all = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    tables = [r["name"] for r in rows_all if r["name"] in WATCH_TABLES]

    lines = []
    for tbl_name in tables:
        try:
            cols = [c[1] for c in conn.execute(f"PRAGMA table_info({tbl_name})").fetchall()]
            rows = conn.execute(f"SELECT * FROM {tbl_name}").fetchall()
            row_count = len(rows)
            lines.append(f"\n── {tbl_name} ({row_count} rows) ──")
            if row_count > 0:
                lines.append("  " + " | ".join(cols))
                lines.append("  " + "-" * min(80, len(" | ".join(cols))))
                for row in rows:
                    vals = [parse_val(row[c], c) for c in cols]
                    line = "  " + " | ".join(vals)
                    if len(line) > 200:
                        line = line[:200] + "…"
                    lines.append(line)
        except sqlite3.OperationalError as e:
            lines.append(f"\n── {tbl_name} (error: {e}) ──")
    conn.close()
    return "\n".join(lines)


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "data.db"
    log_path = sys.argv[2] if len(sys.argv) > 2 else "db_tracker.log"
    db_path = os.path.abspath(db_path)
    log_path = os.path.abspath(log_path)

    if not os.path.isfile(db_path):
        print(f"[{fmt_time()}] [ERROR] DB 文件不存在: {db_path}")
        sys.exit(1)

    print(f"[{fmt_time()}] [db_tracker] Watching DB: {db_path}")
    print(f"[{fmt_time()}] [db_tracker] Log file:   {log_path}")

    last_mtime = os.path.getmtime(db_path)
    round_num = 0

    # 第一次立即解析
    content = parse_database(db_path)
    round_num += 1
    mtime_str = datetime.datetime.fromtimestamp(last_mtime).strftime("%Y-%m-%d %H:%M:%S")
    block = (
        f"\n\n{fmt_header(f'Round #{round_num} — initial', 60)}\n"
        f"Parsed at: {fmt_time()}\n"
        f"DB mtime:  {mtime_str}\n"
        f"{content}"
    )
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(block)
    print(f"[{fmt_time()}] [db_tracker] Round #{round_num}: {len(content)} bytes → {Path(log_path).name}")
    print(f"[{fmt_time()}] [db_tracker] Watching DB: {db_path}  (Ctrl+C to stop)")

    while True:
        time.sleep(1)
        current_mtime = os.path.getmtime(db_path)
        if current_mtime == last_mtime:
            continue

        last_mtime = current_mtime
        round_num += 1
        mtime_str = datetime.datetime.fromtimestamp(current_mtime).strftime("%Y-%m-%d %H:%M:%S")

        content = parse_database(db_path)
        block = (
            f"\n\n{fmt_header(f'Round #{round_num} — mtime changed at {mtime_str}', 60)}\n"
            f"Parsed at: {fmt_time()}\n"
            f"DB mtime:  {mtime_str}\n"
            f"{content}"
        )

        with open(log_path, "a", encoding="utf-8") as f:
            f.write(block)

        print(f"[{fmt_time()}] [db_tracker] Round #{round_num}: {len(content)} bytes → {Path(log_path).name}")
        print(f"[{fmt_time()}] [db_tracker] Watching DB: {db_path}  (Ctrl+C to stop)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n[{fmt_time()}] [db_tracker] Stopped.")
        sys.exit(0)
