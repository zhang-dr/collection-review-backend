"""
Lightweight username(+optional password) auth — admin-gated.

Not a real identity system — no email verification, no password-reset flow,
no rate limiting. It exists so a generated report can be stamped with an
author name, "history" can show who made what, and (new) so AI-insights
usage — which costs real API money — can be restricted to specific accounts.

Accounts are no longer self-service: only the hardcoded admin username can
create new accounts (via admin_create_user, called from an admin-only API
endpoint). The one exception is the admin account itself, which bootstraps
on its own first login — there would otherwise be no way to create the very
first account. On every login, the admin username is self-healed to
is_admin=1/ai_allowed=1 regardless of what's in the DB, so it can't
accidentally lose admin rights (e.g. an older DB row from before this
migration, or a row edited by hand).
"""
from __future__ import annotations

import hashlib
import secrets

from . import db

PBKDF2_ITERATIONS = 200_000
ADMIN_USERNAME = "Xihao"


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS).hex()


def login_or_register(username: str, password: str) -> dict:
    """Log in an existing user (verifying password), or — only for the
    hardcoded admin username — bootstrap that one account on first login.
    Any other unknown username is rejected: accounts must be created by the
    admin via admin_create_user(). Returns the session token plus the
    account's admin/AI-access flags, so the frontend can gate its own UI."""
    username = username.strip()
    if not username or not password:
        raise ValueError("请输入用户名和密码 / Username and password are required.")

    user = db.get_user_by_username(username)
    if user is None:
        if username == ADMIN_USERNAME:
            salt = secrets.token_hex(16)
            pw_hash = _hash_password(password, salt)
            user = db.create_user(username, salt, pw_hash, is_admin=True, ai_allowed=True)
        else:
            raise PermissionError(
                f"账号不存在。账号需由管理员 {ADMIN_USERNAME} 创建，请联系管理员开通。"
                f" / No account with this username — accounts must be created by the admin"
                f" ({ADMIN_USERNAME}); please ask them to set one up for you."
            )
    else:
        salt = user["password_salt"] or secrets.token_hex(16)
        pw_hash = _hash_password(password, salt)
        if pw_hash != user["password_hash"]:
            raise PermissionError("密码错误 / Wrong password for this username.")
        if username == ADMIN_USERNAME and not (user["is_admin"] and user["ai_allowed"]):
            db.set_admin(username, True)
            db.set_ai_allowed(username, True)

    is_admin = bool(user["is_admin"]) or username == ADMIN_USERNAME
    ai_allowed = bool(user["ai_allowed"]) or is_admin
    token = secrets.token_hex(24)
    db.create_session(user["id"], token)
    return {"token": token, "username": user["username"], "is_admin": is_admin, "ai_allowed": ai_allowed}


def admin_create_user(new_username: str, new_password: str) -> dict:
    """Create a new (non-admin, AI-access-off-by-default) account. Caller
    (the API layer) is responsible for checking the requester is an admin
    before calling this — this function itself doesn't re-check."""
    new_username = new_username.strip()
    if not new_username or not new_password:
        raise ValueError("请输入新账号的用户名和密码 / Username and password are required.")
    if db.get_user_by_username(new_username) is not None:
        raise ValueError(f"账号 '{new_username}' 已存在 / Account '{new_username}' already exists.")
    salt = secrets.token_hex(16)
    pw_hash = _hash_password(new_password, salt)
    user = db.create_user(new_username, salt, pw_hash, is_admin=False, ai_allowed=False)
    return {"username": user["username"], "is_admin": False, "ai_allowed": False}


def user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    return db.get_user_by_token(token)


def is_admin(user: dict) -> bool:
    return bool(user.get("is_admin")) or user.get("username") == ADMIN_USERNAME


def ai_allowed(user: dict) -> bool:
    return is_admin(user) or bool(user.get("ai_allowed"))
