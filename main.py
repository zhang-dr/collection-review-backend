import json
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
    if not auth.is_admin(user):
        raise HTTPException(status_code=403, detail=f"仅管理员 {auth.ADMIN_USERNAME} 可操作 / Admin ({auth.ADMIN_USERNAME}) only")
    return user


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Auth — lightweight username(+optional password) login. First login for a
# username creates the account; later logins with that username must match
# the same password.
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
def api_login(username: str = Form(...), password: str = Form("")):
    try:
        result = auth.login_or_register(username, password)
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
    return {"username": user["username"], "is_admin": auth.is_admin(user)}


# ---------------------------------------------------------------------------
# Admin — account creation is no longer self-service (see auth.py). Only the
# hardcoded admin username can create accounts.
# ---------------------------------------------------------------------------

@app.get("/api/admin/users")
def api_admin_list_users(admin: dict = Depends(require_admin)):
    return db.list_users()


@app.post("/api/admin/users")
def api_admin_create_user(username: str = Form(...), password: str = Form(""), admin: dict = Depends(require_admin)):
    try:
        return auth.admin_create_user(username, password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
    r = db.get_report(report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if not auth.is_admin(user) and r.get("author") != user["username"]:
        raise HTTPException(status_code=403, detail="只能删除自己创建的报告 / You can only delete reports you created")
    ok = db.delete_report(report_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Export for AI analysis — this app never calls a third-party AI service
# itself. Instead it builds a paste-ready text block (house methodology +
# distilled report data) for the user to copy into their own AI chat
# (claude.ai, ChatGPT, etc.), using their own subscription. No API key, no
# per-provider cost, no server-side timeout to work around.
# ---------------------------------------------------------------------------

@app.get("/api/reports/{report_id}/insights/export")
def api_export_insights(report_id: int, user: dict = Depends(require_user)):
    r = db.get_report(report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Report not found")
    text = insights.build_export_text(r["data"])
    return {"text": text}


# ---- static frontend (mounted last so /api routes take priority) ----
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
