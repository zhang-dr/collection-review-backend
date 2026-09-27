"""Small password-based account system with admin-only registration."""
from __future__ import annotations

import hashlib
import secrets

from . import db

PBKDF2_ITERATIONS = 200_000


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS).hex()


def login(username: str, password: str) -> dict:
    """Authenticate an existing user and return a new session token."""
    username = username.strip()
    if not username or not password:
        raise ValueError("Username and password are required.")

    user = db.get_user_by_username(username)
    if user is None:
        raise PermissionError("Invalid username or password.")
    salt = user["password_salt"]
    pw_hash = _hash_password(password, salt)
    if not secrets.compare_digest(pw_hash, user["password_hash"]):
        raise PermissionError("Invalid username or password.")

    token = secrets.token_hex(24)
    db.create_session(user["id"], token)
    return {"token": token, "username": user["username"]}


def register_user(username: str, password: str) -> dict:
    """Create a user. Callers must enforce administrator authorization."""
    username = username.strip()
    if not username or not password:
        raise ValueError("Username and password are required.")
    if db.get_user_by_username(username) is not None:
        raise ValueError("Username already exists.")
    salt = secrets.token_hex(16)
    return db.create_user(username, salt, _hash_password(password, salt))


def user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    return db.get_user_by_token(token)
