import json
import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth, db, insights
from .pipeline import AbScanOverride, ComputeInputs, DepotDateInput, compute_report

app = FastAPI(title="Collection Network Review")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

db.init_db()

STATIC_DIR = Path(__file__).resolve().parent / "static"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Xihao")


def _token_from_header(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return authorization.strip()


def require_user(authorization: str | None = Header(None)) -> dict:
    user = auth.user_from_token(_token_from_header(authorization))
    if user is None:
        raise HTTPException(status_code=401, detail="Not logged in / 请先登录")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user["username"] != ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="Administrator access required / 仅管理员可操作")
    return user


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Auth — existing accounts may log in; only the administrator can create users.
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
def api_login(username: str = Form(...), password: str = Form(...)):
    try:
        result = auth.login(username, password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return result


@app.post("/api/auth/logout")
def api_logout(authorization: str | None = Header(None)):
    token = _token_from_header(authorization)
    if token:
        db.delete_session(token)
    return {"ok": True}


@app.get("/api/auth/me")
def api_me(user: dict = Depends(require_user)):
    return {"username": user["username"], "is_admin": user["username"] == ADMIN_USERNAME}


@app.post("/api/auth/users")
def api_create_user(username: str = Form(...), password: str = Form(...),
                    admin: dict = Depends(require_admin)):
    try:
        user = auth.register_user(username, password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"username": user["username"], "created": True}


@app.get("/api/admin/ai-settings")
def api_ai_settings(admin: dict = Depends(require_admin)):
    return {"default": insights.default_provider(), "providers": insights.available_providers()}


@app.post("/api/admin/ai-settings")
def api_save_ai_settings(provider: str = Form(...), api_key: str = Form(""),
                         model: str = Form(""), clear: bool = Form(False),
                         admin: dict = Depends(require_admin)):
    provider = provider.lower().strip()
    if provider not in insights.PROVIDER_CONFIG:
        raise HTTPException(status_code=400, detail="Unsupported AI provider")
    if clear:
        db.delete_setting(f"ai.{provider}.api_key")
        db.delete_setting(f"ai.{provider}.model")
    else:
        if not api_key.strip() and not insights.available_providers()[provider]["configured"]:
            raise HTTPException(status_code=400, detail="API key is required")
        if api_key.strip():
            db.set_setting(f"ai.{provider}.api_key", api_key.strip())
        if model.strip():
            db.set_setting(f"ai.{provider}.model", model.strip())
    db.set_setting("ai.default_provider", provider)
    status = insights.available_providers()[provider]
    return {"provider": provider, "configured": status["configured"], "model": status["model"]}


@app.post("/api/upload")
async def upload(
    user: dict = Depends(require_user),
    name: str = Form(...),
    date_a_label: str = Form(...),
    date_b_label: str = Form(...),
    granularity: str = Form("day"),
    opc_json: str = Form("{}"),
    ab_overrides_json: str = Form("[]"),
    # Every depot's route-info file is optional — a depot that didn't operate
    # a given period simply isn't uploaded for it, rather than blocking the
    # whole report. Billing is optional too (costs come back as N/A for a
    # period with none). compute_report() itself enforces that at least one
    # route-info file was uploaded somewhere.
    route_manchester_a: Optional[UploadFile] = File(None),
    route_manchester_b: Optional[UploadFile] = File(None),
    route_birmingham_a: Optional[UploadFile] = File(None),
    route_birmingham_b: Optional[UploadFile] = File(None),
    route_london_a: Optional[UploadFile] = File(None),
    route_london_b: Optional[UploadFile] = File(None),
    billing_a: Optional[UploadFile] = File(None),
    billing_b: Optional[UploadFile] = File(None),
):
    try:
        opc = json.loads(opc_json) if opc_json else {}
        overrides_raw = json.loads(ab_overrides_json)
        overrides = [
            AbScanOverride(
                route_id=str(o["route_id"]).strip(),
                date_key=o["date_key"],
                override_value=float(o["override_value"]),
                reason=o.get("reason", ""),
            )
            for o in overrides_raw
            if o.get("route_id") and o.get("override_value") not in (None, "")
        ]

        route_uploads = [
            ("Manchester", "a", route_manchester_a), ("Manchester", "b", route_manchester_b),
            ("Birmingham", "a", route_birmingham_a), ("Birmingham", "b", route_birmingham_b),
            ("London", "a", route_london_a), ("London", "b", route_london_b),
        ]
        depot_files = []
        for depot, dk, upload_file in route_uploads:
            if upload_file is not None and upload_file.filename:
                depot_files.append(DepotDateInput(depot, dk, await upload_file.read(), upload_file.filename))

        inp = ComputeInputs(
            date_a_label=date_a_label,
            date_b_label=date_b_label,
            depot_files=depot_files,
            billing_a_bytes=(await billing_a.read()) if (billing_a is not None and billing_a.filename) else None,
            billing_b_bytes=(await billing_b.read()) if (billing_b is not None and billing_b.filename) else None,
            opc=opc,
            ab_overrides=overrides,
        )
        result = compute_report(inp)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=400, detail=f"Missing OPC value for {e}")

    report_id = db.save_report(name, date_a_label, date_b_label, result,
                                author=user["username"], granularity=granularity)
    return {"id": report_id, "data": result, "author": user["username"],
            "name": name, "granularity": granularity}


@app.get("/api/reports")
def api_list_reports(user: dict = Depends(require_user)):
    return db.list_reports()


@app.get("/api/reports/{report_id}")
def api_get_report(report_id: int, user: dict = Depends(require_user)):
    r = db.get_report(report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return r


@app.delete("/api/reports/{report_id}")
def api_delete_report(report_id: int, user: dict = Depends(require_user)):
    ok = db.delete_report(report_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# AI-generated insights — the only part of this app that calls a third-party
# service, and only ever on explicit user request (never automatically).
# Multiple providers are supported; /api/insights/providers tells the
# frontend which ones actually have an API key configured on this server.
# ---------------------------------------------------------------------------

@app.get("/api/insights/providers")
def api_insights_providers(user: dict = Depends(require_user)):
    return {"default": insights.default_provider(), "providers": insights.available_providers()}


@app.post("/api/reports/{report_id}/insights")
def api_generate_insights(report_id: int, provider: Optional[str] = None, model: Optional[str] = None,
                           force: bool = False, user: dict = Depends(require_user)):
    r = db.get_report(report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if not force and r.get("insights") and (provider is None or provider == r.get("insights_provider")):
        return {"insights": r["insights"], "provider": r.get("insights_provider"), "cached": True}
    try:
        text = insights.generate_insights(r["data"], provider=provider, model=model)
    except insights.InsightsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    used_provider = (provider or insights.default_provider()).lower()
    db.save_insights(report_id, text, used_provider)
    return {"insights": text, "provider": used_provider, "cached": False}


# ---- static frontend (mounted last so /api routes take priority) ----
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
