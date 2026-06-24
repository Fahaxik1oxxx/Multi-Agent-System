"""
安全代码执行沙箱 —— 替代 AG2 UserProxyAgent。
在 coding/ 目录下用 subprocess 隔离执行 Python 代码。
"""

import subprocess
import uuid
import os

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(_PROJECT_DIR, "coding")


class CodeExecutor:
    """安全代码执行沙箱"""

    TIMEOUT = 60  # 秒

    def execute(self, code: str) -> dict:
        """
        1. 写入 coding/tmp_{uuid}.py
        2. subprocess.run 执行
        3. 清理临时文件
        返回 {"stdout": str, "stderr": str, "exitcode": int}
        """
        os.makedirs(WORKSPACE, exist_ok=True)

        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            result = subprocess.run(
                ["python", filepath],
                capture_output=True, text=True,
                timeout=self.TIMEOUT, cwd=WORKSPACE,
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitcode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": "执行超时 (>60s)", "exitcode": 1}
        finally:
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except OSError:
                    pass
