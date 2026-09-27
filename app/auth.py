"""
Lightweight username(+optional password) auth.

Not a real identity system — no email verification, no password-reset flow,
no rate limiting. It exists purely so a generated report can be stamped with
an author name, and so "history" can show who made what. First login for a
given username creates the account (using whatever password was given, which
may be blank); subsequent logins with that username must match the same
password.
"""
from __future__ import annotations

import hashlib
import secrets

from . import db

PBKDF2_ITERATIONS = 200_000


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS).hex()


def login_or_register(username: str, password: str) -> dict:
    """Log in an existing user (verifying password) or create a new one
    (with whatever password was supplied). Returns the user's session token."""
    username = username.strip()
    if not username:
        raise ValueError("Username is required.")

    user = db.get_user_by_username(username)
    if user is None:
        salt = secrets.token_hex(16)
        pw_hash = _hash_password(password, salt)
        user = db.create_user(username, salt, pw_hash)
    else:
        salt = user["password_salt"] or secrets.token_hex(16)
        pw_hash = _hash_password(password, salt)
        if pw_hash != user["password_hash"]:
            raise PermissionError("Wrong password for this username.")

    token = secrets.token_hex(24)
    db.create_session(user["id"], token)
    return {"token": token, "username": user["username"]}


def user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    return db.get_user_by_token(token)
