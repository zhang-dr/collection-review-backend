"""
Collection network diagnostic — core data pipeline.

Turns raw exports (per-depot route-info CSVs + a network-wide billing CSV,
for two comparison dates) plus manually-entered OPC totals and AB-scan
overrides into the same JSON shape the report frontend renders.

Design notes:
- Route-info files are per depot per date (the file itself carries no
  depot column), so the caller must tell us which depot each upload is for.
- The billing file is network-wide per date (it already has its own
  'depot' column, spelled like "Manchester Depot JT").
- Column names in real exports are messy (UTF-8 BOM, stray leading spaces,
  e.g. " Actual Total Pickup"), so every read goes through normalize_columns().
- "Actual pickup" has two meanings used side by side, matching the
  methodology already validated in the manual weekly reports:
    * Depot/network headline actual = the user-supplied OPC number.
    * Route-level actual (used for £/parcel, efficiency, priority-route
      flags) = each route's own Actual Total Pickup field, with any
      AB-scan override applied. This is real but not OPC-adjusted, so
      route-level sums land close to — but not exactly on — OPC totals.
"""
from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

DEPOTS = ["Manchester", "Birmingham", "London"]

# ---------------------------------------------------------------------------
# Column normalization / alias matching
# ---------------------------------------------------------------------------

def _clean_colname(c: str) -> str:
    c = str(c)
    c = c.replace("﻿", "")  # BOM
    c = unicodedata.normalize("NFKC", c)
    c = c.strip()
    c = re.sub(r"\s+", " ", c)
    return c


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [_clean_colname(c) for c in df.columns]
    return df


ROUTE_INFO_ALIASES = {
    "route_id": ["Route ID", "RouteID", "route id"],
    "driver": ["Driver Name", "Driver"],
    "vehicle": ["Vehicle Type", "Vehicle"],
    "est_dur": ["Estimated Total Duration (minute)", "Estimated Total Duration"],
    "est_dist": ["Estimated Total Distance (miles)", "Estimated Total Distance"],
    "est_pickup": ["Estimated Total Pickup"],
    "act_dur": ["Actual Total Duration (minute)", "Actual Total Duration"],
    "act_dist": ["Actual Total Distance (miles)", "Actual Total Distance"],
    "act_pickup": ["Actual Total Pickup"],
    "job_id": ["Job ID"],
    "job_type": ["Job Type"],
    "job_status": ["Job Status"],
    "seller": ["Seller Name"],
    "fail_reason": ["Failed to pick up reason"],
    "job_pickup_est": ["Job Pickup Estimate"],
}

BILLING_ALIASES = {
    "route_id": ["route_id", "Route ID"],
    "cost": ["cost_in_pounds", "Cost (£)", "cost"],
    "depot": ["depot", "Depot"],
    "vehicle": ["vehicle_type_name", "Vehicle Type"],
}


def _find_col(df: pd.DataFrame, aliases: list[str]) -> Optional[str]:
    lower_map = {c.lower(): c for c in df.columns}
    for a in aliases:
        if a in df.columns:
            return a
        if a.lower() in lower_map:
            return lower_map[a.lower()]
    return None


def _rename_via_aliases(df: pd.DataFrame, alias_map: dict) -> pd.DataFrame:
    df = normalize_columns(df)
    rename = {}
    missing = []
    for canon, aliases in alias_map.items():
        col = _find_col(df, aliases)
        if col is None:
            missing.append(canon)
        else:
            rename[col] = canon
    df = df.rename(columns=rename)
    return df, missing


def read_csv_robust(file_bytes: bytes) -> pd.DataFrame:
    """Read a CSV that may be UTF-8-BOM, plain UTF-8, or latin-1."""
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(file_bytes), encoding=enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    # last resort, replace bad bytes
    return pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8", encoding_errors="replace")


# ---------------------------------------------------------------------------
# Route-info parsing
# ---------------------------------------------------------------------------

