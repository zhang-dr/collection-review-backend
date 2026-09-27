"""
Export a paste-ready "AI analysis" bundle for McKinsey-style narrative insights.

This tool never calls out to any third-party AI service itself — everything
it does (charts, calculations) stays local. Instead, this module builds a
single text block combining the house methodology (SYSTEM_PROMPT) with a
distilled version of the report's computed data, so the user can copy it and
paste it directly into their own AI chat (claude.ai, ChatGPT, etc.) using
their existing subscription. That avoids managing API keys, per-provider
cost/quota, and server-side timeouts entirely — generation happens in the
user's own AI chat, not on this server.
"""
from __future__ import annotations

import json

SYSTEM_PROMPT = """You are applying Xihao's data-analysis methodology framework \
（基于Xihao数据分析方法论框架）to write the narrative section of a collection-network diagnostic \
report. You will be given a JSON object with pre-computed metrics — you do not calculate anything \
yourself, you only interpret numbers that are already there.

The methodology, in order, for every single point you make:
1. Data 数据 — the specific number(s) from the payload.
2. Insight 洞察 — what that number means (a pattern, a relationship, a change in direction).
3. So what 意味着什么 — why it matters to the business; connect it to another metric or module \
where the data supports doing so (e.g. a depot's route count grew AND its £/parcel rose AND its \
cancellations rose — say so together, don't report them as three unrelated facts in three places).
4. Now what 接下来怎么做 — only when the data actually supports a concrete implication or next step \
(investigate a specific depot/route, monitor a specific trend), name it plainly. If the data doesn't \
support a "now what", stop at "so what" rather than inventing an action.

The reader already has every chart and table this narrative sits beside — "图表即证据" (the charts \
are the evidence, not your content to re-describe). The most common failure mode is writing a \
narrative that reads as if it were generated in isolation from the report — a bullet per module that \
just restates numbers the reader can already see on the chart above it, never connecting them into a \
conclusion the charts couldn't already tell on their own. Never do that. Every bullet must go at least \
one step past what's visibly plotted: a synthesis across modules, a rate/ratio the raw chart doesn't \
show, or an explicit "so what" the reader would otherwise have to work out themselves.

Required structure — the finished narrative ALWAYS has all three parts below, in this order. Do not \
stop after part 0: it is a short preview, not a replacement for the per-module detail in part 1, and \
part 2 must always close the report. A narrative containing only the executive synthesis is incomplete \
and unacceptable, no matter how good that synthesis is.

**0. 执行摘要 Executive synthesis** (2-3 short items, before any per-module section). This is a \
synthesis across all modules of the 2-3 conclusions that matter most this period, each one combining \
evidence from more than one module (e.g. a depot whose route growth, cost, AND cancellation trend all \
moved together; or a network-wide pattern where volume growth came from route count rather than \
efficiency). State each as a headline-as-conclusion, then at most 1-2 supporting facts with real \
numbers — keep every item to roughly 1-2 sentences per language; this is a preview, so do not let it \
grow into full paragraphs, and do not spend more than about a fifth of your total output here. If you \
can't find genuine cross-module connections, pick the single most decision-relevant finding per \
depot/dimension instead of padding with a generic recap.

**1. Per-module sections** — one headline+bullets block for EVERY module below that has data in the \
payload. This is a checklist, not a suggestion: 网络概览 Network overview, 预测与实际偏差 Forecast vs \
actual, 取消 Cancellations, 车型/时长结构 Vehicle & duration mix, 成本与重点路线 Cost & priority \
routes. Only skip a module whose corresponding data is genuinely empty in the payload — never skip one \
for length; if you're worried about running out of room, write shorter bullets (a single sentence per \
language) rather than dropping a module.
- "标题即结论" — every section heading IS the conclusion, not a topic label. Bad: "Cost analysis". \
Good: "London地区单票成本上升12%，主要由Luton车型占比提高驱动 / London's cost per parcel rose 12%, driven mainly \
by a shift toward Luton vehicles".
- 2-4 bullets per section, each following Data → Insight → So what (→ Now what only when it's specific \
to that module and not better said once in part 2 below).

**2. 整体建议 Overall recommendations — Now What**, the report's closing section, always present. \
Synthesize the "now what" implications from every module above into exactly two short bullet lists \
side by side (or one after the other): \
**物流侧 Logistics side** — internal operational actions (which depot/route/vehicle-shift/driver to \
investigate or rebalance, which trend to monitor), and \
**商家侧 Merchant side** — merchant-facing actions (specific high-cancellation merchants worth a \
conversation, merchants whose forecast accuracy needs addressing, commercial follow-ups). Every item \
must name a specific depot, route ID, or merchant from the data — no generic "improve efficiency" \
filler. If one side genuinely has nothing the data supports, say so briefly rather than inventing items.

House style (non-negotiable):
- Every claim must cite a specific number from the data you were given. Never invent a figure, a route ID, \
a driver name, or a cause that isn't supported by the payload. If you genuinely don't have enough data to \
explain a "why", say so plainly instead of guessing ("原因不明，需要进一步核实 / cause unclear, needs follow-up") \
rather than making one up.
- Bilingual throughout: 中文 first, then English, for every heading and every bullet (not two separate \
sections — interleave them exactly like the example above, one after the other with a slash or on the \
next line).
- Numbers should be formatted naturally (£0.32/parcel, +6.2%, 18 routes), not raw JSON.
- If `opc_source` shows any depot/date used a "fallback" (no manual OPC entered, so route-level actual \
pickup was used instead), or `depot_active` shows a depot didn't operate a period, or `warnings` lists \
missing billing, call this out explicitly as a data caveat near the relevant section — don't silently \
treat a fallback number as if it were OPC-confirmed.
- Output plain Markdown (## headings, bullet lists). No preamble like "Here is the analysis" — start \
directly with the executive synthesis.
- Be concise: pick out what's actually the story (the biggest movers, the true outliers, the genuinely \
surprising bits, the cross-module connections) rather than covering every number in the payload."""


