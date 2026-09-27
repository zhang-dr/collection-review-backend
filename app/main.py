import json
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth, db
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
    return {"username": user["username"]}


@app.post("/api/upload")
async def upload(
    user: dict = Depends(require_user),
    name: str = Form(...),
    date_a_label: str = Form(...),
    date_b_label: str = Form(...),
    granularity: str = Form("day"),
    opc_json: str = Form(...),
    ab_overrides_json: str = Form("[]"),
    route_manchester_a: UploadFile = File(...),
    route_manchester_b: UploadFile = File(...),
    route_birmingham_a: UploadFile = File(...),
    route_birmingham_b: UploadFile = File(...),
    route_london_a: UploadFile = File(...),
    route_london_b: UploadFile = File(...),
    billing_a: UploadFile = File(...),
    billing_b: UploadFile = File(...),
):
    try:
        opc = json.loads(opc_json)
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

        depot_files = [
            DepotDateInput("Manchester", "a", await route_manchester_a.read(), route_manchester_a.filename),
            DepotDateInput("Manchester", "b", await route_manchester_b.read(), route_manchester_b.filename),
            DepotDateInput("Birmingham", "a", await route_birmingham_a.read(), route_birmingham_a.filename),
            DepotDateInput("Birmingham", "b", await route_birmingham_b.read(), route_birmingham_b.filename),
            DepotDateInput("London", "a", await route_london_a.read(), route_london_a.filename),
            DepotDateInput("London", "b", await route_london_b.read(), route_london_b.filename),
        ]

        inp = ComputeInputs(
            date_a_label=date_a_label,
            date_b_label=date_b_label,
            depot_files=depot_files,
            billing_a_bytes=await billing_a.read(),
            billing_b_bytes=await billing_b.read(),
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


# ---- static frontend (mounted last so /api routes take priority) ----
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