REQUIRED_ROUTE_FIELDS = [
    "route_id", "driver", "vehicle", "est_dur", "est_dist", "est_pickup",
    "act_dur", "act_dist", "act_pickup",
]


@dataclass
class ParseWarning:
    file_label: str
    message: str


def parse_route_info(file_bytes: bytes, depot: str, file_label: str,
                      warnings: list[ParseWarning]) -> pd.DataFrame:
    raw = read_csv_robust(file_bytes)
    df, missing = _rename_via_aliases(raw, ROUTE_INFO_ALIASES)
    required_missing = [m for m in missing if m in REQUIRED_ROUTE_FIELDS]
    if required_missing:
        raise ValueError(
            f"{file_label}: missing required column(s) {required_missing}. "
            f"Found columns: {list(raw.columns)[:20]}"
        )
    df["route_id"] = df["route_id"].astype(str).str.strip()

    route_cols = ["route_id", "driver", "vehicle", "est_dur", "est_dist",
                  "est_pickup", "act_dur", "act_dist", "act_pickup"]
    route_level = df.groupby("route_id", as_index=False).first()[route_cols]
    route_level["driver"] = route_level["driver"].astype(str).str.strip().str.replace(r"\s+", " ", regex=True)
    route_level["vehicle"] = route_level["vehicle"].astype(str).str.strip()

    if "job_id" in df.columns and "job_type" in df.columns and "job_status" in df.columns:
        jobs = df[df["job_id"].notna() & (df["job_type"].astype(str).str.lower() == "forward")]
        completed = jobs[jobs["job_status"].astype(str).str.lower() == "completed"].groupby("route_id").size()
        cancelled = jobs[jobs["job_status"].astype(str).str.lower() == "cancelled"].groupby("route_id").size()
        counts = pd.concat([completed.rename("completed"), cancelled.rename("cancelled")], axis=1).fillna(0).astype(int)
        route_level = route_level.merge(counts, left_on="route_id", right_index=True, how="left")
        route_level[["completed", "cancelled"]] = route_level[["completed", "cancelled"]].fillna(0).astype(int)
    else:
        warnings.append(ParseWarning(file_label, "No Job ID/Type/Status columns found — completed/cancelled counts set to 0."))
        route_level["completed"] = 0
        route_level["cancelled"] = 0

    route_level["depot"] = depot
    for c in ["est_dur", "est_dist", "est_pickup", "act_dur", "act_dist", "act_pickup"]:
        route_level[c] = pd.to_numeric(route_level[c], errors="coerce")
    return route_level


def parse_cancellations(file_bytes: bytes, depot: str) -> pd.DataFrame:
    raw = read_csv_robust(file_bytes)
    df, missing = _rename_via_aliases(raw, ROUTE_INFO_ALIASES)
    need = {"job_type", "job_status", "seller", "fail_reason", "job_pickup_est", "route_id"}
    if need - set(df.columns):
        return pd.DataFrame(columns=["route_id", "depot", "seller", "fail_reason", "job_pickup_est"])
    j = df[(df["job_type"].astype(str).str.lower() == "forward") &
           (df["job_status"].astype(str).str.lower() == "cancelled")].copy()
    j["depot"] = depot
    j["seller"] = j["seller"].astype(str).str.strip().str.replace(r"\s+", " ", regex=True)
    j["job_pickup_est"] = pd.to_numeric(j["job_pickup_est"], errors="coerce").fillna(0)
    return j[["route_id", "depot", "seller", "fail_reason", "job_pickup_est"]]


def merchant_counts(file_bytes: bytes) -> tuple[int, int]:
    """(planned distinct sellers, actual/completed distinct sellers) for one depot-date."""
    raw = read_csv_robust(file_bytes)
    df, missing = _rename_via_aliases(raw, ROUTE_INFO_ALIASES)
    if {"job_type", "job_id", "seller", "job_status"} - set(df.columns):
        return (0, 0)
    j = df[(df["job_type"].astype(str).str.lower() == "forward") & df["job_id"].notna()]
    planned = j["seller"].nunique()
    actual = j[j["job_status"].astype(str).str.lower() == "completed"]["seller"].nunique()
    return int(planned), int(actual)


