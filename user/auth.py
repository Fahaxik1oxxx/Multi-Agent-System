"""
密码哈希 + JWT 创建/解码 —— 纯函数，无状态。
"""

import os
import time
import bcrypt
import jwt

_JWT_SECRET = os.getenv("JWT_SECRET")
_WEAK_SECRETS = {"zeng-key-123456", "change-me", "secret", "dev-secret", "test"}
if not _JWT_SECRET:
    raise RuntimeError("JWT_SECRET 环境变量未设置，请在 .env 中配置 JWT_SECRET=<强随机密钥>")
if _JWT_SECRET in _WEAK_SECRETS:
    raise RuntimeError("JWT_SECRET 使用已知弱密钥，请更换为强随机值（建议: python -c 'import secrets; print(secrets.token_urlsafe(32))'）")
_JWT_ALGO = "HS256"
_JWT_TTL = 7 * 24 * 3600  # 7 天


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_jwt(user_id: str, name: str, is_admin: bool = False) -> str:
    payload = {
        "sub": user_id,
        "name": name,
        "is_admin": is_admin,
        "iat": int(time.time()),
        "exp": int(time.time()) + _JWT_TTL,
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGO)


def decode_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO])
    except jwt.PyJWTError:
        return None
