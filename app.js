/* ============================================================
   Collection Network Review — frontend
   Zero external dependencies. Charts are native CSS/inline-SVG
   (ported from the validated manual weekly report).
   ============================================================ */

const DEPOTS = ["Manchester", "Birmingham", "London"];
const DEPOT_KEY = { Manchester: "manchester", Birmingham: "birmingham", London: "london" };
const DEPOT_CLASS = { Manchester: "mcr", Birmingham: "bham", London: "ldn" };
const COLOR = { Manchester: "#5c4b8a", Birmingham: "#b8862c", London: "#2f5f92" };
const BI = { Manchester: { en: "Manchester", cn: "曼城" }, Birmingham: { en: "Birmingham", cn: "伯明翰" }, London: { en: "London", cn: "伦敦" } };

const tagHtml = d => `<span class="tag ${DEPOT_CLASS[d]}">${BI[d].en}<span class="cn">${BI[d].cn}</span></span>`;
const fmt = (n, dp = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n, dp = 1) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : (n >= 0 ? '+' : '') + n.toFixed(dp) + '%';
const gbp = (n, dp = 3) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : '£' + Number(n).toFixed(dp);

function showMsg(text, kind = "info") {
  const box = document.getElementById("msgbox");
  box.innerHTML = `<div class="msg ${kind}">${text}</div>`;
  if (kind !== "error") setTimeout(() => { box.innerHTML = ""; }, 6000);
}

/* ---------------- navigation ---------------- */
document.querySelectorAll("nav.tabs button").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
function switchView(view) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "history") loadHistory();
}

/* ---------------- drag & drop for file inputs ---------------- */
function enableDropzone(input) {
  const zone = input.closest(".dropzone");
  if (!zone) return;
  const markFilled = () => zone.classList.toggle("filled", !!(input.files && input.files.length));
  ["dragenter", "dragover"].forEach(evt => zone.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(evt => zone.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove("dragover");
  }));
  zone.addEventListener("drop", e => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  input.addEventListener("change", markFilled);
  markFilled();
}
document.querySelectorAll("#view-upload input[type=file]").forEach(enableDropzone);

/* ---------------- upload form: build dynamic inputs ---------------- */
const routeGrid = document.getElementById("route-file-grid");
const opcGrid = document.getElementById("opc-grid");
DEPOTS.forEach(depot => {
  const key = DEPOT_KEY[depot];
  const cls = DEPOT_CLASS[depot];
  const fg = document.createElement("div");
  fg.className = "filegroup";
  fg.innerHTML = `
    <span class="depot-tag ${cls}">${BI[depot].en} ${BI[depot].cn}</span>
    <div class="field dropzone"><label>日期A文件 <span class="cn">Date A file</span></label><input type="file" id="f-route-${key}-a" accept=".csv"><div class="dropzone-hint">拖拽到此处，或点击选择 Drag & drop, or click to browse</div></div>
    <div class="field dropzone" style="margin-bottom:0;"><label>日期B文件 <span class="cn">Date B file</span></label><input type="file" id="f-route-${key}-b" accept=".csv"><div class="dropzone-hint">拖拽到此处，或点击选择 Drag & drop, or click to browse</div></div>
  `;
  routeGrid.appendChild(fg);
  enableDropzone(fg.querySelector(`#f-route-${key}-a`));
  enableDropzone(fg.querySelector(`#f-route-${key}-b`));

  const og = document.createElement("div");
  og.className = "filegroup";
  og.innerHTML = `
    <span class="depot-tag ${cls}">${BI[depot].en} ${BI[depot].cn}</span>
    <div class="field"><label>日期A OPC</label><input type="number" id="f-opc-${key}-a" placeholder="16114"></div>
    <div class="field" style="margin-bottom:0;"><label>日期B OPC</label><input type="number" id="f-opc-${key}-b" placeholder="14075"></div>
  `;
  opcGrid.appendChild(og);
});

/* ---------------- date pickers -> auto report name ---------------- */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseDateVal(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}
function shortDots(v) { const p = parseDateVal(v); return p ? `${p.m}.${p.d}` : ""; }
function dayMonthLabel(v) { const p = parseDateVal(v); return p ? `${p.d} ${MONTH_ABBR[p.m - 1]}` : ""; }

const nameInput = document.getElementById("f-name");
const dateAInput = document.getElementById("f-date-a");
const dateBInput = document.getElementById("f-date-b");
let nameManuallyEdited = false;
nameInput.addEventListener("input", () => { nameManuallyEdited = true; });
function regenerateName() {
  if (nameManuallyEdited) return;
  const a = dateAInput.value, b = dateBInput.value;
  if (a && b) nameInput.value = `${shortDots(a)}对比${shortDots(b)}`;
}
dateAInput.addEventListener("change", regenerateName);
dateBInput.addEventListener("change", regenerateName);

