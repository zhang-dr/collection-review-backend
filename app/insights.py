"""
AI-generated McKinsey-style narrative insights.

This is the only part of the tool that calls out to a third-party service —
everything else (charts, calculations) is local. It takes the JSON that
compute_report() already produced, distills it down to the numbers that
actually matter (not every individual route), and asks an AI provider to
turn it into a "headline = conclusion" narrative with fact-based supporting
bullets, in the house style this project's weekly reports have used.

Multiple providers are supported (Claude / Gemini / ChatGPT, plus the free-tier
OpenAI-API-compatible providers Groq / Mistral / Cerebras / OpenRouter) so a
deployment isn't locked into one vendor or one API key — and doesn't have to
pay for one at all, since several of these have a genuinely free, no-credit-
card tier. Each provider needs its own API key set as an environment variable;
only providers with a key configured are usable, and the caller picks which
one per request. Generation only ever happens when a user explicitly asks for
it (a button in the UI) — never automatically on every report — because it
costs real API usage (or free-tier quota) regardless of provider.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from . import db

MAX_TOKENS = 3500


class InsightsError(Exception):
    """Raised for any problem generating insights — surfaced to the user as
    a plain HTTP 400 with this message, in both languages where useful."""


# provider key -> config. "kind" selects which _call_* function handles it:
#   "anthropic"        -> _call_claude          (Anthropic Messages API shape)
#   "gemini"            -> _call_gemini          (Google generateContent shape)
#   "openai_compatible" -> _call_openai_compatible (OpenAI Chat Completions shape,
#                          parameterized by "base_url" — this covers OpenAI itself
#                          plus every free-tier provider that mirrors its API)
PROVIDER_CONFIG = {
    "claude": {
        "label": "Claude (Anthropic)",
        "key_env": "ANTHROPIC_API_KEY",
        "model_env": "ANTHROPIC_MODEL",
        "default_model": "claude-sonnet-4-5",
        "kind": "anthropic",
    },
    "gemini": {
        "label": "Gemini (Google) — 免费额度 free tier, no credit card",
        "key_env": "GEMINI_API_KEY",
        "model_env": "GEMINI_MODEL",
        # gemini-2.5-flash was retired for new users in 2026 (the API now
        # returns 404 "no longer available to new users, use
        # models/gemini-3.8-flash"). Anyone with GEMINI_MODEL already set to
        # an old id can override via that env var without a code change.
        "default_model": "gemini-3.8-flash",
        "kind": "gemini",
    },
    "openai": {
        "label": "ChatGPT (OpenAI)",
        "key_env": "OPENAI_API_KEY",
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4o-mini",
        "kind": "openai_compatible",
        "base_url": "https://api.openai.com/v1",
    },
    "groq": {
        "label": "Groq — 免费，无需信用卡 free, no credit card",
        "key_env": "GROQ_API_KEY",
        "model_env": "GROQ_MODEL",
        "default_model": "llama-3.3-70b-versatile",
        "kind": "openai_compatible",
        "base_url": "https://api.groq.com/openai/v1",
    },
    "mistral": {
        "label": "Mistral AI — 免费额度 free tier, no credit card",
        "key_env": "MISTRAL_API_KEY",
        "model_env": "MISTRAL_MODEL",
        "default_model": "mistral-small-latest",
        "kind": "openai_compatible",
        "base_url": "https://api.mistral.ai/v1",
    },
    "cerebras": {
        "label": "Cerebras — 免费，无需信用卡 free, no credit card",
        "key_env": "CEREBRAS_API_KEY",
        "model_env": "CEREBRAS_MODEL",
        "default_model": "llama-3.3-70b",
        "kind": "openai_compatible",
        "base_url": "https://api.cerebras.ai/v1",
    },
    "openrouter": {
        "label": "OpenRouter — 免费模型 free models available",
        "key_env": "OPENROUTER_API_KEY",
        "model_env": "OPENROUTER_MODEL",
        "default_model": "meta-llama/llama-3.3-70b-instruct:free",
        "kind": "openai_compatible",
        "base_url": "https://openrouter.ai/api/v1",
    },
}

DEFAULT_PROVIDER = os.environ.get("AI_PROVIDER", "claude")


def default_provider() -> str:
    return db.get_setting("ai.default_provider") or DEFAULT_PROVIDER


def _configured_value(provider: str, kind: str) -> str | None:
    cfg = PROVIDER_CONFIG[provider]
    env_name = cfg["key_env"] if kind == "api_key" else cfg["model_env"]
    return os.environ.get(env_name) or db.get_setting(f"ai.{provider}.{kind}")


def available_providers() -> dict:
    """{provider_key: {"label": ..., "configured": bool, "model": <effective model>}}"""
    out = {}
    for key, cfg in PROVIDER_CONFIG.items():
        configured = bool(_configured_value(key, "api_key"))
        out[key] = {
            "label": cfg["label"],
            "configured": configured,
            "model": _configured_value(key, "model") or cfg["default_model"],
        }
    return out


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

Required structure:

**0. 执行摘要 Executive synthesis** (2-3 short items, before any per-module section). This is not a \
preview of the sections below — it is the output of actually synthesizing across all modules to find \
the 2-3 conclusions that matter most this period, each one combining evidence from more than one \
module (e.g. a depot whose route growth, cost, AND cancellation trend all moved together; or a \
network-wide pattern where volume growth came from route count rather than efficiency). State each as \
a headline-as-conclusion, then 1-2 supporting facts with real numbers. This block is the "so what" of \
the whole report — if you can't find genuine cross-module connections, pick the single most decision- \
relevant finding per depot/dimension instead of padding with a generic recap.

**Per-module sections** — one headline+bullets block per module that has data (network overview, \
forecast vs actual, cancellations, vehicle/duration structure, cost analysis / priority routes). Skip a \
module cleanly if its data is empty rather than padding it.
- "标题即结论" — every section heading IS the conclusion, not a topic label. Bad: "Cost analysis". \
Good: "London地区单票成本上升12%，主要由Luton车型占比提高驱动 / London's cost per parcel rose 12%, driven mainly \
by a shift toward Luton vehicles".
- 2-5 bullets per section, each following Data → Insight → So what (→ Now what where supported).

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
    """Cut the full report JSON down to what's worth spending tokens on —
    aggregates and the most extreme individual rows, not every route."""
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


def _post_json(url: str, headers: dict, payload: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_body)
            msg = (err_json.get("error") or {}).get("message") or err_json.get("message") or err_body
        except (json.JSONDecodeError, ValueError):
            msg = err_body
        raise InsightsError(f"API error {e.code}: {str(msg)[:400]}")
    except urllib.error.URLError as e:
        raise InsightsError(f"无法连接到AI服务 / Could not reach the AI provider: {e.reason}")


def _call_claude(api_key: str, model: str, user_content: str) -> str:
    body = _post_json(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        payload={
            "model": model, "max_tokens": MAX_TOKENS, "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_content}],
        },
    )
    parts = body.get("content") or []
    return "".join(p.get("text", "") for p in parts if p.get("type") == "text")


def _call_gemini(api_key: str, model: str, user_content: str) -> str:
    body = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
        headers={"content-type": "application/json"},
        payload={
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_content}]}],
            "generationConfig": {"maxOutputTokens": MAX_TOKENS},
        },
    )
    candidates = body.get("candidates") or []
    if not candidates:
        fb = body.get("promptFeedback")
        raise InsightsError(f"Gemini returned no candidates (feedback: {fb}).")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts)


def _call_openai_compatible(base_url: str, api_key: str, model: str, user_content: str) -> str:
    """Handles any provider that mirrors the OpenAI Chat Completions API shape
    (POST {base_url}/chat/completions, {model, messages, max_tokens} in,
    {choices: [{message: {content}}]} out). This covers OpenAI itself plus
    Groq, Mistral, Cerebras, OpenRouter, and most other "OpenAI-compatible"
    free-tier providers — only the base_url and API key differ."""
    body = _post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
        payload={
            "model": model,
            "max_tokens": MAX_TOKENS,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        },
    )
    choices = body.get("choices") or []
    if not choices:
        raise InsightsError("Provider returned no choices.")
    return (choices[0].get("message") or {}).get("content", "")


def generate_insights(data: dict, provider: str | None = None, model: str | None = None) -> str:
    provider = (provider or default_provider() or "claude").lower()
    if provider not in PROVIDER_CONFIG:
        raise InsightsError(f"未知的AI提供方 '{provider}' / Unknown AI provider '{provider}'. "
                             f"Supported: {', '.join(PROVIDER_CONFIG)}")
    cfg = PROVIDER_CONFIG[provider]
    api_key = _configured_value(provider, "api_key")
    if not api_key:
        raise InsightsError(
            f"{cfg['label']} 尚未配置API密钥。 / {cfg['label']} does not have an API key configured."
        )
    use_model = model or _configured_value(provider, "model") or cfg["default_model"]
    user_content = json.dumps(_distill(data), ensure_ascii=False, default=str)

    kind = cfg["kind"]
    if kind == "anthropic":
        text = _call_claude(api_key, use_model, user_content)
    elif kind == "gemini":
        text = _call_gemini(api_key, use_model, user_content)
    elif kind == "openai_compatible":
        text = _call_openai_compatible(cfg["base_url"], api_key, use_model, user_content)
    else:
        raise InsightsError(f"Provider '{provider}' has an unknown kind '{kind}'.")

    if not text or not text.strip():
        raise InsightsError(f"{cfg['label']} returned an empty response.")
    return text
