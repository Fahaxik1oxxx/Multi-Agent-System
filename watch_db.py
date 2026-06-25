"""手动启动的数据库追踪脚本：检测 data.db 变化后自动 dump"""
import time
import os
from user.db import Database

BASE = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE, "data.db")
LOG_PATH = os.path.join(BASE, "db_debug.log")


def main():
    db = Database(DB_PATH)
    last_mtime = 0

    print(f"追踪中，按 Ctrl+C 停止...")

    while True:
        try:
            mtime = os.path.getmtime(DB_PATH)
        except OSError:
            time.sleep(1)
            continue

        if mtime != last_mtime:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(db.dump_all() + "\n")
            print(f"  [dump] {time.strftime('%H:%M:%S')}")
            last_mtime = mtime

        time.sleep(1)


if __name__ == "__main__":
    main()