/* ---------------- AB-scan override rows ---------------- */
const abRows = document.getElementById("ab-rows");
function addAbRow(vals = {}) {
  const row = document.createElement("div");
  row.className = "ab-row";
  row.innerHTML = `
    <div><label>Route ID</label><input type="text" class="ab-route" value="${vals.route_id || ''}" placeholder="555344334871"></div>
    <div><label>日期</label>
      <select class="ab-date" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--ink);">
        <option value="a" ${vals.date_key === 'a' ? 'selected' : ''}>A</option>
        <option value="b" ${vals.date_key !== 'a' ? 'selected' : ''}>B</option>
      </select>
    </div>
    <div><label>修正后揽收量 <span class="cn">Override value</span></label><input type="number" class="ab-value" value="${vals.override_value || ''}" placeholder="1660"></div>
    <div><label>原因 <span class="cn">Reason</span></label><input type="text" class="ab-reason" value="${vals.reason || ''}" placeholder="44T full trailer..."></div>
    <button type="button" class="secondary small ab-remove">删除 Remove</button>
  `;
  row.querySelector(".ab-remove").addEventListener("click", () => row.remove());
  abRows.appendChild(row);
}
document.getElementById("btn-add-ab").addEventListener("click", () => addAbRow());

function collectAbOverrides() {
  return Array.from(abRows.querySelectorAll(".ab-row")).map(row => ({
    route_id: row.querySelector(".ab-route").value.trim(),
    date_key: row.querySelector(".ab-date").value,
    override_value: row.querySelector(".ab-value").value,
    reason: row.querySelector(".ab-reason").value.trim(),
  })).filter(o => o.route_id && o.override_value !== "");
}

/* ---------------- submit ---------------- */
document.getElementById("btn-submit").addEventListener("click", async () => {
  const btn = document.getElementById("btn-submit");
  const status = document.getElementById("submit-status");
  const name = document.getElementById("f-name").value.trim();
  const dateARaw = document.getElementById("f-date-a").value;
  const dateBRaw = document.getElementById("f-date-b").value;

  if (!name || !dateARaw || !dateBRaw) { showMsg("请填写报告名称并选择两个日期 / Please fill in report name and pick both dates", "error"); return; }
  const dateA = dayMonthLabel(dateARaw);
  const dateB = dayMonthLabel(dateBRaw);

  const opc = {};
  for (const depot of DEPOTS) {
    const key = DEPOT_KEY[depot];
    const a = document.getElementById(`f-opc-${key}-a`).value;
    const b = document.getElementById(`f-opc-${key}-b`).value;
    if (!a || !b) { showMsg(`请填写${BI[depot].cn}(${depot})两个日期的OPC数字`, "error"); return; }
    opc[depot] = { a: Number(a), b: Number(b) };
  }

  const fd = new FormData();
  fd.append("name", name);
  fd.append("date_a_label", dateA);
  fd.append("date_b_label", dateB);
  fd.append("opc_json", JSON.stringify(opc));
  fd.append("ab_overrides_json", JSON.stringify(collectAbOverrides()));

  for (const depot of DEPOTS) {
    const key = DEPOT_KEY[depot];
    const fa = document.getElementById(`f-route-${key}-a`).files[0];
    const fb = document.getElementById(`f-route-${key}-b`).files[0];
    if (!fa || !fb) { showMsg(`请上传${BI[depot].cn}(${depot})两个日期的route info文件`, "error"); return; }
    fd.append(`route_${key}_a`, fa);
    fd.append(`route_${key}_b`, fb);
  }
  const ba = document.getElementById("f-billing-a").files[0];
  const bb = document.getElementById("f-billing-b").files[0];
  if (!ba || !bb) { showMsg("请上传两个日期的billing文件", "error"); return; }
  fd.append("billing_a", ba);
  fd.append("billing_b", bb);

  btn.disabled = true; status.textContent = "计算中… Processing…";
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: fd });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.detail || "Upload failed");
    showMsg("报告生成成功！Report generated.", "ok");
    status.textContent = "";
    renderReport(body.data);
    switchView("report");
  } catch (e) {
    showMsg("出错了 / Error: " + e.message, "error");
    status.textContent = "";
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- history ---------------- */
async function loadHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "加载中… Loading…";
  const resp = await fetch("/api/reports");
  const reports = await resp.json();
  if (!reports.length) { list.innerHTML = '<p class="na">还没有保存的报告 / No saved reports yet.</p>'; return; }
  list.innerHTML = "";
  reports.forEach(r => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `<div><div style="font-weight:600;">${r.name}</div><div class="meta">${r.date_a_label} → ${r.date_b_label} · created ${r.created_at}</div></div><button class="secondary small">打开 Open</button>`;
    item.addEventListener("click", async () => {
      const resp2 = await fetch(`/api/reports/${r.id}`);
      const full = await resp2.json();
      renderReport(full.data);
      switchView("report");
    });
    list.appendChild(item);
  });
}

/* ============================================================
   NATIVE CHART HELPERS (zero external JS, ported + validated)
   ============================================================ */
