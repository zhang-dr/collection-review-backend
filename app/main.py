import json
import os
import secrets
from base64 import b64decode
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .pipeline import AbScanOverride, ComputeInputs, DepotDateInput, compute_report

app = FastAPI(title="Collection Network Review")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if request.url.path == "/api/health":
        return await call_next(request)

    expected_user = os.getenv("AUTH_USERNAME")
    expected_password = os.getenv("AUTH_PASSWORD")
    if expected_user and expected_password:
        try:
            scheme, encoded = request.headers.get("Authorization", "").split(" ", 1)
            username, password = b64decode(encoded).decode("utf-8").split(":", 1)
            valid = (
                scheme.lower() == "basic"
                and secrets.compare_digest(username, expected_user)
                and secrets.compare_digest(password, expected_password)
            )
        except (ValueError, UnicodeDecodeError):
            valid = False

        if not valid:
            return JSONResponse(
                {"detail": "Authentication required"},
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="CBT Analysis"'},
            )

    return await call_next(request)

db.init_db()

STATIC_DIR = Path(__file__).resolve().parent / "static"


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/upload")
async def upload(
    name: str = Form(...),
    date_a_label: str = Form(...),
    date_b_label: str = Form(...),
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

    report_id = db.save_report(name, date_a_label, date_b_label, result)
    return {"id": report_id, "data": result}


@app.get("/api/reports")
def api_list_reports():
    return db.list_reports()


@app.get("/api/reports/{report_id}")
def api_get_report(report_id: int):
    r = db.get_report(report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return r


@app.delete("/api/reports/{report_id}")
def api_delete_report(report_id: int):
    ok = db.delete_report(report_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"deleted": True}


# ---- static frontend (mounted last so /api routes take priority) ----
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