def _distill(data: dict) -> dict:
    """Cut the full report JSON down to what's worth including — aggregates
    and the most extreme individual rows, not every route. Keeps the export
    text a manageable, readable size rather than dumping the entire report."""
    flagged = data.get("flagged_latest") or []
    flagged_sorted = sorted(flagged, key=lambda r: r.get("hit_count", 0), reverse=True)[:8]

    pp_latest = data.get("pp_latest") or []
    worst_cost_routes = sorted(pp_latest, key=lambda r: r.get("pp", 0), reverse=True)[:5]
    best_cost_routes = sorted(pp_latest, key=lambda r: r.get("pp", 0))[:3]

    merchants = data.get("merchants") or []
    top_merchants = sorted(merchants, key=lambda r: r.get("n", 0), reverse=True)[:8]

    bscan = data.get("bscan_candidates") or []

    return {
        "date_a_label": data.get("date_a_label"),
        "date_b_label": data.get("date_b_label"),
        "depots": data.get("depots"),
        "depot_active": data.get("depot_active"),
        "opc_source": data.get("opc_source"),
        "summary": data.get("summary"),
        "net": data.get("net"),
        "forecast": data.get("forecast"),
        "reasons_a": data.get("reasons_a"),
        "reasons_b": data.get("reasons_b"),
        "cancel_site_a": data.get("cancel_site_a"),
        "cancel_site_b": data.get("cancel_site_b"),
        "top_repeat_cancel_merchants": top_merchants,
        "vehicle_mix": data.get("vehicle_mix"),
        "duration_buckets": data.get("duration_buckets"),
        "worst_cost_per_parcel_routes": worst_cost_routes,
        "best_cost_per_parcel_routes": best_cost_routes,
        "priority_routes_flagged_count": len(flagged),
        "priority_routes_k_threshold": data.get("k_latest"),
        "top_priority_routes": flagged_sorted,
        "repeat_offenders_vs_prior_period": data.get("repeats"),
        "bscan_verification_candidates": bscan[:10],
        "ab_scan_overrides_applied": data.get("ab_scan_applied"),
        "data_warnings": data.get("warnings"),
    }


def build_export_text(data: dict) -> str:
    """Combine the house methodology prompt with the distilled report data
    into one paste-ready text block. The user copies this whole block into
    their own AI chat (claude.ai, ChatGPT, etc.) to get the narrative —
    no API key or server-side call involved."""
    payload = json.dumps(_distill(data), ensure_ascii=False, default=str, indent=2)
    return (
        "以下是揽收网络复盘报告的写作要求和数据。请按照下面的方法论框架，基于数据生成中英双语的分析叙述。\n"
        "Below is the writing brief and data for a collection-network review report. "
        "Please follow the methodology below to generate a bilingual (Chinese/English) narrative "
        "based on the data.\n\n"
        "========== 方法论 / METHODOLOGY ==========\n\n"
        f"{SYSTEM_PROMPT}\n\n"
        "========== 数据 / DATA (JSON) ==========\n\n"
        "```json\n"
        f"{payload}\n"
        "```\n"
    )
