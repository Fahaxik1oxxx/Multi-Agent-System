"""
安全代码执行沙箱 —— Docker 容器隔离。
Docker 不可用时降级为 subprocess。
"""

import subprocess
import uuid
import os
import logging

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(_PROJECT_DIR, "coding")


def _docker_available() -> bool:
    """检测 Docker 是否可用"""
    try:
        subprocess.run(["docker", "--version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


DOCKER_OK = _docker_available()


class CodeExecutor:
    """代码执行沙箱 — 优先 Docker，降级 subprocess"""

    TIMEOUT = 30

    def execute(self, code: str) -> dict:
        if DOCKER_OK:
            return self._docker_exec(code)
        raise RuntimeError("Docker 不可用，代码执行已禁用。请安装 Docker 后重启服务。")

    def _docker_exec(self, code: str) -> dict:
        os.makedirs(WORKSPACE, exist_ok=True)
        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")
        container_name = f"sandbox_{file_id}"

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            result = subprocess.run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--name",
                    container_name,
                    "--network",
                    "none",
                    "--memory",
                    "256m",
                    "--cpus",
                    "0.5",
                    "--read-only",
                    "--tmpfs",
                    "/tmp:exec",
                    "-v",
                    f"{os.path.abspath(filepath)}:/code.py:ro",
                    "python:3.11-slim",
                    "python",
                    "/code.py",
                ],
                capture_output=True,
                text=True,
                timeout=self.TIMEOUT,
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitcode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "kill", container_name], capture_output=True)
            return {"stdout": "", "stderr": f"执行超时 (>{self.TIMEOUT}s)", "exitcode": 1}
        finally:
            if os.path.exists(filepath):
                os.remove(filepath)

    def _subprocess_exec(self, code: str) -> dict:
        os.makedirs(WORKSPACE, exist_ok=True)
        file_id = str(uuid.uuid4())[:8]
        filepath = os.path.join(WORKSPACE, f"tmp_{file_id}.py")

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(code)

        try:
            result = subprocess.run(
                ["python", filepath],
                capture_output=True,
                text=True,
                timeout=self.TIMEOUT,
                cwd=WORKSPACE,
            )
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitcode": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": f"执行超时 (>{self.TIMEOUT}s)", "exitcode": 1}
        finally:
            if os.path.exists(filepath):
                os.remove(filepath)