# ---------------------------------------------------------------------------
# Billing parsing
# ---------------------------------------------------------------------------

DEPOT_NAME_MAP = {
    "manchester": "Manchester", "mcr": "Manchester", "man": "Manchester",
    "birmingham": "Birmingham", "bham": "Birmingham", "bhx": "Birmingham",
    "london": "London", "west london": "London", "wl": "London", "ldn": "London",
}


def canon_depot(raw_name: str) -> Optional[str]:
    s = str(raw_name).lower()
    for key, canon in DEPOT_NAME_MAP.items():
        if key in s:
            return canon
    return None


def parse_billing(file_bytes: bytes, file_label: str, warnings: list[ParseWarning]) -> pd.DataFrame:
    raw = read_csv_robust(file_bytes)
    df, missing = _rename_via_aliases(raw, BILLING_ALIASES)
    if "route_id" not in df.columns or "cost" not in df.columns:
        raise ValueError(f"{file_label}: billing file must have a route id and a cost column.")
    df["route_id"] = df["route_id"].astype(str).str.strip()
    df["cost"] = pd.to_numeric(df["cost"], errors="coerce")
    if "depot" in df.columns:
        df["depot_canon"] = df["depot"].apply(canon_depot)
    else:
        df["depot_canon"] = None
        warnings.append(ParseWarning(file_label, "Billing file has no depot column — cost will be matched by route_id only."))
    return df[["route_id", "cost", "depot_canon"]]


# ---------------------------------------------------------------------------
# AB-scan overrides
# ---------------------------------------------------------------------------

@dataclass
class AbScanOverride:
    route_id: str
    date_key: str  # "a" or "b"
    override_value: float
    reason: str = ""


def apply_overrides(route_df: pd.DataFrame, overrides: list[AbScanOverride], date_key: str) -> tuple[pd.DataFrame, list[dict]]:
    route_df = route_df.copy()
    applied = []
    for ov in overrides:
        if ov.date_key != date_key:
            continue
        mask = route_df["route_id"] == str(ov.route_id).strip()
        if mask.any():
            before = route_df.loc[mask, "act_pickup"].iloc[0]
            route_df.loc[mask, "act_pickup"] = ov.override_value
            applied.append({"route_id": ov.route_id, "before": float(before) if pd.notna(before) else None,
                             "after": ov.override_value, "reason": ov.reason})
    return route_df, applied


# ---------------------------------------------------------------------------
# Shift-length parsing
# ---------------------------------------------------------------------------

def shift_bucket(vehicle: str) -> str:
    v = str(vehicle)
    if re.search(r"\b\d{1,2}T\b", v):  # 18T, 44T etc — large-format/bulk vehicles
        return v.split()[0]
    m = re.search(r"(\d+)h", v)
    if not m:
        return "other"
    h = int(m.group(1))
    return "4h" if h <= 4 else ("6h" if h <= 6 else "8h+")


# ---------------------------------------------------------------------------
# Master compute
# ---------------------------------------------------------------------------

@dataclass
class DepotDateInput:
    depot: str
    date_key: str  # "a" (earlier) or "b" (later)
    route_bytes: bytes
    file_label: str


@dataclass
class ComputeInputs:
    date_a_label: str
    date_b_label: str
    depot_files: list[DepotDateInput]
    billing_a_bytes: bytes
    billing_b_bytes: bytes
    opc: dict  # {"Manchester": {"a": 16114, "b": 14075}, ...}
    ab_overrides: list[AbScanOverride] = field(default_factory=list)