function elt(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

function renderVBar(container, groups, legendPairs) {
  container.innerHTML = '';
  const max = Math.max(...groups.flatMap(g => [g.a.v, g.b.v])) * 1.18 || 1;
  const wrap = elt('div', 'vbar-wrap');
  groups.forEach(g => {
    const grp = elt('div', 'vbar-grp');
    const pair = elt('div', 'vbar-pair');
    [g.a, g.b].forEach(b => {
      const bar = elt('div', 'vbar');
      bar.style.height = Math.max(2, (b.v / max * 100)) + '%';
      bar.style.background = b.color;
      bar.appendChild(elt('div', 'vbar-val', b.valText != null ? b.valText : Math.round(b.v).toLocaleString()));
      pair.appendChild(bar);
    });
    grp.appendChild(pair);
    grp.appendChild(elt('div', 'vbar-lbl', g.label));
    wrap.appendChild(grp);
  });
  container.appendChild(wrap);
  if (legendPairs) {
    const leg = elt('div', 'vbar-legend');
    legendPairs.forEach(p => { leg.innerHTML += `<span><span class="sw" style="background:${p.color}"></span>${p.label}</span>`; });
    container.appendChild(leg);
  }
}

function renderDonut(container, segments) {
  container.innerHTML = '';
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const stops = segments.map(s => { const start = acc / total * 360; acc += s.value; const end = acc / total * 360; return `${s.color} ${start}deg ${end}deg`; }).join(', ');
  const wrap = elt('div', 'donut-wrap');
  wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:14px;height:100%;';
  const donut = elt('div'); donut.style.cssText = 'width:96px;height:96px;border-radius:50%;flex-shrink:0;'; donut.style.background = `conic-gradient(${stops})`;
  const legend = elt('div'); legend.style.cssText = 'font-size:9.5px;color:var(--ink-soft);display:flex;flex-direction:column;gap:5px;';
  segments.forEach(s => {
    const row = elt('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const sw = elt('span'); sw.style.cssText = 'width:8px;height:8px;border-radius:2px;flex-shrink:0;'; sw.style.background = s.color; row.appendChild(sw);
    row.appendChild(document.createTextNode(`${s.label}: ${(s.value / total * 100).toFixed(0)}%`));
    legend.appendChild(row);
  });
  wrap.appendChild(donut); wrap.appendChild(legend);
  container.appendChild(wrap);
}

function renderHGroupedBar(container, rows, legendPairs) {
  container.innerHTML = '';
  const max = Math.max(...rows.flatMap(r => [r.a.v, r.b.v])) || 1;
  const wrap = elt('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:7px;justify-content:center;height:82%;padding:2px;';
  rows.forEach(r => {
    const row = elt('div'); row.style.cssText = 'display:grid;grid-template-columns:70px 1fr;gap:8px;align-items:center;';
    row.appendChild(elt('div', null, r.label)); row.firstChild.style.cssText = 'font-size:9px;color:var(--muted);text-align:right;line-height:1.2;';
    const track = elt('div'); track.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
    [r.a, r.b].forEach(b => {
      const bar = elt('div'); bar.style.cssText = 'height:8px;border-radius:2px;position:relative;min-width:2px;';
      bar.style.width = Math.max(1, (b.v / max * 78)) + '%';
      bar.style.background = b.color;
      const val = elt('div', null, Math.round(b.v).toLocaleString());
      val.style.cssText = 'position:absolute;left:calc(100% + 5px);top:50%;transform:translateY(-50%);font-size:8px;font-weight:700;color:var(--ink-soft);white-space:nowrap;';
      bar.appendChild(val);
      track.appendChild(bar);
    });
    row.appendChild(track);
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
  if (legendPairs) {
    const leg = elt('div', 'vbar-legend');
    legendPairs.forEach(p => { leg.innerHTML += `<span><span class="sw" style="background:${p.color}"></span>${p.label}</span>`; });
    container.appendChild(leg);
  }
}

function renderStackedHBar(container, rows, meta, scaleMax, showPct) {
  container.innerHTML = '';
  const wrap = elt('div', 'stackbar-wrap');
  rows.forEach(r => {
    const row = elt('div', 'stackbar-row');
    row.appendChild(elt('div', 'stackbar-lbl', r.label));
    const track = elt('div', 'stackbar-track');
    const rowTotal = scaleMax || r.segs.reduce((s, x) => s + x.val, 0) || 1;
    r.segs.forEach(s => {
      const w = s.val / rowTotal * 100;
      if (w <= 0) return;
      const seg = elt('div', 'stackbar-seg');
      seg.style.width = w + '%';
      seg.style.background = meta[s.key].color;
      if (w > 7) seg.textContent = showPct ? w.toFixed(0) + '%' : s.val;
      track.appendChild(seg);
    });
    row.appendChild(track);
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
  const legend = elt('div', 'stack-legend');
  Object.entries(meta).forEach(([k, m]) => { legend.innerHTML += `<span class="row"><span class="sw" style="background:${m.color}"></span>${m.label}</span>`; });
  container.appendChild(legend);
}

function renderHBarList(container, items) {
  container.innerHTML = '';
  const wrap = elt('div', 'hbarlist');
  const totalH = container.clientHeight || (items.length * 16);
  const rowH = Math.max(8, totalH / items.length);
  const max = Math.max(...items.map(i => i.val)) * 1.04 || 1;
  items.forEach(it => {
    const row = elt('div', 'hbarlist-row');
    row.style.height = rowH.toFixed(2) + 'px';
    if (it.tooltip) row.title = it.tooltip;
    row.appendChild(elt('div', 'hbarlist-lbl', it.label));
    const track = elt('div', 'hbarlist-track');
    const bar = elt('div', 'hbarlist-bar');
    bar.style.width = Math.max(1, (it.val / max * 100)) + '%';
    bar.style.background = it.color;
    track.appendChild(bar);
    row.appendChild(track);
    row.appendChild(elt('div', 'hbarlist-val', it.valText != null ? it.valText : it.val));
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
}

function renderMultiLine(container, series, xLabels) {
  container.innerHTML = '';
  const wrap = elt('div', 'mlwrap');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 100'); svg.setAttribute('preserveAspectRatio', 'none');
  const allVals = series.flatMap(s => s.points);
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = (max - min) || 1;
  const padL = 6, padR = 6, padT = 12, padB = 16;
  const plotW = 300 - padL - padR, plotH = 100 - padT - padB;
  const n = xLabels.length;
  const xAt = i => padL + (n === 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = v => padT + plotH - ((v - min) / range) * plotH;
  let svgInner = '';
  series.forEach(s => {
    const pts = s.points.map((v, i) => [xAt(i), yAt(v)]);
    const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    svgInner += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.2"/>`;
    pts.forEach(p => svgInner += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${s.color}"/>`);
  });
  xLabels.forEach((lbl, i) => { svgInner += `<text x="${xAt(i).toFixed(1)}" y="98" font-size="7" text-anchor="middle" fill="currentColor" opacity="0.55">${lbl}</text>`; });
  svg.innerHTML = svgInner;
  wrap.appendChild(svg);
  const legend = elt('div', 'vbar-legend');
  series.forEach(s => legend.innerHTML += `<span><span class="sw" style="background:${s.color}"></span>${s.label}: £${s.points[0].toFixed(2)}→£${s.points[s.points.length - 1].toFixed(2)}</span>`);
  wrap.appendChild(legend);
  container.appendChild(wrap);
}

/* ============================================================
   REPORT RENDERING — builds the report from a fetched JSON `D`
   ============================================================ */
function renderReport(D) {
  document.getElementById("report-empty").style.display = "none";
  const root = document.getElementById("report-content");
  root.style.display = "block";
  root.innerHTML = buildReportSkeleton(D);

  const S = D.summary, NET = D.net, FORECAST = D.forecast;
  const gapNet14 = (NET.act14 / NET.f14 - 1) * 100, gapNet21 = (NET.act21 / NET.f21 - 1) * 100;

  /* ---- KPI row ---- */
  const kpis = [
    { en: 'Network Actual Pickup — ' + D.date_b_label, cn: '全网实际揽收量', val: fmt(NET.act21) + ' pcs' },
    { en: '£/Parcel WoW', cn: '单票成本环比', val: gbp(NET.cpp14) + ' → ' + gbp(NET.cpp21) },
    { en: 'Forecast Deviation WoW', cn: '预测偏差环比', val: gapNet14.toFixed(1) + '% → ' + gapNet21.toFixed(1) + '%' },
    { en: 'Total Routes WoW', cn: '总路线数环比', val: NET.routes14 + ' → ' + NET.routes21 },
    { en: 'Parcels / Route WoW', cn: '单路线产出环比', val: fmt(NET.ppr14) + ' → ' + fmt(NET.ppr21) },
  ];
  const kpiRow = document.getElementById('kpiRow');
  kpis.forEach(k => { kpiRow.innerHTML += `<div class="kpi"><div class="lbl">${k.en}<span class="cn">${k.cn}</span></div><div class="val tabular">${k.val}</div></div>`; });

  /* ---- overview mini charts ---- */
  renderVBar(document.getElementById('cOverviewBar'),
    DEPOTS.map(d => ({ label: BI[d].en, a: { v: S[d].act14, color: 'var(--line)' }, b: { v: S[d].act21, color: COLOR[d] } })),
    [{ label: D.date_a_label, color: 'var(--line)' }, { label: D.date_b_label, color: 'var(--ink-soft)' }]);
  renderMultiLine(document.getElementById('cOverviewLine'), [{ label: 'Network', color: 'var(--accent)', points: [NET.cpp14, NET.cpp21] }], [D.date_a_label, D.date_b_label]);
  renderDonut(document.getElementById('cOverviewPie'), DEPOTS.map(d => ({ label: BI[d].en, color: COLOR[d], value: S[d].routes21 })));

  /* ---- 01 review table ---- */
  const reviewTable = document.getElementById('reviewTable');
  DEPOTS.forEach(d => {
    const s = S[d];
    const dRoutes = (s.routes21 / s.routes14 - 1) * 100, dAct = (s.act21 / s.act14 - 1) * 100, dCpp = (s.cpp21 / s.cpp14 - 1) * 100;
    const gap14 = (s.act14 / s.f14 - 1) * 100, gap21 = (s.act21 / s.f21 - 1) * 100;
    reviewTable.innerHTML += `<tr>
      <td style="text-align:left;">${tagHtml(d)}</td>
      <td class="tabular">${s.routes14} → ${s.routes21}</td>
      <td class="tabular ${dRoutes > 0 ? 'neg' : dRoutes < 0 ? 'pos' : ''}">${pct(dRoutes)}</td>
      <td class="tabular">${fmt(s.f14)} → ${fmt(s.f21)}</td>
      <td class="tabular">${fmt(s.act14)} → ${fmt(s.act21)}</td>
      <td class="tabular">${pct(gap14)}</td><td class="tabular">${pct(gap21)}</td>
      <td class="tabular ${dAct >= 0 ? 'pos' : 'neg'}">${pct(dAct)}</td>
      <td class="tabular">${gbp(s.cpp14)} → ${gbp(s.cpp21)}</td>
      <td class="tabular ${dCpp <= 0 ? 'pos' : 'neg'}">${pct(dCpp)}</td>
      <td class="tabular">${s.x14} → ${s.x21}</td>
      <td class="tabular">${fmt(s.merch_f21)} → ${fmt(s.merch_a21)}</td>
    </tr>`;
  });
  const netDAct = (NET.act21 / NET.act14 - 1) * 100, netDCpp = (NET.cpp21 / NET.cpp14 - 1) * 100, netDRoutes = (NET.routes21 / NET.routes14 - 1) * 100;
  const totCancel14 = DEPOTS.reduce((a, d) => a + S[d].x14, 0), totCancel21 = DEPOTS.reduce((a, d) => a + S[d].x21, 0);
  reviewTable.innerHTML += `<tr class="totalrow">
    <td style="text-align:left;">Network<span class="cn" style="display:block;">全网</span></td>
    <td class="tabular">${NET.routes14} → ${NET.routes21}</td><td class="tabular neg">${pct(netDRoutes)}</td>
    <td class="tabular">${fmt(NET.f14)} → ${fmt(NET.f21)}</td><td class="tabular">${fmt(NET.act14)} → ${fmt(NET.act21)}</td>
    <td class="tabular">${pct(gapNet14)}</td><td class="tabular">${pct(gapNet21)}</td>
    <td class="tabular pos">${pct(netDAct)}</td>
    <td class="tabular">${gbp(NET.cpp14)} → ${gbp(NET.cpp21)}</td><td class="tabular neg">${pct(netDCpp)}</td>
    <td class="tabular">${totCancel14} → ${totCancel21}</td><td><span class="na">—</span></td>
  </tr>`;

  /* ---- 02 forecast ---- */
  renderHGroupedBar(document.getElementById('cForecast'),
    DEPOTS.flatMap(d => [
      { label: BI[d].en + ' ' + D.date_a_label, a: { v: FORECAST[d].f14, color: 'var(--line)' }, b: { v: FORECAST[d].a14, color: COLOR[d] } },
      { label: BI[d].en + ' ' + D.date_b_label, a: { v: FORECAST[d].f21, color: 'var(--line)' }, b: { v: FORECAST[d].a21, color: COLOR[d] } },
    ]), [{ label: 'Forecast', color: 'var(--line)' }, { label: 'Actual', color: 'var(--accent)' }]);
  const forecastTable = document.getElementById('forecastTable');
  DEPOTS.forEach(d => {
    const f = FORECAST[d]; const g14 = (f.a14 / f.f14 - 1) * 100, g21 = (f.a21 / f.f21 - 1) * 100;
    forecastTable.innerHTML += `<tr><td style="text-align:left;">${tagHtml(d)}</td><td class="tabular">${fmt(f.f14)}</td><td class="tabular">${fmt(f.a14)}</td><td class="tabular ${g14 >= 0 ? 'pos' : 'neg'}">${pct(g14)}</td><td class="tabular">${fmt(f.f21)}</td><td class="tabular">${fmt(f.a21)}</td><td class="tabular ${g21 >= 0 ? 'pos' : 'neg'}">${pct(g21)}</td></tr>`;
  });
  forecastTable.innerHTML += `<tr class="totalrow"><td style="text-align:left;">Network</td><td class="tabular">${fmt(NET.f14)}</td><td class="tabular">${fmt(NET.act14)}</td><td class="tabular neg">${pct(gapNet14)}</td><td class="tabular">${fmt(NET.f21)}</td><td class="tabular">${fmt(NET.act21)}</td><td class="tabular neg">${pct(gapNet21)}</td></tr>`;

  /* ---- 03 cancellations ---- */
  const reasonKeys = Array.from(new Set([...Object.keys(D.reasons_a), ...Object.keys(D.reasons_b)]));
  const reasonColors = ['#c1592e', '#5c4b8a', '#2f5f92', '#2f7a4f', '#b8862c', '#8a8f78', '#a33e6b'];
  const reasonMeta = {}; reasonKeys.forEach((k, i) => { reasonMeta[k] = { label: (k.length > 26 ? k.slice(0, 24) + '…' : k), color: reasonColors[i % reasonColors.length] }; });
  const reasonMax = Math.max(Object.values(D.reasons_a).reduce((a, b) => a + b, 0) || 0, Object.values(D.reasons_b).reduce((a, b) => a + b, 0) || 0) || 1;
  renderStackedHBar(document.getElementById('cReason'),
    [{ label: D.date_a_label, segs: reasonKeys.map(k => ({ key: k, val: D.reasons_a[k] || 0 })) },
    { label: D.date_b_label, segs: reasonKeys.map(k => ({ key: k, val: D.reasons_b[k] || 0 })) }], reasonMeta, reasonMax, false);
  renderVBar(document.getElementById('cCancelSite'),
    DEPOTS.map(d => ({ label: BI[d].en, a: { v: D.cancel_site_a[d] || 0, color: 'var(--line)' }, b: { v: D.cancel_site_b[d] || 0, color: COLOR[d] } })),
    [{ label: D.date_a_label, color: 'var(--line)' }, { label: D.date_b_label, color: 'var(--ink-soft)' }]);
  const merchantTable = document.getElementById('merchantTable');
  if (D.merchants.length === 0) { merchantTable.innerHTML = `<tr><td colspan="5" class="na" style="text-align:center;">没有单日取消≥2次的商家 / none</td></tr>`; }
  D.merchants.forEach(m => { merchantTable.innerHTML += `<tr><td style="text-align:left;">${m.day}</td><td style="text-align:left;">${m.seller}</td><td style="text-align:left;">${tagHtml(m.depot)}</td><td class="tabular neg">${m.n}</td><td class="tabular">${fmt(m.pkgs)}</td></tr>`; });

  /* ---- 05 cost ---- */
  (function renderCostVol() {
    const container = document.getElementById('cCostVol');
    container.innerHTML = '';
    container.style.display = 'flex'; container.style.flexDirection = 'column'; container.style.height = '100%';
    const totalH = container.clientHeight || 320;
    const bottomH = Math.round(totalH * 0.40);
    const topH = totalH - bottomH - 15;
    const top = elt('div'); top.style.flex = '0 0 auto'; top.style.height = topH + 'px'; top.style.overflow = 'hidden';
    const bottom = elt('div'); bottom.style.flex = '0 0 auto'; bottom.style.height = bottomH + 'px'; bottom.style.overflow = 'hidden';
    bottom.style.marginTop = '10px'; bottom.style.borderTop = '1px dashed var(--line)'; bottom.style.paddingTop = '5px';
    container.appendChild(top); container.appendChild(bottom);
    renderVBar(top, DEPOTS.map(d => ({ label: BI[d].en, a: { v: S[d].act14, color: 'var(--line)' }, b: { v: S[d].act21, color: COLOR[d] } })), [{ label: 'Actual pickup', color: COLOR.Manchester }]);
    renderMultiLine(bottom, DEPOTS.map(d => ({ label: BI[d].en, color: COLOR[d], points: [S[d].cpp14, S[d].cpp21] })), [D.date_a_label, D.date_b_label]);
  })();

  const netSummaryTable = document.getElementById('netSummaryTable');
  const netRows = [
    ['Total cost / 总成本', gbp(NET.cost14, 2), gbp(NET.cost21, 2), pct((NET.cost21 / NET.cost14 - 1) * 100), 'neg'],
    ['Actual pickup / 实际揽收', fmt(NET.act14), fmt(NET.act21), pct((NET.act21 / NET.act14 - 1) * 100), 'pos'],
    ['£ / parcel / 单票成本', gbp(NET.cpp14), gbp(NET.cpp21), pct((NET.cpp21 / NET.cpp14 - 1) * 100), 'neg'],
    ['Total routes / 总路线数', NET.routes14, NET.routes21, pct((NET.routes21 / NET.routes14 - 1) * 100), 'neg'],
    ['Parcels / route / 单路线产出', fmt(NET.ppr14, 1), fmt(NET.ppr21, 1), pct((NET.ppr21 / NET.ppr14 - 1) * 100), 'neg'],
  ];
  netRows.forEach(r => { netSummaryTable.innerHTML += `<tr><td style="text-align:left;">${r[0]}</td><td class="tabular">${r[1]}</td><td class="tabular">${r[2]}</td><td class="tabular ${r[4]}">${r[3]}</td></tr>`; });

  const ppSorted = D.pp_latest.slice().sort((a, b) => a.pp - b.pp);
  renderHBarList(document.getElementById('cPricePerParcel'), ppSorted.map(r => ({
    label: r.route_id, val: r.pp, color: COLOR[r.depot], valText: '£' + r.pp.toFixed(3),
    tooltip: `${r.depot} · ${r.driver}: £${r.pp.toFixed(3)}/parcel (${r.act} pcs)`
  })));

  /* ---- priority table, sortable ---- */
  const priorityRows = D.flagged_latest.map(r => ({ ...r, hitcount: (r.fs ? 1 : 0) + (r.fd ? 1 : 0) + (r.fm ? 1 : 0), repeat: D.repeats[r.driver] || '' }));
  const priorityTable = document.getElementById('priorityTable');
  let priState = { key: 'pp', dir: 'desc' };
  function renderPriorityTable() {
    const rows = priorityRows.slice().sort((a, b) => {
      let va = a[priState.key], vb = b[priState.key];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      let cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp === 0) cmp = a.route_id < b.route_id ? -1 : a.route_id > b.route_id ? 1 : 0;
      return priState.dir === 'asc' ? cmp : -cmp;
    });
    priorityTable.innerHTML = '';
    if (rows.length === 0) { priorityTable.innerHTML = `<tr><td colspan="10" class="na" style="text-align:center;">没有命中阈值的路线 / none flagged</td></tr>`; }
    rows.forEach(r => {
      const flags = (r.fs ? '<span class="flagpill fs">S</span>' : '') + (r.fd ? '<span class="flagpill fd">D</span>' : '') + (r.fm ? '<span class="flagpill fm">M</span>' : '');
      priorityTable.innerHTML += `<tr>
        <td style="text-align:left;" class="tabular">${r.route_id}</td>
        <td style="text-align:left;">${tagHtml(r.depot)}</td>
        <td style="text-align:left;">${r.driver}</td>
        <td style="text-align:left;font-size:10.5px;">${r.vehicle}</td>
        <td class="tabular">${fmt(r.est)}</td><td class="tabular">${fmt(r.act)}</td>
        <td class="tabular">${r.completed} / ${r.cancelled}</td>
        <td class="tabular">${gbp(r.pp)}</td>
        <td style="text-align:left;">${flags}</td>
        <td style="text-align:left;">${r.repeat ? '<span class="neg">⟳ ' + r.repeat + '</span>' : '—'}</td>
      </tr>`;
    });
    document.querySelectorAll('#priorityThead th[data-key]').forEach(th => {
      const isSorted = th.dataset.key === priState.key;
      th.classList.toggle('sorted', isSorted);
      th.querySelector('.sortarrow').textContent = isSorted ? (priState.dir === 'asc' ? '▲' : '▼') : '';
    });
  }
  document.querySelectorAll('#priorityThead th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (priState.key === key) { priState.dir = priState.dir === 'asc' ? 'desc' : 'asc'; }
      else { priState.key = key; priState.dir = th.dataset.type === 'number' ? 'desc' : 'asc'; }
      renderPriorityTable();
    });
  });
  renderPriorityTable();

  document.getElementById('priorityNote').innerHTML =
    `命中任一维度：${D.flagged_latest.length} / ${DEPOTS.reduce((a, d) => a + (D.anomaly_depot[d]?.total || 0), 0)} 条路线（阈值：scan≤${D.thresholds.scan?.toFixed(1)}, drive≤${D.thresholds.drive?.toFixed(1)}, mi/stop≥${D.thresholds.mi?.toFixed(1)}）`;

  if (D.ab_scan_applied.length) {
    document.getElementById('abScanNote').innerHTML = D.ab_scan_applied.map(a =>
      `路线 ${a.route_id}：${a.before ?? 'N/A'} → <b>${a.after}</b>（${a.reason || '无说明'}）`).join('<br>');
  } else {
    document.getElementById('abScanNote').innerHTML = '<span class="na">本次未应用AB scan修正</span>';
  }
  if (D.warnings && D.warnings.length) {
    document.getElementById('warnNote').innerHTML = '⚠ ' + D.warnings.join('<br>⚠ ');
    document.getElementById('warnNote').style.display = 'block';
  }
}

function buildReportSkeleton(D) {
  return `
  <div class="kpirow" id="kpiRow"></div>
  <div id="warnNote" class="msg error" style="display:none;"></div>

  <div class="panel">
    <p style="margin:0 0 10px;">Data: ${D.date_a_label} → ${D.date_b_label}, all 3 depots. Route-level "actual" uses each system's own Actual Total Pickup (AB-scan overrides applied where entered); depot/network headline actual uses OPC.
    <span class="cn" style="display:block;margin-top:4px;color:var(--muted);">路线级"实际揽收"使用各系统自身记录（已应用输入的AB scan修正）；仓/全网头部KPI使用OPC修正值。</span></p>
    <div class="grid3">
      <div class="panel" style="margin-bottom:0;"><h3>Actual pickup by depot<span class="cn">各仓实际揽收量</span></h3><div class="chartbox mini"><div id="cOverviewBar" style="height:100%;"></div></div></div>
      <div class="panel" style="margin-bottom:0;"><h3>Network £/parcel trend<span class="cn">全网单票成本趋势</span></h3><div class="chartbox mini"><div id="cOverviewLine" style="height:100%;"></div></div></div>
      <div class="panel" style="margin-bottom:0;"><h3>Route share by depot<span class="cn">各仓路线占比</span></h3><div class="chartbox mini"><div id="cOverviewPie" style="height:100%;"></div></div></div>
    </div>
  </div>

  <div class="panel">
    <h3>01 · Overall Review<span class="cn">整体回顾</span></h3>
    <div class="tblwrap">
      <table><thead><tr>
        <th style="text-align:left;">Depot<span class="cn">仓</span></th>
        <th>Routes<span class="cn">路线数</span></th><th>Δ Routes<span class="cn">路线环比</span></th>
        <th>Forecast<span class="cn">预测量</span></th><th>Actual<span class="cn">实际揽收</span></th>
        <th>Fcst dev. A<span class="cn">预测偏差A</span></th><th>Fcst dev. B<span class="cn">预测偏差B</span></th>
        <th>Δ Actual<span class="cn">揽收环比</span></th>
        <th>£/parcel<span class="cn">单票成本</span></th><th>Δ £/parcel<span class="cn">单票环比</span></th>
        <th>Cancels<span class="cn">取消数</span></th><th>Merchants f→a<span class="cn">商家(预测→实际)</span></th>
      </tr></thead><tbody id="reviewTable"></tbody></table>
    </div>
  </div>

  <div class="panel">
    <h3>02 · Forecast vs Actual<span class="cn">预测与实际偏差</span></h3>
    <div class="grid2">
      <div class="chartbox tall"><div id="cForecast" style="height:100%;"></div></div>
      <div class="tblwrap"><table><thead><tr><th style="text-align:left;">Depot</th><th>Fcst A</th><th>Act A</th><th>Dev A</th><th>Fcst B</th><th>Act B</th><th>Dev B</th></tr></thead><tbody id="forecastTable"></tbody></table></div>
    </div>
  </div>

  <div class="panel">
    <h3>03 · Cancellations<span class="cn">取消分析</span></h3>
    <div class="grid2">
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">Cancellation reasons<span class="cn" style="display:block;color:var(--muted);font-weight:400;">取消原因</span></h4><div class="chartbox tall"><div id="cReason" style="height:100%;"></div></div></div>
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">Cancellations by depot<span class="cn" style="display:block;color:var(--muted);font-weight:400;">按仓取消次数</span></h4><div class="chartbox tall"><div id="cCancelSite" style="height:100%;"></div></div></div>
    </div>
    <div class="tblwrap" style="margin-top:14px;">
      <h4 style="font-size:12.5px;margin:0 0 8px;">Repeat merchants (2+ cancellations)<span class="cn" style="display:block;color:var(--muted);font-weight:400;">高频取消商家</span></h4>
      <table><thead><tr><th style="text-align:left;">Day</th><th style="text-align:left;">Seller</th><th style="text-align:left;">Depot</th><th>Cancellations</th><th>Est. parcels</th></tr></thead><tbody id="merchantTable"></tbody></table>
    </div>
  </div>

  <div class="panel">
    <h3>05 · Cost Analysis<span class="cn">成本分析</span></h3>
    <div class="grid2">
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">Actual pickup vs £/parcel<span class="cn" style="display:block;color:var(--muted);font-weight:400;">揽收量 vs 单票成本</span></h4><div class="chartbox tall"><div id="cCostVol" style="height:100%;"></div></div></div>
      <div class="tblwrap"><table><thead><tr><th style="text-align:left;">Metric</th><th>A</th><th>B</th><th>WoW</th></tr></thead><tbody id="netSummaryTable"></tbody></table></div>
    </div>
    <h4 style="font-size:12.5px;margin:20px 0 8px;">£/parcel by route (date B), low → high<span class="cn" style="display:block;color:var(--muted);font-weight:400;">路线单票价格，从低到高（较晚日期）</span></h4>
    <div class="chartbox xtall"><div id="cPricePerParcel" style="height:100%;"></div></div>

    <h4 style="font-size:12.5px;margin:20px 0 4px;">Priority routes for review (date B)<span class="cn" style="display:block;color:var(--muted);font-weight:400;">重点关注路线（较晚日期）</span></h4>
    <p id="priorityNote" style="font-size:11.5px;color:var(--muted);margin:0 0 10px;"></p>
    <p style="font-size:11px;color:var(--muted);margin:0 0 10px;">Click a column header to sort. <span class="cn">点击列标题排序。</span> S=scan eff. bottom 20% · D=driving eff. bottom 20% · M=mileage/stop top 20%</p>
    <div class="tblwrap">
      <table><thead><tr id="priorityThead">
        <th style="text-align:left;" data-key="route_id" data-type="string">Route ID<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="depot" data-type="string">Depot<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="driver" data-type="string">Driver<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="vehicle" data-type="string">Vehicle<span class="sortarrow"></span></th>
        <th data-key="est" data-type="number">Forecast<span class="sortarrow"></span></th>
        <th data-key="act" data-type="number">Actual<span class="sortarrow"></span></th>
        <th data-key="completed" data-type="number">Compl./Cancel.<span class="sortarrow"></span></th>
        <th data-key="pp" data-type="number">£/parcel<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="hitcount" data-type="number">Hit dim.<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="repeat" data-type="string">Repeat<span class="sortarrow"></span></th>
      </tr></thead><tbody id="priorityTable"></tbody></table>
    </div>

    <h4 style="font-size:12.5px;margin:20px 0 8px;">AB-scan corrections applied<span class="cn" style="display:block;color:var(--muted);font-weight:400;">已应用的AB scan修正</span></h4>
    <p id="abScanNote" style="font-size:12px;"></p>
  </div>
  `;
}
