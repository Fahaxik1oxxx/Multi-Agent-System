"""
pytest 配置 — 测试期间禁用 slowapi 速率限制，
避免 TestClient（所有请求共享 "testclient" 键）触发限制。
"""
import pytest


@pytest.fixture(autouse=True)
def _disable_limiter():
    """在每个测试函数执行前禁用 slowapi limiter，测试后恢复。"""
    from main import limiter
    limiter.enabled = False
    yield
    limiter.enabled = True