def compute_report(inp: ComputeInputs) -> dict:
    warnings: list[ParseWarning] = []
    route_by_depot_date: dict[tuple[str, str], pd.DataFrame] = {}
    cancel_by_depot_date: dict[tuple[str, str], pd.DataFrame] = {}
    merch_by_depot_date: dict[tuple[str, str], tuple[int, int]] = {}

    for f in inp.depot_files:
        rl = parse_route_info(f.route_bytes, f.depot, f.file_label, warnings)
        route_by_depot_date[(f.depot, f.date_key)] = rl
        cancel_by_depot_date[(f.depot, f.date_key)] = parse_cancellations(f.route_bytes, f.depot)
        merch_by_depot_date[(f.depot, f.date_key)] = merchant_counts(f.route_bytes)

    for depot in DEPOTS:
        for dk in ("a", "b"):
            if (depot, dk) not in route_by_depot_date:
                raise ValueError(f"Missing route-info upload for {depot} / date {dk}.")

    billing_a = parse_billing(inp.billing_a_bytes, "billing (date a)", warnings)
    billing_b = parse_billing(inp.billing_b_bytes, "billing (date b)", warnings)

    def merge_cost(route_df: pd.DataFrame, billing_df: pd.DataFrame, depot: str) -> pd.DataFrame:
        b = billing_df.copy()
        if b["depot_canon"].notna().any():
            b = b[b["depot_canon"] == depot]
        b = b[["route_id", "cost"]].drop_duplicates("route_id")
        return route_df.merge(b, on="route_id", how="left")

    full = {}
    for depot in DEPOTS:
        for dk, billing in (("a", billing_a), ("b", billing_b)):
            rdf = route_by_depot_date[(depot, dk)]
            rdf, applied = apply_overrides(rdf, inp.ab_overrides, dk)
            rdf = merge_cost(rdf, billing, depot)
            rdf["scan_eff"] = rdf["act_pickup"] / (rdf["act_dur"] / 60)
            rdf["drive_eff"] = rdf["act_dist"] / (rdf["act_dur"] / 60)
            denom = (rdf["completed"] + rdf["cancelled"]).replace(0, np.nan)
            rdf["mi_per_stop"] = rdf["act_dist"] / denom
            rdf["pp"] = rdf["cost"] / rdf["act_pickup"]
            rdf["shift"] = rdf["vehicle"].apply(shift_bucket)
            full[(depot, dk)] = rdf

    ab_applied_all = []
    for dk in ("a", "b"):
        for depot in DEPOTS:
            rdf = route_by_depot_date[(depot, dk)]
            _, applied = apply_overrides(rdf, inp.ab_overrides, dk)
            ab_applied_all.extend(applied)

    # ---- per-depot / network summary ----
    summary = {}
    for depot in DEPOTS:
        a, b = full[(depot, "a")], full[(depot, "b")]
        cost_a, cost_b = a["cost"].sum(skipna=True), b["cost"].sum(skipna=True)
        opc_a = inp.opc[depot]["a"]
        opc_b = inp.opc[depot]["b"]
        f_a, f_b = a["est_pickup"].sum(), b["est_pickup"].sum()
        cancel_a = len(cancel_by_depot_date[(depot, "a")])
        cancel_b = len(cancel_by_depot_date[(depot, "b")])
        completed_a = int(a["completed"].sum())
        completed_b = int(b["completed"].sum())
        mf_b, ma_b = merch_by_depot_date[(depot, "b")]
        summary[depot] = {
            "routes14": int(a["cost"].notna().sum()), "routes21": int(b["cost"].notna().sum()),
            "cost14": round(float(cost_a), 2), "cost21": round(float(cost_b), 2),
            "act14": int(opc_a), "act21": int(opc_b),
            "cpp14": round(float(cost_a) / opc_a, 4) if opc_a else None,
            "cpp21": round(float(cost_b) / opc_b, 4) if opc_b else None,
            "f14": int(f_a), "f21": int(f_b),
            "c14": completed_a, "x14": int(cancel_a),
            "c21": completed_b, "x21": int(cancel_b),
            "merch_f21": int(mf_b), "merch_a21": int(ma_b),
        }

    net = {
        "cost14": round(sum(summary[d]["cost14"] for d in DEPOTS), 2),
        "cost21": round(sum(summary[d]["cost21"] for d in DEPOTS), 2),
        "act14": sum(summary[d]["act14"] for d in DEPOTS),
        "act21": sum(summary[d]["act21"] for d in DEPOTS),
        "routes14": sum(summary[d]["routes14"] for d in DEPOTS),
        "routes21": sum(summary[d]["routes21"] for d in DEPOTS),
        "f14": sum(summary[d]["f14"] for d in DEPOTS),
        "f21": sum(summary[d]["f21"] for d in DEPOTS),
    }
    net["cpp14"] = round(net["cost14"] / net["act14"], 4) if net["act14"] else None
    net["cpp21"] = round(net["cost21"] / net["act21"], 4) if net["act21"] else None
    net["ppr14"] = round(net["act14"] / net["routes14"], 2) if net["routes14"] else None
    net["ppr21"] = round(net["act21"] / net["routes21"], 2) if net["routes21"] else None

    forecast = {depot: {"f14": summary[depot]["f14"], "a14": summary[depot]["act14"],
                         "f21": summary[depot]["f21"], "a21": summary[depot]["act21"]} for depot in DEPOTS}

    # ---- cancellations ----
    def reason_counts(dk):
        parts = [cancel_by_depot_date[(depot, dk)] for depot in DEPOTS]
        allc = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["fail_reason"])
        if allc.empty or "fail_reason" not in allc.columns:
            return {}
        return allc["fail_reason"].fillna("Unknown").value_counts().to_dict()

    reasons_a = reason_counts("a")
    reasons_b = reason_counts("b")
    cancel_site_a = {depot: len(cancel_by_depot_date[(depot, "a")]) for depot in DEPOTS}
    cancel_site_b = {depot: len(cancel_by_depot_date[(depot, "b")]) for depot in DEPOTS}

    merchants = []
    for dk, label in (("a", inp.date_a_label), ("b", inp.date_b_label)):
        parts = [cancel_by_depot_date[(depot, dk)] for depot in DEPOTS]
        allc = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
        if allc.empty or "seller" not in allc.columns:
            continue
        g = allc.groupby(["seller", "depot"]).agg(n=("route_id", "size"), pkgs=("job_pickup_est", "sum")).reset_index()
        g = g[g["n"] >= 2].sort_values("n", ascending=False)
        for _, r in g.iterrows():
            merchants.append({"day": label, "seller": r["seller"], "depot": r["depot"],
                               "n": int(r["n"]), "pkgs": int(r["pkgs"])})

    # ---- price per parcel + priority routes (LATER date = "b") ----
    pool_b = pd.concat([full[(depot, "b")] for depot in DEPOTS], ignore_index=True)
    pool_b_valid = pool_b[pool_b["cost"].notna() & pool_b["act_pickup"].notna() & (pool_b["act_pickup"] > 0)].copy()

    pp_latest = []
    for _, r in pool_b_valid.sort_values("pp").iterrows():
        pp_latest.append({"route_id": r["route_id"], "depot": r["depot"], "driver": r["driver"],
                           "act": int(r["act_pickup"]), "cost": round(float(r["cost"]), 2), "pp": round(float(r["pp"]), 4)})

    scan_thr = float(np.nanpercentile(pool_b_valid["scan_eff"].dropna(), 20)) if len(pool_b_valid) else None
    drive_thr = float(np.nanpercentile(pool_b_valid["drive_eff"].dropna(), 20)) if len(pool_b_valid) else None
    mi_thr = float(np.nanpercentile(pool_b_valid["mi_per_stop"].dropna(), 80)) if len(pool_b_valid) else None

    pool_b_valid["fs"] = pool_b_valid["scan_eff"] <= scan_thr if scan_thr is not None else False
    pool_b_valid["fd"] = pool_b_valid["drive_eff"] <= drive_thr if drive_thr is not None else False
    pool_b_valid["fm"] = pool_b_valid["mi_per_stop"] >= mi_thr if mi_thr is not None else False
    pool_b_valid["any_flag"] = pool_b_valid[["fs", "fd", "fm"]].any(axis=1)
    flagged_b = pool_b_valid[pool_b_valid["any_flag"]].copy()

    flagged_latest = []
    for _, r in flagged_b.iterrows():
        flagged_latest.append({
            "route_id": r["route_id"], "depot": r["depot"], "driver": r["driver"], "vehicle": r["vehicle"],
            "est": int(r["est_pickup"]) if pd.notna(r["est_pickup"]) else None,
            "act": int(r["act_pickup"]), "completed": int(r["completed"]), "cancelled": int(r["cancelled"]),
            "pp": round(float(r["pp"]), 4) if pd.notna(r["pp"]) else None,
            "fs": bool(r["fs"]), "fd": bool(r["fd"]), "fm": bool(r["fm"]),
        })

    # repeat-driver check against date "a"
    pool_a = pd.concat([full[(depot, "a")] for depot in DEPOTS], ignore_index=True)
    pool_a_valid = pool_a[pool_a["scan_eff"].notna() & pool_a["drive_eff"].notna() & pool_a["mi_per_stop"].notna()].copy()
    repeats = {}
    if len(pool_a_valid) >= 5:
        scan_thr_a = float(np.nanpercentile(pool_a_valid["scan_eff"].dropna(), 20))
        drive_thr_a = float(np.nanpercentile(pool_a_valid["drive_eff"].dropna(), 20))
        mi_thr_a = float(np.nanpercentile(pool_a_valid["mi_per_stop"].dropna(), 80))
        pool_a_valid["fs"] = pool_a_valid["scan_eff"] <= scan_thr_a
        pool_a_valid["fd"] = pool_a_valid["drive_eff"] <= drive_thr_a
        pool_a_valid["fm"] = pool_a_valid["mi_per_stop"] >= mi_thr_a

        def dims(row):
            s = []
            if row["fs"]:
                s.append("S")
            if row["fd"]:
                s.append("D")
            if row["fm"]:
                s.append("M")
            return "+".join(s)

        flagged_a = pool_a_valid[pool_a_valid[["fs", "fd", "fm"]].any(axis=1)].copy()
        flagged_a["driver_c"] = flagged_a["driver"].astype(str).str.strip()
        flagged_b["driver_c"] = flagged_b["driver"].astype(str).str.strip()
        common = set(flagged_a["driver_c"]) & set(flagged_b["driver_c"])
        for d in sorted(common):
            ra = flagged_a[flagged_a["driver_c"] == d].iloc[0]
            rb = flagged_b[flagged_b["driver_c"] == d].iloc[0]
            repeats[d] = f"{dims(ra)}→{dims(rb)}" + (" (same)" if dims(ra) == dims(rb) else "")

    anomaly_depot = {}
    for depot in DEPOTS:
        sub = pool_b_valid[pool_b_valid["depot"] == depot]
        anomaly_depot[depot] = {"total": int(len(sub)), "fs": int(sub["fs"].sum()), "fd": int(sub["fd"].sum()),
                                 "fm": int(sub["fm"].sum()), "any": int(sub["any_flag"].sum())}

    return {
        "date_a_label": inp.date_a_label, "date_b_label": inp.date_b_label,
        "depots": DEPOTS,
        "summary": summary, "net": net, "forecast": forecast,
        "reasons_a": reasons_a, "reasons_b": reasons_b,
        "cancel_site_a": cancel_site_a, "cancel_site_b": cancel_site_b,
        "merchants": merchants,
        "pp_latest": pp_latest,
        "flagged_latest": flagged_latest,
        "repeats": repeats,
        "thresholds": {"scan": scan_thr, "drive": drive_thr, "mi": mi_thr},
        "anomaly_depot": anomaly_depot,
        "ab_scan_applied": ab_applied_all,
        "warnings": [f"{w.file_label}: {w.message}" for w in warnings],
    }
