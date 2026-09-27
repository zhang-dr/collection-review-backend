/* ============================================================
   Collection Network Review — frontend
   Zero external dependencies. Charts are native CSS/inline-SVG
   (ported from the validated manual weekly report).
   ============================================================ */

// Deployment-path-agnostic API base: derived from this script's own resolved
// URL, so the app works unmodified whether it's served at domain root
// (http://localhost:8811/) or under a subpath (https://zhangxihao.com/CBTAnalysis/),
// as long as the reverse proxy strips that subpath before forwarding to the backend.
const API_BASE = document.currentScript.src.replace(/app\.js(\?.*)?$/, "") + "api/";

const DEPOTS = ["Manchester", "Birmingham", "London"];
const DEPOT_KEY = { Manchester: "manchester", Birmingham: "birmingham", London: "london" };
const DEPOT_CLASS = { Manchester: "mcr", Birmingham: "bham", London: "ldn" };
const COLOR = { Manchester: "#5c4b8a", Birmingham: "#b8862c", London: "#2f5f92" };
const BI = { Manchester: { en: "Manchester", cn: "曼城" }, Birmingham: { en: "Birmingham", cn: "伯明翰" }, London: { en: "London", cn: "伦敦" } };

const tagHtml = d => `<span class="tag ${DEPOT_CLASS[d]}">${BI[d].en}<span class="cn">${BI[d].cn}</span></span>`;
const fmt = (n, dp = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n, dp = 1) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : (n >= 0 ? '+' : '') + n.toFixed(dp) + '%';
// percentage-POINT change — for metrics that are themselves already a share/%
// (route share, duration share...). Never use pct() for these — pct() computes
// a *relative* % change of a %, which is the historical bug this project's
// methodology doc explicitly flags as previously mis-formatted.
const ppfmt = (n, dp = 1) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : (n >= 0 ? '+' : '') + n.toFixed(dp) + 'pp';
const gbp = (n, dp = 3) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">N/A</span>' : '£' + Number(n).toFixed(dp);
// % change guarded against a zero/null/missing base — an inactive depot's
// period has routes14=0 / cpp14=null, which would otherwise divide into
// Infinity or NaN instead of a clean N/A.
const pctChange = (nv, ov) => (nv == null || ov == null || !ov || Number.isNaN(nv) || Number.isNaN(ov)) ? null : (nv / ov - 1) * 100;
// Cost movements use the business convention: higher cost is adverse/red,
// lower cost is favourable/green.
const costTrendClass = change => change == null || change === 0 ? '' : change > 0 ? 'neg' : 'pos';
// qualitative palette for dynamic categories (vehicle classes, cancel reasons)
const QUAL_COLORS = ['#5c4b8a', '#b8862c', '#2f5f92', '#2f7a4f', '#c1592e', '#a33e6b', '#8a8f78', '#7a5230'];

function showMsg(text, kind = "info") {
  const box = document.getElementById("msgbox");
  box.innerHTML = `<div class="msg ${kind}">${text}</div>`;
  if (kind === "error") box.scrollIntoView({ behavior: "smooth", block: "start" });
  if (kind !== "error") setTimeout(() => { box.innerHTML = ""; }, 6000);
}

/* ---------------- auth: lightweight username(+optional password) login ----------------
   Not a real security system — see the copy on the login card. First login
   for a given username creates the account with whatever password was
   given; later logins with that username must match it. The token is kept
   in localStorage and sent as an Authorization: Bearer header on every
   API call that needs an identity (upload, history). */
const AUTH_TOKEN_KEY = "crna_token";
const AUTH_USER_KEY = "crna_username";
let currentUser = null;
let currentUserIsAdmin = false;
let currentUserAiAllowed = false;

function authHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: "Bearer " + token } : {};
}
function showLoginGate() {
  document.body.classList.add("logged-out");
  document.getElementById("loginGate").style.display = "flex";
  document.getElementById("userbar").hidden = true;
  currentUser = null;
  currentUserIsAdmin = false;
  currentUserAiAllowed = false;
  document.getElementById("navAdminBtn").hidden = true;
  document.getElementById("view-admin").hidden = true;
  document.getElementById("report-content").innerHTML = "";
  document.getElementById("report-content").style.display = "none";
  document.getElementById("report-empty").style.display = "block";
  document.getElementById("history-list").innerHTML = "";
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === "upload"));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-upload"));
}
function hideLoginGate() {
  document.body.classList.remove("logged-out");
  document.getElementById("loginGate").style.display = "none";
  document.getElementById("userbar").hidden = false;
  document.getElementById("userbarName").textContent = currentUser || "";
  if (typeof loadOpcWeek === "function") loadOpcWeek();
}
// Shows/hides UI that depends on the logged-in account's role — the Admin
// nav tab (admin only) — called after every login and on checkAuth().
function applyUserPermissionsUI() {
  document.getElementById("navAdminBtn").hidden = !currentUserIsAdmin;
  document.getElementById("view-admin").hidden = !currentUserIsAdmin;
}
async function checkAuth() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) { showLoginGate(); return; }
  try {
    const resp = await fetch(API_BASE + "auth/me", { headers: authHeaders() });
    if (!resp.ok) throw new Error("invalid session");
    const body = await resp.json();
    currentUser = body.username;
    currentUserIsAdmin = !!body.is_admin;
    currentUserAiAllowed = !!body.ai_allowed || currentUserIsAdmin;
    applyUserPermissionsUI();
    hideLoginGate();
  } catch (e) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    currentUser = null;
    currentUserIsAdmin = false;
    currentUserAiAllowed = false;
    applyUserPermissionsUI();
    showLoginGate();
  }
}
document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("f-login-user").value.trim();
  const password = document.getElementById("f-login-pass").value;
  const errBox = document.getElementById("loginError");
  errBox.style.display = "none";
  if (!username) { errBox.textContent = "请输入用户名 / Username is required"; errBox.style.display = "block"; return; }
  try {
    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    const resp = await fetch(API_BASE + "auth/login", { method: "POST", body: fd });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.detail || "Login failed");
    localStorage.setItem(AUTH_TOKEN_KEY, body.token);
    localStorage.setItem(AUTH_USER_KEY, body.username);
    currentUser = body.username;
    currentUserIsAdmin = !!body.is_admin;
    currentUserAiAllowed = !!body.ai_allowed || currentUserIsAdmin;
    applyUserPermissionsUI();
    hideLoginGate();
  } catch (e) {
    errBox.textContent = "登录失败 / " + e.message;
    errBox.style.display = "block";
  }
});
document.getElementById("f-login-pass").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-login").click(); });

/* ---------------- generic confirm modal (Promise-based) ---------------- */
function showConfirm(titleHtml, bodyHtml, okLabel = "继续 Continue") {
  return new Promise(resolve => {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmTitle").innerHTML = titleHtml;
    document.getElementById("confirmBody").innerHTML = bodyHtml;
    const okBtn = document.getElementById("confirmOk");
    const cancelBtn = document.getElementById("confirmCancel");
    okBtn.textContent = okLabel;
    modal.hidden = false;
    const onBackdrop = e => { if (e.target === modal) cleanup(false); };
    const cleanup = result => { modal.hidden = true; okBtn.onclick = null; cancelBtn.onclick = null; modal.removeEventListener("click", onBackdrop); document.removeEventListener("keydown", onKeydown); resolve(result); };
    const onKeydown = e => { if (e.key === "Escape") cleanup(false); };
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}
document.getElementById("btn-logout").addEventListener("click", async () => {
  try { await fetch(API_BASE + "auth/logout", { method: "POST", headers: authHeaders() }); } catch (e) { /* ignore */ }
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  currentUser = null;
  currentUserIsAdmin = false;
  currentUserAiAllowed = false;
  applyUserPermissionsUI();
  showLoginGate();
});
checkAuth();

/* ---------------- navigation ---------------- */
document.querySelectorAll("nav.tabs button").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
function switchView(view) {
  if (!currentUser || (view === "admin" && !currentUserIsAdmin)) return;
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "history") loadHistory();
  if (view === "admin") loadAdminUsers();
}

/* ---------------- admin panel: create accounts ----------------
   Only reachable via the Admin nav tab, which applyUserPermissionsUI() keeps
   hidden for everyone but the admin account — but the real gate is server
   side (require_admin on every /api/admin/* route), this is just UI. */
async function loadAdminUsers() {
  const tbody = document.getElementById('adminUserTable');
  tbody.innerHTML = '<tr><td colspan="5" class="na" style="text-align:center;">加载中… Loading…</td></tr>';
  try {
    const resp = await fetch(API_BASE + 'admin/users', { headers: authHeaders() });
    if (resp.status === 401) { showLoginGate(); return; }
    if (resp.status === 403) { tbody.innerHTML = '<tr><td colspan="5" class="na" style="text-align:center;">仅管理员可见 / Admins only</td></tr>'; return; }
    const users = await resp.json();
    tbody.innerHTML = '';
    users.forEach(u => {
      const row = document.createElement('tr');
      const isAdminUser = !!u.is_admin || u.username === 'Xihao';
      row.innerHTML = `
        <td style="text-align:left;font-weight:600;">${u.username}</td>
        <td style="text-align:left;">${isAdminUser ? '<span class="pos">✓ Admin</span>' : '<span class="na">—</span>'}</td>
        <td style="text-align:left;">${isAdminUser ? '<span class="pos">始终开放 Always on</span>' : `<label style="display:flex;align-items:center;gap:7px;"><input type="checkbox" class="ai-access-toggle" data-username="${u.username}" ${u.ai_allowed ? 'checked' : ''} aria-label="Enable AI export for ${u.username}"><span>${u.ai_allowed ? '已开放 Enabled' : '关闭 Off'}</span></label>`}</td>
        <td style="text-align:left;"><div style="display:flex;gap:5px;"><input type="password" class="admin-new-password" autocomplete="new-password" aria-label="New password for ${u.username}" style="min-width:100px;width:130px;padding:6px;" placeholder="新密码"><button type="button" class="secondary small admin-set-password">更新</button></div></td>
        <td style="text-align:left;font-size:11px;color:var(--muted);">${u.created_at || ''}</td>
      `;
      tbody.appendChild(row);
      const toggle = row.querySelector('.ai-access-toggle');
      if (toggle) toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        const fd = new FormData(); fd.append('allowed', String(toggle.checked));
        try {
          const update = await fetch(`${API_BASE}admin/users/${encodeURIComponent(u.username)}/ai-access`, { method: 'POST', headers: authHeaders(), body: fd });
          const result = await update.json();
          if (!update.ok) throw new Error(result.detail || 'Update failed');
          loadAdminUsers();
        } catch (e) {
          toggle.checked = !toggle.checked;
          toggle.disabled = false;
          showMsg('权限更新失败 / Failed to update access: ' + e.message, 'error');
        }
      });
      const passwordInput = row.querySelector('.admin-new-password');
      row.querySelector('.admin-set-password').addEventListener('click', async () => {
        if (!passwordInput.value) { showMsg('请先输入新密码 / Enter a new password first.', 'error'); return; }
        const fd = new FormData(); fd.append('password', passwordInput.value);
        try {
          const update = await fetch(`${API_BASE}admin/users/${encodeURIComponent(u.username)}/password`, { method: 'POST', headers: authHeaders(), body: fd });
          const result = await update.json();
          if (!update.ok) throw new Error(result.detail || 'Update failed');
          passwordInput.value = '';
          showMsg(`账号 ${u.username} 的密码已更新 / Password updated for ${u.username}.`, 'ok');
        } catch (e) { showMsg('密码更新失败 / Failed to update password: ' + e.message, 'error'); }
      });
    });
    if (!users.length) tbody.innerHTML = '<tr><td colspan="5" class="na" style="text-align:center;">没有账号 / No accounts</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="na" style="text-align:center;">加载失败 / Failed to load: ${e.message}</td></tr>`;
  }
}
document.getElementById('btn-admin-create').addEventListener('click', async () => {
  const uEl = document.getElementById('f-admin-newuser'), pEl = document.getElementById('f-admin-newpass');
  const msg = document.getElementById('adminCreateMsg');
  const username = uEl.value.trim(), password = pEl.value;
  msg.innerHTML = '';
  if (!username) { msg.innerHTML = '<div class="msg error">请输入用户名 / Username is required</div>'; return; }
  if (!password) { msg.innerHTML = '<div class="msg error">请输入密码 / Password is required</div>'; return; }
  try {
    const fd = new FormData(); fd.append('username', username); fd.append('password', password);
    const resp = await fetch(API_BASE + 'admin/users', { method: 'POST', headers: authHeaders(), body: fd });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.detail || 'Failed');
    msg.innerHTML = `<div class="msg ok">账号 ${body.username} 创建成功 / Account ${body.username} created.</div>`;
    uEl.value = ''; pEl.value = '';
    loadAdminUsers();
  } catch (e) {
    msg.innerHTML = `<div class="msg error">创建失败 / Failed: ${e.message}</div>`;
  }
});

/* ---------------- OPC and AB Scan shared daily ledgers ---------------- */
const opcWeekDate = document.getElementById('opc-week-date');
const opcLedgerBody = document.getElementById('opc-ledger-body');
const opcDepotNames = ['Manchester', 'Birmingham', 'London'];
const opcDepotLabels = ['Manchester', 'Birmingham', 'West London'];
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function mondayOf(value) { const d = new Date(`${value}T00:00:00`); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d; }
function escapeAttr(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function opcRow(day, records = {}) {
  const entries = opcDepotNames.map(depot => records[depot]);
  const original = Object.fromEntries(opcDepotNames.map((depot,i)=>[depot,entries[i] ? (entries[i].status === 'not_operating' ? '不运营' : entries[i].value) : '']));
  return `<tr data-date="${day}" data-original="${escapeAttr(JSON.stringify(original))}"><td><input class="ledger-date" type="date" value="${day}"></td>${entries.map((entry, index) => `<td><input class="opc-value" data-depot="${opcDepotNames[index]}" type="text" inputmode="decimal" placeholder="—" value="${entry ? (entry.status === 'not_operating' ? '不运营' : entry.value) : ''}"></td>`).join('')}<td class="ledger-user">${escapeAttr([...new Set(entries.filter(Boolean).map(x=>x.updated_by))].join(', ') || '—')}</td></tr>`;
}
async function loadOpcWeek() {
  if (!opcWeekDate.value) {
    try {
      const latestResp=await fetch(API_BASE+'opc-daily/latest',{headers:authHeaders()});
      if(!latestResp.ok)return;
      const latest=await latestResp.json();
      opcWeekDate.value=latest.date||isoDate(new Date());
    } catch(e) { return; }
  }
  const monday = mondayOf(opcWeekDate.value), sunday = new Date(monday); sunday.setDate(sunday.getDate()+6);
  const start = isoDate(monday), end = isoDate(sunday);
  document.getElementById('opc-week-label').textContent=`${start} — ${end}`;
  try {
    const resp = await fetch(`${API_BASE}opc-daily?${new URLSearchParams({start,end})}`, {headers:authHeaders()});
    if (!resp.ok) throw new Error('读取失败');
    const {records} = await resp.json(), byDate = {};
    records.forEach(r => { (byDate[r.date] ||= {})[r.depot] = r; });
    opcLedgerBody.innerHTML = Array.from({length:7}, (_,i) => { const d=new Date(`${start}T00:00:00`); d.setDate(d.getDate()+i); const day=isoDate(d); return opcRow(day,byDate[day]||{}); }).join('');
    document.getElementById('opc-ledger-message').innerHTML = `<div class="na">${start} — ${end} · 数据维护人显示最近一次编辑者</div>`;
  } catch(e) { document.getElementById('opc-ledger-message').innerHTML = `<div class="msg error">OPC 历史读取失败：${e.message}</div>`; }
}
opcWeekDate.addEventListener('change', loadOpcWeek);
document.getElementById('opc-week-prev').addEventListener('click',()=>{const d=mondayOf(opcWeekDate.value);d.setDate(d.getDate()-7);opcWeekDate.value=isoDate(d);loadOpcWeek();});
document.getElementById('opc-week-next').addEventListener('click',()=>{const d=mondayOf(opcWeekDate.value);d.setDate(d.getDate()+7);opcWeekDate.value=isoDate(d);loadOpcWeek();});
document.getElementById('opc-add-raw').addEventListener('click',()=>{
  const day=prompt('输入 raw 数据日期 (YYYY-MM-DD)'); if(!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  opcWeekDate.value=day; loadOpcWeek().then(()=>{const row=opcLedgerBody.querySelector(`tr[data-date="${day}"]`);row?.scrollIntoView({behavior:'smooth',block:'center'});row?.querySelector('.opc-value')?.focus();});
});
async function saveOpcWeek(overwrite=false) {
  const rows=[];
  opcLedgerBody.querySelectorAll('tr').forEach(tr=>tr.querySelectorAll('.opc-value').forEach(input=>{
    const value=input.value.trim(), original=JSON.parse(tr.dataset.original||'{}')[input.dataset.depot] ?? '';
    if(value && value !== String(original)) rows.push({date:tr.querySelector('.ledger-date').value,depot:input.dataset.depot,value});
  }));
  if(!rows.length) { document.getElementById('opc-ledger-message').innerHTML='<div class="na">本周没有修改 / No changes this week.</div>'; return; }
  const resp=await fetch(`${API_BASE}opc-daily?overwrite=${overwrite}`,{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({records:rows})});
  const body=await resp.json();
  if(!resp.ok) throw new Error(body.detail||'保存失败');
  if(body.conflict){
    const labels=body.existing.map(r=>`${r.date} / ${r.depot}（维护人 ${r.updated_by||'未知'}）`).join('\n');
    if(await showConfirm('覆盖已有 OPC 数据',`以下日期/仓已有记录：<br><br>${escapeAttr(labels).replace(/\n/g,'<br>')}<br><br>是否用本次数据覆盖？`,'确认覆盖')) return saveOpcWeek(true);
    return;
  }
  document.getElementById('opc-ledger-message').innerHTML=`<div class="msg ok">已保存 ${body.saved} 条 OPC 记录</div>`; await loadOpcWeek();
}
document.getElementById('opc-save-week').addEventListener('click',async()=>{try{await saveOpcWeek();}catch(e){document.getElementById('opc-ledger-message').innerHTML=`<div class="msg error">保存失败：${e.message}</div>`;}});

const abHistoryDate=document.getElementById('ab-history-date'), abHistoryBody=document.getElementById('ab-history-body');
function abHistoryRow(item={}) { const original=JSON.stringify({date_key:item.date_key||'',route_id:item.route_id||'',override_value:item.override_value??'',reason:item.reason||''}); return `<tr data-original="${escapeAttr(original)}" ${item.updated_by?'data-saved="true"':''}><td><input class="ab-h-date" type="date" value="${escapeAttr(item.date_key||abHistoryDate.value||'')}"></td><td><input class="ab-h-route" type="text" value="${escapeAttr(item.route_id||'')}" placeholder="Route ID"></td><td><input class="ab-h-value" type="number" min="0" step="any" value="${escapeAttr(item.override_value??'')}"></td><td><input class="ab-h-reason" type="text" value="${escapeAttr(item.reason||'')}"></td><td class="ledger-user">${escapeAttr(item.updated_by||'新记录')}</td><td><button class="secondary small ab-h-remove" type="button">${item.updated_by?'删除 Delete':'移除 Remove'}</button></td></tr>`; }
async function loadAbHistory(){
  const day=abHistoryDate.value; if(!day)return;
  try{const resp=await fetch(`${API_BASE}ab-scan-history?${new URLSearchParams({start:day,end:day})}`,{headers:authHeaders()});if(!resp.ok)throw new Error('读取失败');const {records}=await resp.json();abHistoryBody.innerHTML=records.map(abHistoryRow).join('');document.getElementById('ab-history-message').innerHTML=`<div class="na">${day} · ${records.length} 条历史差异</div>`;}
  catch(e){document.getElementById('ab-history-message').innerHTML=`<div class="msg error">读取失败：${e.message}</div>`;}
}
document.getElementById('ab-history-load').addEventListener('click',loadAbHistory);
abHistoryDate.addEventListener('change',loadAbHistory);
document.getElementById('ab-history-add').addEventListener('click',()=>abHistoryBody.insertAdjacentHTML('beforeend',abHistoryRow({date_key:abHistoryDate.value})));
abHistoryBody.addEventListener('click',async e=>{if(!e.target.classList.contains('ab-h-remove'))return;const tr=e.target.closest('tr');if(!tr.dataset.saved){tr.remove();return;}const day=tr.querySelector('.ab-h-date').value,route=tr.querySelector('.ab-h-route').value.trim();if(!await showConfirm('删除 AB Scan 记录',`删除 ${escapeAttr(day)} / ${escapeAttr(route)} 的历史记录？`,'删除'))return;try{const resp=await fetch(`${API_BASE}ab-scan-history?${new URLSearchParams({date_key:day,route_id:route})}`,{method:'DELETE',headers:authHeaders()});const body=await resp.json();if(!resp.ok)throw new Error(body.detail||'删除失败');tr.remove();}catch(err){document.getElementById('ab-history-message').innerHTML=`<div class="msg error">删除失败：${err.message}</div>`;}});
async function saveAbHistory(overwrite=false){
  const records=Array.from(abHistoryBody.querySelectorAll('tr')).map(tr=>{const r={date_key:tr.querySelector('.ab-h-date').value,route_id:tr.querySelector('.ab-h-route').value.trim(),override_value:tr.querySelector('.ab-h-value').value,reason:tr.querySelector('.ab-h-reason').value.trim()};const o=JSON.parse(tr.dataset.original||'{}');return {...r,changed:JSON.stringify(r)!==JSON.stringify({date_key:o.date_key||'',route_id:o.route_id||'',override_value:String(o.override_value??''),reason:o.reason||''})};}).filter(r=>r.date_key&&r.route_id&&r.override_value!==''&&r.changed);
  if(!records.length){document.getElementById('ab-history-message').innerHTML='<div class="na">没有新增或修改的数据 / No new or changed records.</div>';return;}
  const resp=await fetch(`${API_BASE}ab-scan-history?overwrite=${overwrite}`,{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({records})});const body=await resp.json();if(!resp.ok)throw new Error(body.detail||'保存失败');
  if(body.conflict){const labels=body.existing.map(r=>`${r.date_key} / ${r.route_id}（维护人 ${r.updated_by||'未知'}）`).join('\n');if(await showConfirm('覆盖已有 AB Scan 数据',`以下日期/路线已有记录：<br><br>${escapeAttr(labels).replace(/\n/g,'<br>')}<br><br>是否覆盖？`,'确认覆盖'))return saveAbHistory(true);return;}
  document.getElementById('ab-history-message').innerHTML=`<div class="msg ok">已保存 ${body.saved} 条，维护人：${escapeAttr(currentUser)}</div>`;await loadAbHistory();
}
document.getElementById('ab-history-save').addEventListener('click',async()=>{try{await saveAbHistory();}catch(e){document.getElementById('ab-history-message').innerHTML=`<div class="msg error">保存失败：${e.message}</div>`;}});

/* ---------------- drag & drop for file inputs ----------------
   The clickable/droppable surface is the whole .filepick-visual card:
   the real <input type=file> is absolutely positioned to cover it
   entirely (opacity:0), so there is no dead zone — clicking or
   dropping anywhere on the card hits the real input directly. */
const FILEPICK_ICON = '<svg class="filepick-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.6 4.6 0 0 1-.6-9.16 5.5 5.5 0 0 1 10.6-2A4.5 4.5 0 0 1 17 18H7z"/><path d="M12 12v6M9.5 14.5 12 12l2.5 2.5"/></svg>';
function filepickHtml(id) {
  return `<div class="filepick">
    <input type="file" id="${id}" accept=".csv" class="filepick-input">
    <div class="filepick-visual">
      ${FILEPICK_ICON}
      <div class="filepick-text"><strong>点击选择或拖拽文件</strong><span>Click to browse, or drag & drop</span></div>
      <div class="filepick-chosen"></div>
    </div>
  </div>`;
}
function enableDropzone(input) {
  const zone = input.closest(".dropzone");
  if (!zone) return;
  const chosenEl = zone.querySelector(".filepick-chosen");
  const markFilled = () => {
    const has = !!(input.files && input.files.length);
    zone.classList.toggle("filled", has);
    if (chosenEl) chosenEl.textContent = has ? `✓ ${input.files[0].name}` : "";
  };
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
DEPOTS.forEach(depot => {
  const key = DEPOT_KEY[depot];
  const cls = DEPOT_CLASS[depot];
  const fg = document.createElement("div");
  fg.className = "filegroup";
  fg.dataset.depot = depot;
  fg.innerHTML = `
    <span class="depot-tag ${cls}">${BI[depot].en} ${BI[depot].cn}</span>
    <div class="field dropzone"><label>日期A / 单日文件 <span class="cn">Date A or single-day file</span></label>${filepickHtml(`f-route-${key}-a`).replace('filepick-input"','filepick-input route-file-a"')}</div>
    <div class="field dropzone route-file-b" style="margin-bottom:0;"><label>日期B文件（对比时上传）<span class="cn">Date B file — only for comparison</span></label>${filepickHtml(`f-route-${key}-b`).replace('filepick-input"','filepick-input route-file-b-input"')}</div>
  `;
  routeGrid.appendChild(fg);
  enableDropzone(fg.querySelector(`#f-route-${key}-a`));
  enableDropzone(fg.querySelector(`#f-route-${key}-b`));

});

/* ---------------- comparison granularity inferred from entered dates ---------------- */
const GRAN_LABEL = { day: { en: "Day vs day", cn: "日对比" }, week: { en: "Week vs week", cn: "周对比" }, month: { en: "Month vs month", cn: "月对比" }, custom: { en: "Custom date range", cn: "自定义对比" } };
let granState = "custom";

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
// range (week/month) labels: "1-7 Sep" when both ends fall in the same
// month, "28 Aug - 3 Sep" when the range crosses a month boundary.
function rangeShortDots(startVal, endVal) {
  const s = parseDateVal(startVal), e = parseDateVal(endVal);
  if (!s || !e) return "";
  return `${s.m}.${s.d}-${e.m}.${e.d}`;
}
function rangeLabel(startVal, endVal) {
  const s = parseDateVal(startVal), e = parseDateVal(endVal);
  if (!s || !e) return "";
  return s.m === e.m ? `${s.d}-${e.d} ${MONTH_ABBR[s.m - 1]}` : `${s.d} ${MONTH_ABBR[s.m - 1]} - ${e.d} ${MONTH_ABBR[e.m - 1]}`;
}

const rangeNameInput = document.getElementById("f-name-range");
const dateAStartInput = document.getElementById("f-date-a-start");
const dateAEndInput = document.getElementById("f-date-a-end");
const dateBStartInput = document.getElementById("f-date-b-start");
const dateBEndInput = document.getElementById("f-date-b-end");
let nameManuallyEdited = false;
rangeNameInput.addEventListener("input", () => { nameManuallyEdited = true; });
function spanDays(start, end) {
  const s = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`);
  return Math.round((e - s) / 86400000) + 1;
}
function fullMonth(start, end) {
  const s = parseDateVal(start), e = parseDateVal(end);
  if (!s || !e || s.d !== 1 || s.y !== e.y || s.m !== e.m) return false;
  return e.d === new Date(Date.UTC(e.y, e.m, 0)).getUTCDate();
}
function inferGranularity(as, ae, bs, be) {
  if (as === ae && bs === be) return "day";
  if (fullMonth(as, ae) && fullMonth(bs, be)) return "month";
  if (spanDays(as, ae) === 7 && spanDays(bs, be) === 7) return "week";
  return "custom";
}
function periodShortLabel(start, end) { return start === end ? shortDots(start) : rangeShortDots(start, end); }
function periodLabel(start, end) { return start === end ? dayMonthLabel(start) : rangeLabel(start, end); }
function regenerateName() {
  const as = dateAStartInput.value, ae = dateAEndInput.value, bs = dateBStartInput.value, be = dateBEndInput.value;
  if (as && ae && bs && be) {
    granState = inferGranularity(as, ae, bs, be);
    if (!nameManuallyEdited) rangeNameInput.value = `${periodShortLabel(as, ae)}对比${periodShortLabel(bs, be)}`;
  } else if (as && ae && !bs && !be && !nameManuallyEdited) {
    rangeNameInput.value = `${periodShortLabel(as, ae)} ${as === ae ? '单日' : '单期'}分析`;
  }
}
function syncPeriod(startInput, endInput, changed) {
  if (changed === startInput && startInput.value && !endInput.value) endInput.value = startInput.value;
  if (changed === endInput && endInput.value && !startInput.value) startInput.value = endInput.value;
  regenerateName();
}
[[dateAStartInput, dateAEndInput], [dateBStartInput, dateBEndInput]].forEach(([start, end]) => {
  start.addEventListener("change", () => syncPeriod(start, end, start));
  end.addEventListener("change", () => syncPeriod(start, end, end));
});


/* ---------------- AB-scan override rows ---------------- */
const abRows = document.getElementById("ab-rows");
function addAbRow(vals = {}, saved = null) {
  const row = document.createElement("div");
  row.className = "ab-row";
  if (saved) {
    row.dataset.saved = "true";
    row.dataset.periodStart = saved.period_start;
    row.dataset.periodEnd = saved.period_end;
    row.dataset.dateKey = vals.date_key;
    row.dataset.routeId = vals.route_id;
  }
  row.innerHTML = `
    <div><label>Route ID</label><input type="text" class="ab-route" value="${vals.route_id || ''}" placeholder="555344334871"></div>
    <div><label>日期</label>
      <select class="ab-date" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;background:var(--paper);color:var(--ink);">
        <option value="a" ${vals.date_key === 'a' ? 'selected' : ''}>A</option>
        <option value="b" ${vals.date_key !== 'a' ? 'selected' : ''}>B</option>
      </select>
    </div>
    <div><label>修正后揽收量 <span class="cn">Override value</span></label><input type="number" class="ab-value" value="${vals.override_value ?? ''}" placeholder="1660"></div>
    <div><label>原因 <span class="cn">Reason</span></label><input type="text" class="ab-reason" value="${vals.reason || ''}" placeholder="44T full trailer..."></div>
    <button type="button" class="secondary small ab-remove">${saved ? '删除已保存 Delete saved' : '删除 Remove'}</button>
  `;
  row.querySelector(".ab-remove").addEventListener("click", async () => {
    if (!row.dataset.saved) { row.remove(); return; }
    const query = new URLSearchParams({ start: row.dataset.periodStart, end: row.dataset.periodEnd,
      date_key: row.dataset.dateKey, route_id: row.dataset.routeId });
    try {
      const resp = await fetch(`${API_BASE}ab-scan-corrections?${query}`, { method: 'DELETE', headers: authHeaders() });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.detail || 'Delete failed');
      row.remove();
    } catch (e) { showMsg('删除已保存修正失败 / Failed to delete saved correction: ' + e.message, 'error'); }
  });
  abRows.appendChild(row);
}
document.getElementById("btn-add-ab").addEventListener("click", () => addAbRow());

async function loadSavedAbCorrections() {
  const requestId = ++savedAbCorrectionRequest;
  const as = dateAStartInput.value, ae = dateAEndInput.value, bs = dateBStartInput.value, be = dateBEndInput.value;
  if (!(as && ae && bs && be && as <= ae && bs <= be) || !currentUser) {
    abRows.querySelectorAll('.ab-row[data-saved="true"]').forEach(row => row.remove());
    return;
  }
  const query = new URLSearchParams({ start_a: as, end_a: ae, start_b: bs, end_b: be });
  try {
    const resp = await fetch(`${API_BASE}ab-scan-corrections?${query}`, { headers: authHeaders() });
    if (!resp.ok || requestId !== savedAbCorrectionRequest) return;
    const saved = await resp.json();
    const manualRows = Array.from(abRows.querySelectorAll('.ab-row')).filter(row => !row.dataset.saved);
    abRows.innerHTML = '';
    manualRows.forEach(row => abRows.appendChild(row));
    for (const [key, period, start, end] of [['a', saved.a, as, ae], ['b', saved.b, bs, be]]) {
      period.forEach(item => addAbRow({ ...item, date_key: key }, { period_start: start, period_end: end }));
    }
  } catch (e) { /* Existing correction records are optional to load. */ }
}
let savedAbCorrectionRequest = 0;
[dateAStartInput, dateAEndInput, dateBStartInput, dateBEndInput].forEach(el => el.addEventListener('change', loadSavedAbCorrections));

function collectAbOverrides() {
  return Array.from(abRows.querySelectorAll(".ab-row")).map(row => ({
    route_id: row.querySelector(".ab-route").value.trim(),
    date_key: row.querySelector(".ab-date").value,
    override_value: row.querySelector(".ab-value").value,
    reason: row.querySelector(".ab-reason").value.trim(),
  })).filter(o => o.route_id && o.override_value !== "");
}

/* ---------------- submit ---------------- */
/* ---------------- submit: 模式根据上传的文件自动判断 ----------------
   - 只有一组文件（A 或 B 其中一列）→ 单日/单期分析
       · 1 个仓 → 单仓单日（后端 analysis_mode=single）
       · 多个仓 → 每个仓各跑一次 single，前端合并成多仓单日看板
   - A、B 两列都有文件 → 对比（单仓或多仓，后端 compare）
   - 日期不必填：从 Route Info CSV 的 Pickup Date 自动识别；
     只选开始日期 = 单日；结束日期留空自动等于开始日期。 */
function csvSplitLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function normDate(v) {
  if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
// 读取 CSV：判断文件类型 + 提取日期范围
async function inspectCsv(file) {
  const text = (await file.text()).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = csvSplitLine(lines[0] || '').map(h => h.toLowerCase());
  const has = n => header.includes(n);
  let kind = 'unknown';
  if (has('route id') && has('pickup date')) kind = 'route';
  else if (has('route_id') && has('cost_in_pounds')) kind = 'billing';
  let min = '', max = '';
  if (kind === 'route') {
    const idx = header.indexOf('pickup date');
    for (let i = 1; i < lines.length; i++) {
      const d = normDate(csvSplitLine(lines[i])[idx]);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }
  return { kind, min, max, name: file.name };
}
function setSubmitError(text) {
  showMsg(text, 'error');
  const status = document.getElementById('submit-status');
  status.innerHTML = `<span style="color:#b03a2e;">${text}</span>`;
}
async function postUpload(fd) {
  const resp = await fetch(API_BASE + "upload", { method: "POST", headers: authHeaders(), body: fd });
  if (resp.status === 401) { showLoginGate(); throw new Error("请先登录 / Please log in"); }
  const raw = await resp.text();
  let body; try { body = JSON.parse(raw); } catch (e) { throw new Error(`服务器返回非 JSON（HTTP ${resp.status}）/ Server error: ${raw.slice(0, 200)}`); }
  if (!resp.ok) throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body));
  return body;
}

document.getElementById("btn-submit").addEventListener("click", async () => {
  const btn = document.getElementById("btn-submit");
  const status = document.getElementById("submit-status");
  status.textContent = "";

  // 1) 收集文件
  const files = { a: {}, b: {} };
  for (const depot of DEPOTS) {
    const key = DEPOT_KEY[depot];
    const fa = document.getElementById(`f-route-${key}-a`).files[0];
    const fb = document.getElementById(`f-route-${key}-b`).files[0];
    if (fa) files.a[depot] = fa;
    if (fb) files.b[depot] = fb;
  }
  let billA = document.getElementById("f-billing-a").files[0];
  let billB = document.getElementById("f-billing-b").files[0];
  const nA = Object.keys(files.a).length, nB = Object.keys(files.b).length;
  if (!nA && !nB) { setSubmitError("请至少上传一个仓的 Route Info 文件 / Upload at least one route-info file"); return; }

  btn.disabled = true; status.textContent = "检查文件… Checking files…";
  try {
    // 2) 检查文件类型并识别日期
    const info = { a: {}, b: {} };
    for (const p of ['a', 'b']) for (const [depot, f] of Object.entries(files[p])) {
      const r = await inspectCsv(f);
      if (r.kind === 'billing') throw new Error(`「${f.name}」是 Billing 文件，却放在了 ${BI[depot].en} 的 Route Info 栏，请放到第 3 步 Billing / This is a billing file, not route info`);
      if (r.kind !== 'route') throw new Error(`「${f.name}」不是 Route Info 文件（缺少 Route ID / Pickup Date 列）/ Not a route-info CSV`);
      info[p][depot] = r;
    }
    for (const [label, f] of [['A', billA], ['B', billB]]) if (f) {
      const r = await inspectCsv(f);
      if (r.kind === 'route') throw new Error(`「${f.name}」是 Route Info 文件，却放在了 Billing ${label} 栏 / This is a route-info file, not billing`);
    }
    const rangeOf = p => {
      const v = Object.values(info[p]).filter(r => r.min);
      if (!v.length) return null;
      return { s: v.map(r => r.min).sort()[0], e: v.map(r => r.max).sort().slice(-1)[0] };
    };
    // 日期：用户填了就用用户的（结束为空 = 单日）；没填就用文件里的 Pickup Date
    const pickDates = (p, sInput, eInput) => {
      let s = sInput.value, e = eInput.value;
      if (s && !e) e = s;
      if (!s && e) s = e;
      if (!s) { const r = rangeOf(p); if (r) { s = r.s; e = r.e; } }
      if (s) { sInput.value = s; eInput.value = e; }
      return [s, e];
    };

    const compare = nA > 0 && nB > 0;
    let as, ae, bs, be;
    if (compare) {
      [as, ae] = pickDates('a', dateAStartInput, dateAEndInput);
      [bs, be] = pickDates('b', dateBStartInput, dateBEndInput);
      if (!as || !bs) throw new Error("无法从文件识别日期，请手动选择日期 A 和 B / Could not detect dates, please pick them");
      if (as > ae || bs > be) throw new Error("起始日期不能晚于结束日期 / Start date must be before end date");
      if (as > bs) { // A 应为较早日期：自动交换
        [files.a, files.b] = [files.b, files.a];
        [as, ae, bs, be] = [bs, be, as, ae];
        [billA, billB] = [billB, billA];
        [info.a, info.b] = [info.b, info.a];
        dateAStartInput.value = as; dateAEndInput.value = ae; dateBStartInput.value = bs; dateBEndInput.value = be;
      }
    } else {
      const p = nA ? 'a' : 'b';
      const [sI, eI] = p === 'a' ? [dateAStartInput, dateAEndInput] : [dateBStartInput, dateBEndInput];
      [as, ae] = pickDates(p, sI, eI);
      if (!as) throw new Error("无法从文件识别日期，请手动选择日期 / Could not detect the date, please pick it");
      if (as > ae) throw new Error("起始日期不能晚于结束日期 / Start date must be before end date");
      bs = as; be = ae;
      if (p === 'b') { files.a = files.b; files.b = {}; billA = billA || billB; }
    }
    // 文件日期与所选日期不重叠时提醒
    for (const [p, s, e] of [['a', as, ae], ['b', bs, be]]) for (const [depot, r] of Object.entries(info[p])) {
      if (r.min && (r.max < s || r.min > e) && !(compare === false && p === 'b' && nA)) {
        throw new Error(`${BI[depot].en} 文件「${r.name}」日期为 ${r.min}~${r.max}，与所选日期 ${s}~${e} 不一致 / File dates don't match the selected dates`);
      }
    }

    const dateA = periodLabel(as, ae), dateB = periodLabel(bs, be);
    const autoName = rangeNameInput.value.trim() && nameManuallyEdited ? rangeNameInput.value.trim() : null;
    status.textContent = "计算中… Processing…";

    if (compare) {
      granState = inferGranularity(as, ae, bs, be);
      const name = autoName || `${periodShortLabel(as, ae)}对比${periodShortLabel(bs, be)}`;
      rangeNameInput.value = name;
      const fd = new FormData();
      fd.append("analysis_mode", "compare"); fd.append("single_depot", "");
      fd.append("name", name);
      fd.append("date_a_label", dateA); fd.append("date_b_label", dateB);
      fd.append("date_a_start", as); fd.append("date_a_end", ae);
      fd.append("date_b_start", bs); fd.append("date_b_end", be);
      fd.append("granularity", granState);
      fd.append("opc_json", "{}");
      fd.append("ab_overrides_json", JSON.stringify(collectAbOverrides()));
      for (const depot of DEPOTS) {
        const key = DEPOT_KEY[depot];
        if (files.a[depot]) fd.append(`route_${key}_a`, files.a[depot]);
        if (files.b[depot]) fd.append(`route_${key}_b`, files.b[depot]);
      }
      if (billA) fd.append("billing_a", billA);
      if (billB) fd.append("billing_b", billB);
      const body = await postUpload(fd);
      renderReport(body.data, { author: body.author, granularity: body.granularity, name: body.name, report_id: body.id });
    } else {
      // 单日/单期：每个仓各跑一次 single
      granState = as === ae ? "day" : "custom";
      const depots = DEPOTS.filter(d => files.a[d]);
      const results = [];
      for (const depot of depots) {
        const key = DEPOT_KEY[depot];
        const name = (autoName ? `${autoName} · ` : '') + `${BI[depot].cn} ${periodShortLabel(as, ae)} ${as === ae ? '单日' : '单期'}分析`;
        const fd = new FormData();
        fd.append("analysis_mode", "single"); fd.append("single_depot", depot);
        fd.append("name", name);
        fd.append("date_a_label", dateA); fd.append("date_b_label", dateB);
        fd.append("date_a_start", as); fd.append("date_a_end", ae);
        fd.append("date_b_start", bs); fd.append("date_b_end", be);
        fd.append("granularity", granState);
        fd.append("opc_json", "{}");
        fd.append("ab_overrides_json", "[]");
        fd.append(`route_${key}_a`, files.a[depot]);
        fd.append(`route_${key}_b`, files.a[depot]);
        if (billA) { fd.append("billing_a", billA); fd.append("billing_b", billA); }
        status.textContent = `计算中 ${results.length + 1}/${depots.length}… Processing ${BI[depot].en}…`;
        const body = await postUpload(fd);
        results.push({ depot, body });
      }
      if (results.length === 1) {
        const { body } = results[0];
        renderReport(body.data, { author: body.author, granularity: body.granularity, name: body.name, report_id: body.id });
      } else {
        renderMultiDepotSingleReport(results, { name: autoName || `${periodShortLabel(as, ae)} 多仓${as === ae ? '单日' : '单期'}分析`, dateLabel: dateA });
      }
    }
    showMsg("看板已生成！Dashboard generated.", "ok");
    status.textContent = "";
    switchView("report");
  } catch (e) {
    setSubmitError("出错了 / Error: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

// 选完 Route Info 文件立刻从 Pickup Date 自动填日期（仅在日期为空时）
DEPOTS.forEach(depot => ['a', 'b'].forEach(p => {
  const input = document.getElementById(`f-route-${DEPOT_KEY[depot]}-${p}`);
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const r = await inspectCsv(f);
      if (r.kind === 'billing') { setSubmitError(`「${f.name}」是 Billing 文件，请放到第 3 步 Billing 栏 / This is a billing file`); return; }
      const [sI, eI] = p === 'a' ? [dateAStartInput, dateAEndInput] : [dateBStartInput, dateBEndInput];
      if (r.min && !sI.value) { sI.value = r.min; eI.value = r.max; regenerateName(); loadSavedAbCorrections(); }
    } catch (e) { /* 提交时会再检查 */ }
  });
}));

// 多仓单日：顶部汇总对比表 + 各仓明细（各仓报告也分别保存在历史里）
function renderMultiDepotSingleReport(results, meta) {
  const sections = results.map(({ depot, body }) => {
    renderSingleDepotReport(body.data, { name: body.name, author: body.author }); // 不传 report_id → 不生成重复的导出面板
    const html = document.getElementById('report-content').innerHTML.replace(/id="warnNote"/g, '');
    return `<div class="panel"><h3>${tagHtml(depot)} 单仓明细 <span class="cn">Depot detail</span></h3>${html}</div>`;
  });
  const rows = results.map(({ depot, body }) => ({ depot, s: body.data.summary?.[depot] || {}, eff: body.data.net?.job_eff21 }));
  const tot = k => rows.reduce((a, r) => a + (Number(r.s[k]) || 0), 0);
  const totAct = tot('act21'), totCost = tot('cost21');
  const tr = (label, s, eff) => `<tr><td style="text-align:left;">${label}</td><td>${fmt(s.routes21)}</td><td>${fmt(s.f21)}</td><td>${fmt(s.act21)}</td><td>${s.f21 ? pct((s.act21 / s.f21 - 1) * 100) : '<span class="na">N/A</span>'}</td><td>${fmt(s.x21)}</td><td>${gbp(s.cost21, 2)}</td><td>${gbp(s.cpp21)}</td><td>${fmt(eff, 1)}</td></tr>`;
  const root = document.getElementById('report-content');
  document.getElementById('report-empty').style.display = 'none';
  root.style.display = 'block';
  root.innerHTML = `<p style="font-size:12px;color:var(--muted);">${meta.name} · ${meta.dateLabel}</p>
    <div class="callout good">多仓单日分析：各仓数据分别计算后汇总，不做跨日期对比。各仓报告已分别保存到历史记录。<span class="cn" style="display:block;">Multi-depot single-day snapshot; each depot is also saved separately in History.</span></div>
    <div class="panel"><h3>各仓汇总 <span class="cn">Depot summary</span></h3><div class="tblwrap"><table><thead><tr><th style="text-align:left;">Depot</th><th>Routes 路线数</th><th>Forecast 预测</th><th>Actual 实际揽收</th><th>偏差 Var%</th><th>Cancelled 取消</th><th>Cost 总成本</th><th>£/parcel 单票成本</th><th>Eff pcs/hr</th></tr></thead><tbody>
    ${rows.map(r => tr(tagHtml(r.depot), r.s, r.eff)).join('')}
    ${tr('<b>合计 Total</b>', { routes21: tot('routes21'), f21: tot('f21'), act21: totAct, x21: tot('x21'), cost21: totCost || null, cpp21: totCost && totAct ? totCost / totAct : null }, null)}
    </tbody></table></div></div>
    ${sections.join('')}`;
}

/* ---------------- history ---------------- */
async function loadHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "加载中… Loading…";
  const resp = await fetch(API_BASE + "reports", { headers: authHeaders() });
  if (resp.status === 401) { showLoginGate(); list.innerHTML = ""; return; }
  const reports = await resp.json();
  if (!reports.length) { list.innerHTML = '<p class="na">还没有保存的报告 / No saved reports yet.</p>'; return; }
  list.innerHTML = "";
  reports.forEach(r => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;";
    const granTag = GRAN_LABEL[r.granularity] ? GRAN_LABEL[r.granularity].cn : "";
    const canDelete = currentUserIsAdmin || r.author === currentUser;
    item.innerHTML = `<div style="cursor:pointer;flex:1;"><div style="font-weight:600;">${r.name}</div><div class="meta">${r.date_a_label} → ${r.date_b_label} · ${granTag} · 作者 ${r.author || 'N/A'} · created ${r.created_at}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="secondary small btn-open" type="button">打开 Open</button>
        ${canDelete ? '<button class="secondary small btn-delete" type="button" style="color:#a33e6b;">删除 Delete</button>' : ''}
      </div>`;
    const openReport = async () => {
      const resp2 = await fetch(`${API_BASE}reports/${r.id}`, { headers: authHeaders() });
      if (resp2.status === 401) { showLoginGate(); return; }
      const full = await resp2.json();
      renderReport(full.data, {
        author: full.author, granularity: full.granularity, name: full.name, report_id: full.id,
      });
      switchView("report");
    };
    item.querySelector("div").addEventListener("click", openReport);
    item.querySelector(".btn-open").addEventListener("click", openReport);
    const delBtn = item.querySelector(".btn-delete");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(
          "删除报告 <span class=\"cn\" style=\"font-weight:400;color:var(--muted);\">Delete report</span>",
          `确定要删除报告「${r.name}」吗？此操作无法撤销。<br><span style="display:block;margin-top:10px;">Delete report "${r.name}"? This cannot be undone.</span>`,
          "删除 Delete"
        );
        if (!ok) return;
        try {
          const dResp = await fetch(`${API_BASE}reports/${r.id}`, { method: "DELETE", headers: authHeaders() });
          if (dResp.status === 401) { showLoginGate(); return; }
          const dBody = await dResp.json().catch(() => ({}));
          if (!dResp.ok) throw new Error(dBody.detail || "Delete failed");
          list.insertAdjacentHTML("afterbegin", '<div class="msg ok">报告已删除 / Report deleted.</div>');
          loadHistory();
        } catch (err) {
          list.insertAdjacentHTML("afterbegin", `<div class="msg error">删除失败 / Delete failed: ${err.message}</div>`);
        }
      });
    }
    list.appendChild(item);
  });
}

/* ============================================================
   NATIVE CHART HELPERS (zero external JS, ported + validated)
   ============================================================ */
function elt(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

/* ---------------- shared chart tooltip ----------------
   One floating tooltip element shared by every chart, positioned next
   to the cursor. attachTooltip(el, htmlOrFn) wires mouseenter/move/leave
   on any chart mark; htmlOrFn can be a fixed HTML string or a function
   (re-evaluated on each hover, for marks whose content doesn't change). */
const chartTooltip = elt('div');
chartTooltip.id = 'chartTooltip';
document.body.appendChild(chartTooltip);
function positionTooltip(evt) {
  const pad = 14;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  const rect = chartTooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  chartTooltip.style.left = x + 'px';
  chartTooltip.style.top = y + 'px';
}
function attachTooltip(el, htmlOrFn) {
  el.addEventListener('mouseenter', e => {
    chartTooltip.innerHTML = typeof htmlOrFn === 'function' ? htmlOrFn() : htmlOrFn;
    chartTooltip.style.opacity = '1';
    positionTooltip(e);
  });
  el.addEventListener('mousemove', positionTooltip);
  el.addEventListener('mouseleave', () => { chartTooltip.style.opacity = '0'; });
}

function renderVBar(container, groups, legendPairs) {
  container.innerHTML = '';
  const max = Math.max(...groups.flatMap(g => [g.a.v, g.b.v])) * 1.18 || 1;
  const wrap = elt('div', 'vbar-wrap');
  groups.forEach(g => {
    const grp = elt('div', 'vbar-grp');
    const pair = elt('div', 'vbar-pair');
    [g.a, g.b].forEach((b, idx) => {
      const bar = elt('div', 'vbar');
      bar.style.height = Math.max(2, (b.v / max * 100)) + '%';
      bar.style.background = b.color;
      bar.style.cursor = 'pointer';
      const valDisplay = b.valText != null ? b.valText : Math.round(b.v).toLocaleString();
      bar.appendChild(elt('div', 'vbar-val', valDisplay));
      const seriesLabel = legendPairs && legendPairs[idx] ? legendPairs[idx].label : (idx === 0 ? 'A' : 'B');
      attachTooltip(bar, `<b>${g.label}</b><br>${seriesLabel}: ${valDisplay}`);
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
  const wrap = elt('div', 'donut-wrap');
  wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:14px;height:100%;';
  // Drawn as an SVG ring (stacked stroke-dasharray arcs) rather than a
  // single conic-gradient div, so each segment is its own hoverable
  // element — a flat gradient div can't offer per-segment feedback.
  const size = 96, strokeW = 17, r = size / 2 - strokeW / 2, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.style.cssText = 'flex-shrink:0;transform:rotate(-90deg);overflow:visible;';
  let acc = 0;
  segments.forEach(s => {
    const frac = s.value / total;
    const len = Math.max(0, frac * circumference - 1.5);
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', s.color);
    circle.setAttribute('stroke-width', strokeW);
    circle.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
    circle.setAttribute('stroke-dashoffset', (-acc).toFixed(2));
    circle.style.cursor = 'pointer';
    attachTooltip(circle, `<b>${s.label}</b>: ${s.value.toLocaleString()} (${(frac * 100).toFixed(1)}%)`);
    svg.appendChild(circle);
    acc += frac * circumference;
  });
  const legend = elt('div'); legend.style.cssText = 'font-size:9.5px;color:var(--ink-soft);display:flex;flex-direction:column;gap:5px;';
  segments.forEach(s => {
    const row = elt('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
    const sw = elt('span'); sw.style.cssText = 'width:8px;height:8px;border-radius:2px;flex-shrink:0;'; sw.style.background = s.color; row.appendChild(sw);
    row.appendChild(document.createTextNode(`${s.label}: ${(s.value / total * 100).toFixed(0)}%`));
    attachTooltip(row, `<b>${s.label}</b>: ${s.value.toLocaleString()} (${(s.value / total * 100).toFixed(1)}%)`);
    legend.appendChild(row);
  });
  wrap.appendChild(svg); wrap.appendChild(legend);
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
    [r.a, r.b].forEach((b, idx) => {
      const bar = elt('div'); bar.style.cssText = 'height:8px;border-radius:2px;position:relative;min-width:2px;cursor:pointer;';
      bar.style.width = Math.max(1, (b.v / max * 78)) + '%';
      bar.style.background = b.color;
      const val = elt('div', null, Math.round(b.v).toLocaleString());
      val.style.cssText = 'position:absolute;left:calc(100% + 5px);top:50%;transform:translateY(-50%);font-size:8px;font-weight:700;color:var(--ink-soft);white-space:nowrap;';
      bar.appendChild(val);
      const seriesLabel = legendPairs && legendPairs[idx] ? legendPairs[idx].label : (idx === 0 ? 'A' : 'B');
      attachTooltip(bar, `<b>${r.label}</b><br>${seriesLabel}: ${Math.round(b.v).toLocaleString()}`);
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
      seg.style.cursor = 'pointer';
      if (w > 7) seg.textContent = showPct ? w.toFixed(0) + '%' : s.val;
      const valText = showPct ? w.toFixed(1) + '%' : s.val.toLocaleString();
      attachTooltip(seg, `<b>${r.label}</b><br>${meta[s.key].label}: ${valText}`);
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
    row.style.cursor = 'pointer';
    attachTooltip(row, it.tooltip || `<b>${it.label}</b>: ${it.valText != null ? it.valText : it.val}`);
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
  // Billing/OPC are optional now, so a £/parcel series can contain
  // null (no billing that period) — filter those out of the scale and
  // skip drawing a mark/label for them rather than plotting NaN.
  const isNum = v => v != null && !Number.isNaN(v);
  const fmtGbp = v => isNum(v) ? '£' + v.toFixed(2) : 'N/A';
  const allVals = series.flatMap(s => s.points).filter(isNum);
  if (!allVals.length) {
    container.innerHTML = '<p class="na" style="text-align:center;padding-top:30%;">暂无数据 No data</p>';
    return;
  }
  const wrap = elt('div', 'mlwrap');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const VBW = 300, VBH = 120;
  svg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = (max - min) || (Math.abs(max) * 0.1) || 1;
  // Extra top/bottom padding vs. the old 100-tall viewBox gives the
  // per-point £ labels and the date labels room to sit inside the box
  // instead of being clipped by the chart edge or the legend below it.
  const padL = 10, padR = 10, padT = 18, padB = 22;
  const plotW = VBW - padL - padR, plotH = VBH - padT - padB;
  const n = xLabels.length;
  const xAt = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = v => padT + plotH - ((v - min) / range) * plotH;

  series.forEach(s => {
    const validIdx = s.points.map((v, i) => i).filter(i => isNum(s.points[i]));
    if (validIdx.length >= 2) {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', validIdx.map((i, k) => (k === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ',' + yAt(s.points[i]).toFixed(1)).join(' '));
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', s.color); path.setAttribute('stroke-width', '2.2');
      svg.appendChild(path);
    }
    validIdx.forEach(i => {
      const x = xAt(i), y = yAt(s.points[i]);
      // Anchor the first/last point's label to start/end (not middle) so
      // it can't run past the chart's left/right edge — this, plus the
      // wider viewBox padding above, is what was clipping dates & prices.
      const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      const dx = i === 0 ? 2.5 : (i === n - 1 ? -2.5 : 0);
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', x.toFixed(1)); circle.setAttribute('cy', y.toFixed(1)); circle.setAttribute('r', '3.6');
      circle.setAttribute('fill', s.color); circle.setAttribute('stroke', 'var(--panel)'); circle.setAttribute('stroke-width', '1.2');
      circle.style.cursor = 'pointer';
      attachTooltip(circle, `<b>${s.label}</b><br>${xLabels[i]}: ${fmtGbp(s.points[i])}`);
      svg.appendChild(circle);
      // Value shown directly on the chart (not just on hover) — the
      // complaint was that prices were only visible by guessing, so the
      // number itself is now always on the page, hover just confirms it.
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', (x + dx).toFixed(1)); text.setAttribute('y', (y - 7).toFixed(1));
      text.setAttribute('font-size', '8.5'); text.setAttribute('text-anchor', anchor);
      text.setAttribute('fill', s.color); text.setAttribute('font-weight', '700');
      text.textContent = fmtGbp(s.points[i]);
      svg.appendChild(text);
    });
  });
  xLabels.forEach((lbl, i) => {
    const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', xAt(i).toFixed(1)); text.setAttribute('y', VBH - 6);
    text.setAttribute('font-size', '8'); text.setAttribute('text-anchor', anchor);
    text.setAttribute('fill', 'currentColor'); text.setAttribute('opacity', '0.65');
    text.textContent = lbl;
    svg.appendChild(text);
  });
  wrap.appendChild(svg);
  const legend = elt('div', 'vbar-legend');
  series.forEach(s => legend.innerHTML += `<span><span class="sw" style="background:${s.color}"></span>${s.label}: ${fmtGbp(s.points[0])}→${fmtGbp(s.points[s.points.length - 1])}</span>`);
  wrap.appendChild(legend);
  container.appendChild(wrap);
}

// A depot counts as "in this report" if it operated at least one of the
// two periods (S[d].active_a || active_b). A depot with zero data across
// BOTH periods (never uploaded, or a depot this network doesn't run at all
// for the date range picked) is dropped from every chart/table entirely,
// rather than showing a row of N/A that just clutters a report that may
// now genuinely be single- or dual-depot. A depot inactive in only ONE of
// the two periods still shows (it's relevant to the comparison) — that
// case is the "未运营 Not operating" badge in the 01 table, unchanged.
function getActiveDepots(D) {
  return DEPOTS.filter(d => D.summary[d] && (D.summary[d].active_a || D.summary[d].active_b));
}

// Plain-language calc/source notes shown on hover over each KPI tile —
// answers "how is this computed" without cluttering the tile itself.
const KPI_CALC = {
  pickup: 'OPC-corrected actual pickup, summed across active depots. Daily workbook values are summed across each selected date range; incomplete coverage falls back to route-level actual pickup. <br>逐日OPC工作簿按日期范围汇总（覆盖不完整时回退到路线级实际揽收）。',
  cpp: 'Network total billed cost ÷ network actual pickup, each period. N/A if no billing was uploaded that period. <br>全网账单总成本 ÷ 全网实际揽收量。该期未上传账单则为N/A。',
  fcstdev: '(Actual − Forecast) / Forecast, network-wide, each period. <br>(实际揽收 − 预测量) / 预测量，全网口径。',
  routes: 'Count of distinct routes across active depots (route-info row count — not "routes with a matched billing cost"). <br>各活跃仓的路线条数之和（按route-info行数计，非"有账单匹配"的路线数）。',
  ppr: 'Network actual pickup ÷ total routes, each period. <br>全网实际揽收量 ÷ 总路线数。',
  jobeff: 'Network Σ(route actual pickup) ÷ Σ(route actual duration in hours) — a pickup-weighted average across every route, not a simple average of per-route rates. <br>全网Σ(路线实际揽收量) ÷ Σ(路线实际时长/小时) —— 按揽收量加权的平均效率，不是逐路线效率的简单平均。',
};

/* ============================================================
   REPORT RENDERING — builds the report from a fetched JSON `D`
   ============================================================ */
function renderReport(D, meta = {}) {
  if (D.analysis_mode === 'single') return renderSingleDepotReport(D, meta);
  document.getElementById("report-empty").style.display = "none";
  const root = document.getElementById("report-content");
  root.style.display = "block";
  root.innerHTML = buildReportSkeleton(D, meta);

  const S = D.summary, NET = D.net, FORECAST = D.forecast;
  const activeDepots = getActiveDepots(D);
  const gapNet14 = pctChange(NET.act14, NET.f14), gapNet21 = pctChange(NET.act21, NET.f21);

  /* ---- KPI row ---- */
  const kpis = [
    { en: 'Network Actual Pickup — ' + D.date_b_label, cn: '全网实际揽收量', val: fmt(NET.act21) + ' pcs', calc: KPI_CALC.pickup },
    { en: '£/Parcel WoW', cn: '单票成本环比', val: gbp(NET.cpp14) + ' → ' + gbp(NET.cpp21), calc: KPI_CALC.cpp },
    { en: 'Forecast Deviation WoW', cn: '预测偏差环比', val: pct(gapNet14) + ' → ' + pct(gapNet21), calc: KPI_CALC.fcstdev },
    { en: 'Total Routes WoW', cn: '总路线数环比', val: NET.routes14 + ' → ' + NET.routes21, calc: KPI_CALC.routes },
    { en: 'Parcels / Route WoW', cn: '单路线产出环比', val: fmt(NET.ppr14) + ' → ' + fmt(NET.ppr21), calc: KPI_CALC.ppr },
    { en: 'Job Efficiency WoW', cn: 'Job效率环比 (pcs/hr)', val: fmt(NET.job_eff14, 1) + ' → ' + fmt(NET.job_eff21, 1), calc: KPI_CALC.jobeff },
  ];
  const kpiRow = document.getElementById('kpiRow');
  kpis.forEach(k => {
    const tile = elt('div', 'kpi', `<div class="lbl">${k.en}<span class="cn">${k.cn}</span></div><div class="val tabular">${k.val}</div>`);
    tile.style.cursor = 'help';
    attachTooltip(tile, `<b>${k.en} 计算方式 / How it's calculated</b><br>${k.calc}`);
    kpiRow.appendChild(tile);
  });

  /* ---- overview mini charts ---- */
  renderVBar(document.getElementById('cOverviewBar'),
    activeDepots.map(d => ({ label: BI[d].en, a: { v: S[d].act14, color: 'var(--line)' }, b: { v: S[d].act21, color: COLOR[d] } })),
    [{ label: D.date_a_label, color: 'var(--line)' }, { label: D.date_b_label, color: 'var(--ink-soft)' }]);
  renderMultiLine(document.getElementById('cOverviewLine'), [{ label: 'Network', color: 'var(--accent)', points: [NET.cpp14, NET.cpp21] }], [D.date_a_label, D.date_b_label]);
  renderDonut(document.getElementById('cOverviewPie'), activeDepots.map(d => ({ label: BI[d].en, color: COLOR[d], value: S[d].routes21 })));

  /* ---- 01 review table ---- */
  const reviewTable = document.getElementById('reviewTable');
  // Data-quality disclosure helpers: an inactive depot/period shows a
  // "not operating" badge instead of implying a genuine zero, and an
  // OPC figure that fell back to route-level actual (no manual OPC
  // entered) is marked so a reader never mistakes it for an OPC-confirmed
  // number — surfaces D.depot_active / S[d].opc_source_a/b from the backend.
  const inactiveBadge = '<span class="badge-inactive">未运营 Not operating</span>';
  const fallbackBadge = (src, label) => src === 'fallback'
    ? `<span class="badge-fallback" title="每日 OPC 数据不完整，已用路线级实际揽收合计代替 / Daily OPC data incomplete — using route-level actual pickup instead">${label}回退 fallback</span>`
    : src === 'daily_workbook' ? `<span class="pos" title="来自逐日 OPC 工作簿 / From daily OPC workbook">${label}Excel OPC</span>` : '';
  activeDepots.forEach(d => {
    const s = S[d];
    const dRoutes = pctChange(s.routes21, s.routes14), dAct = pctChange(s.act21, s.act14), dCpp = pctChange(s.cpp21, s.cpp14);
    const gap14 = pctChange(s.act14, s.f14), gap21 = pctChange(s.act21, s.f21);
    const actCell = (!s.active_a && !s.active_b) ? inactiveBadge :
      `${s.active_a ? fmt(s.act14) : '<span class="badge-inactive">N/A</span>'} → ${s.active_b ? fmt(s.act21) : '<span class="badge-inactive">N/A</span>'}` +
      `${s.active_a ? fallbackBadge(s.opc_source_a, 'A ') : ''}${s.active_b ? fallbackBadge(s.opc_source_b, 'B ') : ''}`;
    reviewTable.innerHTML += `<tr>
      <td style="text-align:left;">${tagHtml(d)}${!s.active_a ? '<span class="badge-inactive" style="margin-left:4px;">A 未运营</span>' : ''}${!s.active_b ? '<span class="badge-inactive" style="margin-left:4px;">B 未运营</span>' : ''}</td>
      <td class="tabular">${s.active_a ? s.routes14 : '<span class="na">N/A</span>'} → ${s.active_b ? s.routes21 : '<span class="na">N/A</span>'}</td>
      <td class="tabular ${dRoutes > 0 ? 'neg' : dRoutes < 0 ? 'pos' : ''}">${pct(dRoutes)}</td>
      <td class="tabular">${s.active_a ? fmt(s.f14) : '<span class="na">N/A</span>'} → ${s.active_b ? fmt(s.f21) : '<span class="na">N/A</span>'}</td>
      <td class="tabular">${actCell}</td>
      <td class="tabular">${pct(gap14)}</td><td class="tabular">${pct(gap21)}</td>
      <td class="tabular ${dAct >= 0 ? 'pos' : 'neg'}">${pct(dAct)}</td>
      <td class="tabular">${gbp(s.cpp14)} → ${gbp(s.cpp21)}</td>
      <td class="tabular ${dCpp <= 0 ? 'pos' : 'neg'}">${pct(dCpp)}</td>
      <td class="tabular">${s.active_a ? s.x14 : '<span class="na">N/A</span>'} → ${s.active_b ? s.x21 : '<span class="na">N/A</span>'}</td>
      <td class="tabular">${s.active_b ? fmt(s.merch_f21) + ' → ' + fmt(s.merch_a21) : '<span class="na">N/A</span>'}</td>
    </tr>`;
  });
  const netDAct = pctChange(NET.act21, NET.act14), netDCpp = pctChange(NET.cpp21, NET.cpp14), netDRoutes = pctChange(NET.routes21, NET.routes14);
  const totCancel14 = activeDepots.reduce((a, d) => a + S[d].x14, 0), totCancel21 = activeDepots.reduce((a, d) => a + S[d].x21, 0);
  reviewTable.innerHTML += `<tr class="totalrow">
    <td style="text-align:left;">Network<span class="cn" style="display:block;">全网</span></td>
    <td class="tabular">${NET.routes14} → ${NET.routes21}</td><td class="tabular neg">${pct(netDRoutes)}</td>
    <td class="tabular">${fmt(NET.f14)} → ${fmt(NET.f21)}</td><td class="tabular">${fmt(NET.act14)} → ${fmt(NET.act21)}</td>
    <td class="tabular">${pct(gapNet14)}</td><td class="tabular">${pct(gapNet21)}</td>
    <td class="tabular pos">${pct(netDAct)}</td>
    <td class="tabular">${gbp(NET.cpp14)} → ${gbp(NET.cpp21)}</td><td class="tabular ${costTrendClass(netDCpp)}">${pct(netDCpp)}</td>
    <td class="tabular">${totCancel14} → ${totCancel21}</td><td><span class="na">—</span></td>
  </tr>`;

  /* ---- 02 forecast ---- */
  renderHGroupedBar(document.getElementById('cForecast'),
    activeDepots.flatMap(d => [
      { label: BI[d].en + ' ' + D.date_a_label, a: { v: FORECAST[d].f14, color: 'var(--line)' }, b: { v: FORECAST[d].a14, color: COLOR[d] } },
      { label: BI[d].en + ' ' + D.date_b_label, a: { v: FORECAST[d].f21, color: 'var(--line)' }, b: { v: FORECAST[d].a21, color: COLOR[d] } },
    ]), [{ label: 'Forecast', color: 'var(--line)' }, { label: 'Actual', color: 'var(--accent)' }]);
  const forecastTable = document.getElementById('forecastTable');
  activeDepots.forEach(d => {
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
    activeDepots.map(d => ({ label: BI[d].en, a: { v: D.cancel_site_a[d] || 0, color: 'var(--line)' }, b: { v: D.cancel_site_b[d] || 0, color: COLOR[d] } })),
    [{ label: D.date_a_label, color: 'var(--line)' }, { label: D.date_b_label, color: 'var(--ink-soft)' }]);
  const merchantTable = document.getElementById('merchantTable');
  if (D.merchants.length === 0) { merchantTable.innerHTML = `<tr><td colspan="6" class="na" style="text-align:center;">没有单日取消≥2次的商家 / none</td></tr>`; }
  D.merchants.forEach(m => { merchantTable.innerHTML += `<tr><td style="text-align:left;">${m.day}</td><td style="text-align:left;">${m.seller}</td><td style="text-align:left;">${tagHtml(m.depot)}</td><td class="tabular neg">${m.n}</td><td class="tabular">${fmt(m.pkgs)}</td><td style="text-align:left;font-size:11px;">${m.primary_reason || '<span class="na">N/A</span>'}</td></tr>`; });

  /* ---- 04 vehicle mix + duration-bucket structure ---- */
  const DURATION_BUCKETS = ["0-2H", "2-4H", "4-6H", "6-8H", "8H+"];
  const vehMeta = {};
  D.vehicle_mix.forEach((v, i) => { vehMeta[v.veh_class] = { label: v.veh_class, color: QUAL_COLORS[i % QUAL_COLORS.length] }; });
  renderStackedHBar(document.getElementById('cVehShare'),
    [{ label: D.date_a_label, segs: D.vehicle_mix.map(v => ({ key: v.veh_class, val: v.route_share_a })) },
    { label: D.date_b_label, segs: D.vehicle_mix.map(v => ({ key: v.veh_class, val: v.route_share_b })) }],
    vehMeta, 100, true);
  renderStackedHBar(document.getElementById('cVehDurShare'),
    [{ label: D.date_a_label, segs: D.vehicle_mix.map(v => ({ key: v.veh_class, val: v.dur_share_a || 0 })) },
    { label: D.date_b_label, segs: D.vehicle_mix.map(v => ({ key: v.veh_class, val: v.dur_share_b || 0 })) }],
    vehMeta, 100, true);

  const vehicleTable = document.getElementById('vehicleTable');
  if (!D.vehicle_mix.length) { vehicleTable.innerHTML = `<tr><td colspan="6" class="na" style="text-align:center;">无车型数据 / no vehicle data</td></tr>`; }
  D.vehicle_mix.forEach(v => {
    const cp = v.cpp_pct;
    vehicleTable.innerHTML += `<tr>
      <td style="text-align:left;"><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${vehMeta[v.veh_class].color};margin-right:6px;"></span>${v.veh_class}</td>
      <td class="tabular">${v.routes_a} → ${v.routes_b}</td>
      <td class="tabular">${v.route_share_a.toFixed(1)}% → ${v.route_share_b.toFixed(1)}%</td>
      <td class="tabular ${v.route_share_pp <= 0 ? 'pos' : 'neg'}">${ppfmt(v.route_share_pp)}</td>
      <td class="tabular">${gbp(v.cpp_a)} → ${gbp(v.cpp_b)}</td>
      <td class="tabular ${cp == null ? '' : (cp <= 0 ? 'pos' : 'neg')}">${cp == null ? '<span class="na">N/A</span>' : pct(cp)}</td>
    </tr>`;
  });

  const bucketMeta = {};
  DURATION_BUCKETS.forEach((b, i) => { bucketMeta[b] = { label: b, color: QUAL_COLORS[i % QUAL_COLORS.length] }; });
  const durGroupKeys = [...activeDepots, 'Network'];
  const durRows = [];
  durGroupKeys.forEach(dep => {
    const db = D.duration_buckets[dep];
    if (!db) return;
    const lbl = dep === 'Network' ? 'Network 全网' : BI[dep].en;
    durRows.push({ label: `${lbl} · ${D.date_a_label}`, segs: db.rows.map(r => ({ key: r.bucket, val: r.share_a })) });
    durRows.push({ label: `${lbl} · ${D.date_b_label}`, segs: db.rows.map(r => ({ key: r.bucket, val: r.share_b })) });
  });
  renderStackedHBar(document.getElementById('cDurBucket'), durRows, bucketMeta, 100, true);

  const durationTable = document.getElementById('durationTable');
  durGroupKeys.forEach(dep => {
    const db = D.duration_buckets[dep];
    if (!db) return;
    const labelHtml = dep === 'Network' ? 'Network<span class="cn" style="display:block;">全网</span>' : tagHtml(dep);
    db.rows.forEach((r, i) => {
      const rcp = r.cpp_pct;
      durationTable.innerHTML += `<tr>
        ${i === 0 ? `<td rowspan="${db.rows.length}" style="text-align:left;vertical-align:top;">${labelHtml}</td>` : ''}
        <td style="text-align:left;"><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${bucketMeta[r.bucket].color};margin-right:6px;"></span>${r.bucket}</td>
        <td class="tabular">${r.n_a} → ${r.n_b}</td>
        <td class="tabular">${r.share_a.toFixed(1)}% → ${r.share_b.toFixed(1)}%</td>
        <td class="tabular">${ppfmt(r.share_pp)}</td>
        <td class="tabular">${gbp(r.cpp_a)} → ${gbp(r.cpp_b)}</td>
        <td class="tabular ${rcp == null ? '' : (rcp <= 0 ? 'pos' : 'neg')}">${rcp == null ? '<span class="na">N/A</span>' : pct(rcp)}</td>
      </tr>`;
    });
  });

  /* ---- 05 cost ----
     Was one 320px box manually split into a bar chart on top of a line
     chart — cramped once there are 3 depots × 2 dates in each. Now each
     gets its own full-height chartbox instead. */
  renderVBar(document.getElementById('cCostPickup'),
    activeDepots.map(d => ({ label: BI[d].en, a: { v: S[d].act14, color: 'var(--line)' }, b: { v: S[d].act21, color: COLOR[d] } })),
    [{ label: D.date_a_label, color: 'var(--line)' }, { label: D.date_b_label, color: 'var(--ink-soft)' }]);
  renderMultiLine(document.getElementById('cCostTrend'),
    activeDepots.map(d => ({ label: BI[d].en, color: COLOR[d], points: [S[d].cpp14, S[d].cpp21] })), [D.date_a_label, D.date_b_label]);

  const netSummaryTable = document.getElementById('netSummaryTable');
  const netRows = [
    ['Total cost / 总成本', gbp(NET.cost14, 2), gbp(NET.cost21, 2), pct(pctChange(NET.cost21, NET.cost14)), costTrendClass(pctChange(NET.cost21, NET.cost14))],
    ['Actual pickup / 实际揽收', fmt(NET.act14), fmt(NET.act21), pct((NET.act21 / NET.act14 - 1) * 100), 'pos'],
    ['£ / parcel / 单票成本', gbp(NET.cpp14), gbp(NET.cpp21), pct(pctChange(NET.cpp21, NET.cpp14)), costTrendClass(pctChange(NET.cpp21, NET.cpp14))],
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
    if (rows.length === 0) { priorityTable.innerHTML = `<tr><td colspan="13" class="na" style="text-align:center;">没有命中阈值的路线 / none flagged</td></tr>`; }
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
        <td class="tabular ${r.fs ? 'neg' : ''}">${fmt(r.scan_eff, 1)}</td>
        <td class="tabular ${r.fd ? 'neg' : ''}">${fmt(r.drive_eff, 1)}</td>
        <td class="tabular ${r.fm ? 'neg' : ''}">${fmt(r.mi_per_stop, 2)}</td>
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

  /* ---- B-scan verification candidates (system-suggested only) ---- */
  const bscanTable = document.getElementById('bscanTable');
  if (!D.bscan_candidates.length) {
    bscanTable.innerHTML = `<tr><td colspan="7" class="na" style="text-align:center;">无符合条件的候选路线 / no candidates matched the B-scan filter</td></tr>`;
  } else {
    D.bscan_candidates.forEach(r => {
      bscanTable.innerHTML += `<tr>
        <td style="text-align:left;" class="tabular">${r.route_id}</td>
        <td style="text-align:left;">${tagHtml(r.depot)}</td>
        <td style="text-align:left;">${r.driver}</td>
        <td class="tabular">${fmt(r.est)}</td>
        <td class="tabular">${fmt(r.act)}</td>
        <td class="tabular neg">-${r.fgap_pct.toFixed(1)}%</td>
        <td class="tabular">${gbp(r.pp)}</td>
      </tr>`;
    });
  }
  if (D.warnings && D.warnings.length) {
    document.getElementById('warnNote').innerHTML = '⚠ ' + D.warnings.join('<br>⚠ ');
    document.getElementById('warnNote').style.display = 'block';
  }

  initInsightsPanel(meta);
}

function renderSingleDepotReport(D, meta = {}) {
  document.getElementById('report-empty').style.display='none';
  const root=document.getElementById('report-content'); root.style.display='block';
  const depot=D.single_depot, summary=D.summary?.[depot]||{}, esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kpis=[
    ['Actual pickup 实际揽收',fmt(summary.act21)],['Forecast 预测量',fmt(summary.f21)],
    ['Routes 路线数',fmt(summary.routes21)],['Total cost 总成本',gbp(summary.cost21,2)],
    ['Cost / parcel 单票成本',gbp(summary.cpp21)],['Completed 完成量',fmt(summary.c21)],
    ['Cancellations 取消数',fmt(summary.x21)],['Efficiency 效率 (pcs/hr)',fmt(D.net?.job_eff21,1)],
  ];
  const rows=(D.single_routes||[]).slice().sort((a,b)=>(b.actual_pickup||0)-(a.actual_pickup||0));
  root.innerHTML=`<p style="font-size:12px;color:var(--muted);">${esc(meta.name||'单仓单日分析')} · ${tagHtml(depot)} · ${esc(D.date_b_label)} · 作者 ${esc(meta.author||'')}</p>
    <div class="callout good">这是单仓单日数据分析快照，不与其他日期或仓库比较。<span class="cn" style="display:block;">Single-depot, single-day snapshot; no cross-date or cross-depot comparison is implied.</span></div>
    <div id="warnNote" class="msg error" style="display:${D.warnings?.length?'block':'none'};">${(D.warnings||[]).map(esc).join('<br>')}</div>
    <div class="kpirow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">${kpis.map(([label,value])=>`<div class="kpi"><div class="lbl">${label}</div><div class="val tabular">${value}</div></div>`).join('')}</div>
    <div class="panel"><h3>路线明细 Route details</h3><div class="tblwrap"><table><thead><tr><th>Route ID</th><th>Driver</th><th>Vehicle</th><th>Forecast</th><th>Actual</th><th>Completed</th><th>Cancelled</th><th>Duration min</th><th>Distance mi</th><th>Cost</th><th>£/parcel</th><th>Scan pcs/hr</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td style="text-align:left;">${esc(r.route_id)}</td><td style="text-align:left;">${esc(r.driver)}</td><td style="text-align:left;">${esc(r.vehicle)}</td><td>${fmt(r.forecast_pickup)}</td><td>${fmt(r.actual_pickup)}</td><td>${fmt(r.completed)}</td><td>${fmt(r.cancelled)}</td><td>${fmt(r.duration_min,1)}</td><td>${fmt(r.distance_miles,1)}</td><td>${gbp(r.cost,2)}</td><td>${gbp(r.cost_per_parcel)}</td><td>${fmt(r.scan_efficiency,1)}</td></tr>`).join(''):'<tr><td class="na" colspan="12" style="text-align:center;">没有路线数据 / No route data</td></tr>'}</tbody></table></div></div>
    <div class="panel"><h3>取消原因 Cancellation reasons</h3><div class="tblwrap"><table><thead><tr><th style="text-align:left;">Reason</th><th>Count</th></tr></thead><tbody>${Object.entries(D.reasons_b||{}).length?Object.entries(D.reasons_b).sort((a,b)=>b[1]-a[1]).map(([reason,count])=>`<tr><td style="text-align:left;">${esc(reason)}</td><td>${fmt(count)}</td></tr>`).join(''):'<tr><td colspan="2" class="na" style="text-align:center;">无取消记录 / No cancellations</td></tr>'}</tbody></table></div></div>
    ${meta.report_id&& (currentUserIsAdmin||currentUserAiAllowed)?`<div class="panel insights-panel" id="insightsPanel"><h3>导出数据给 AI 分析 <span class="cn">Export data for analysis in your own AI chat</span></h3><div class="insights-controls"><button class="primary" id="btn-export-insights" type="button">导出数据给 AI 分析</button><button class="secondary" id="btn-copy-insights" type="button" style="display:none;">复制 Copy</button><button class="secondary" id="btn-download-insights" type="button" style="display:none;">下载 .txt</button><span id="insightsStatus" class="insights-status"></span></div><div id="insightsOutput" class="insights-output"></div></div>`:''}`;
  if(meta.report_id&&(currentUserIsAdmin||currentUserAiAllowed)) initInsightsPanel(meta);
}

/* ============================================================
   AI EXPORT — this app never calls any AI service itself. Instead it
   fetches a paste-ready text block (house methodology + this report's
   distilled data) from /api/reports/{id}/insights/export, and lets the
   user copy it or download it as a .txt file to paste into their own
   AI chat (claude.ai, ChatGPT, etc.) using their own subscription.
   ============================================================ */

async function initInsightsPanel(meta) {
  const panel = document.getElementById('insightsPanel');
  if (!panel) return;
  if (!meta.report_id || (!currentUserIsAdmin && !currentUserAiAllowed)) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const btn = document.getElementById('btn-export-insights');
  const copyBtn = document.getElementById('btn-copy-insights');
  const downloadBtn = document.getElementById('btn-download-insights');
  const status = document.getElementById('insightsStatus');
  const out = document.getElementById('insightsOutput');

  copyBtn.style.display = 'none';
  downloadBtn.style.display = 'none';
  out.innerHTML = '<p class="na">网站负责整理指标和展示看板，不会在站内生成 AI 叙述分析。点击下方导出方法论和精简数据，再粘贴到你自己的 AI 对话中进行分析。<span style="display:block;">This site organizes metrics into a dashboard; it does not generate AI narrative analysis. Export the methodology and compact data below, then paste them into your own AI chat for analysis.</span></p>';
  status.textContent = '';

  let exportText = '';

  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = '生成中… Generating…';
    try {
      const resp = await fetch(`${API_BASE}reports/${meta.report_id}/insights/export`, { headers: authHeaders() });
      if (resp.status === 401) { showLoginGate(); throw new Error('请先登录 / Please log in'); }
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.detail || 'Export failed');
      exportText = body.text || '';
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      out.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;line-height:1.6;margin:0;">${esc(exportText)}</pre>`;
      status.textContent = '已生成 Generated — 复制下方文本粘贴到AI对话中 / copy the text below into your AI chat';
      copyBtn.style.display = 'inline-block';
      downloadBtn.style.display = 'inline-block';
    } catch (e) {
      status.textContent = '';
      out.innerHTML = `<div class="msg error">生成失败 / Failed: ${e.message}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      status.textContent = '已复制到剪贴板 Copied to clipboard';
    } catch (e) {
      status.textContent = '复制失败，请手动选择文本复制 / Copy failed — please select and copy the text manually';
    }
  };

  downloadBtn.onclick = () => {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(meta.name || 'report').replace(/[^\w\-.一-龥]+/g, '_')}_ai_export.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
}

function buildReportSkeleton(D, meta = {}) {
  const granInfo = GRAN_LABEL[meta.granularity] || null;
  // Depot-scope note for the top panel: names which depots are actually
  // covered — when one is missing data across BOTH periods this report is
  // effectively a dual-/single-depot analysis, not "all 3 depots", and the
  // rest of the report (charts/tables) only shows those active depots.
  const activeD = getActiveDepots(D);
  const excludedD = DEPOTS.filter(d => !activeD.includes(d));
  const depotWord = activeD.length === DEPOTS.length ? 'all 3 depots' : `${activeD.length} of ${DEPOTS.length} depots (${activeD.map(d => BI[d].en).join(', ')})`;
  const depotWordCn = activeD.length === DEPOTS.length ? '全部3个仓' : `${activeD.length}/${DEPOTS.length}个仓（${activeD.map(d => BI[d].cn).join('、')}）`;
  const depotScopeNote = {
    en: depotWord + (excludedD.length ? ` — ${excludedD.map(d => BI[d].en).join(', ')} excluded, no data either period` : ''),
    cn: depotWordCn + (excludedD.length ? `——${excludedD.map(d => BI[d].cn).join('、')}两期均无数据，已排除。` : '。'),
  };
  const metaLine = (meta.author || granInfo) ? `
  <p style="font-size:11.5px;color:var(--muted);margin:0 0 16px;display:flex;flex-wrap:wrap;gap:14px;">
    ${meta.name ? `<span>${meta.name}</span>` : ''}
    ${granInfo ? `<span>${granInfo.en}<span class="cn"> · ${granInfo.cn}</span></span>` : ''}
    ${meta.author ? `<span>Author / 作者: <b style="color:var(--ink-soft);">${meta.author}</b></span>` : ''}
  </p>` : '';
  return `
  ${metaLine}
  <div class="panel insights-panel" id="insightsPanel" style="display:none;">
    <h3>导出数据给 AI 分析 <span class="cn">网站提供指标看板；导出方法论和精简数据，交给你自己的 AI 分析 / Export the method and compact data for analysis in your own AI chat</span></h3>
    <div class="insights-controls">
      <button class="primary" id="btn-export-insights" type="button">导出数据给 AI 分析 Export data for AI analysis</button>
      <button class="secondary" id="btn-copy-insights" type="button" style="display:none;">复制 Copy</button>
      <button class="secondary" id="btn-download-insights" type="button" style="display:none;">下载.txt Download .txt</button>
      <span id="insightsStatus" class="insights-status"></span>
    </div>
    <div id="insightsOutput" class="insights-output"><p class="na">网站负责整理指标和展示看板，不会在站内生成 AI 叙述分析。点击下方导出方法论和精简数据，再粘贴到你自己的 AI 对话中进行分析。<span style="display:block;">This site organizes metrics into a dashboard; it does not generate AI narrative analysis. Export the methodology and compact data below, then paste them into your own AI chat for analysis.</span></p></div>
  </div>

  <div class="kpirow" id="kpiRow"></div>
  <div id="warnNote" class="msg error" style="display:none;"></div>

  <div class="panel">
    <p style="margin:0 0 10px;">Data: ${D.date_a_label} → ${D.date_b_label}, ${depotScopeNote.en}. Route-level "actual" uses each system's own Actual Total Pickup (AB-scan overrides applied where entered); depot/network headline actual uses OPC.
    <span class="cn" style="display:block;margin-top:4px;color:var(--muted);">${depotScopeNote.cn}路线级"实际揽收"使用各系统自身记录（已应用输入的AB scan修正）；仓/全网头部KPI使用OPC修正值。</span></p>
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
      <table><thead><tr><th style="text-align:left;">Day</th><th style="text-align:left;">Seller</th><th style="text-align:left;">Depot</th><th>Cancellations</th><th>Est. parcels</th><th style="text-align:left;">Primary reason<span class="cn">主要取消原因</span></th></tr></thead><tbody id="merchantTable"></tbody></table>
    </div>
  </div>

  <div class="panel">
    <h3>04 · Route Structure — Vehicle &amp; Duration<span class="cn">路线分析：车型与时长结构</span></h3>
    <p style="margin:0 0 10px;font-size:12px;color:var(--muted);">4.1 Vehicle mix change — route-count share and duration share, both dates. <span class="cn" style="display:block;">车型占比变化 — 路线数占比 与 时长占比，两个日期对比。</span></p>
    <div class="grid2">
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">Route-count share by vehicle class<span class="cn" style="display:block;color:var(--muted);font-weight:400;">按车型的路线数占比</span></h4><div class="chartbox tall"><div id="cVehShare" style="height:100%;"></div></div></div>
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">Duration share by vehicle class<span class="cn" style="display:block;color:var(--muted);font-weight:400;">按车型的时长占比</span></h4><div class="chartbox tall"><div id="cVehDurShare" style="height:100%;"></div></div></div>
    </div>
    <div class="tblwrap" style="margin-top:14px;">
      <h4 style="font-size:12.5px;margin:0 0 8px;">4.2 Vehicle detail<span class="cn" style="display:block;color:var(--muted);font-weight:400;">车型明细</span></h4>
      <table><thead><tr>
        <th style="text-align:left;">Vehicle class<span class="cn">车型</span></th>
        <th>Routes A→B<span class="cn">路线数</span></th>
        <th>Route share A→B<span class="cn">路线占比</span></th>
        <th>Δ share<span class="cn">占比变化</span></th>
        <th>£/parcel A→B<span class="cn">单票成本</span></th>
        <th>Δ £/parcel<span class="cn">单票环比</span></th>
      </tr></thead><tbody id="vehicleTable"></tbody></table>
    </div>

    <h4 style="font-size:12.5px;margin:20px 0 8px;">4.3 Duration-bucket structure by depot<span class="cn" style="display:block;color:var(--muted);font-weight:400;">各仓路线时长区间分布</span></h4>
    <div class="chartbox xtall"><div id="cDurBucket" style="height:100%;"></div></div>
    <div class="tblwrap" style="margin-top:14px;">
      <table><thead><tr>
        <th style="text-align:left;">Depot<span class="cn">仓</span></th>
        <th style="text-align:left;">Bucket<span class="cn">时长区间</span></th>
        <th>Routes A→B<span class="cn">路线数</span></th>
        <th>Share A→B<span class="cn">占比</span></th>
        <th>Δ share<span class="cn">占比变化</span></th>
        <th>£/parcel A→B<span class="cn">单票成本</span></th>
        <th>Δ £/parcel<span class="cn">单票环比</span></th>
      </tr></thead><tbody id="durationTable"></tbody></table>
    </div>
  </div>

  <div class="panel">
    <h3>05 · Cost Analysis<span class="cn">成本分析</span></h3>
    <div class="grid3">
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">Actual pickup by depot<span class="cn" style="display:block;color:var(--muted);font-weight:400;">各仓实际揽收量</span></h4><div class="chartbox tall"><div id="cCostPickup" style="height:100%;"></div></div></div>
      <div><h4 style="font-size:12.5px;margin:0 0 8px;">£/parcel trend by depot<span class="cn" style="display:block;color:var(--muted);font-weight:400;">各仓单票成本趋势</span></h4><div class="chartbox tall"><div id="cCostTrend" style="height:100%;"></div></div></div>
      <div class="tblwrap"><h4 style="font-size:12.5px;margin:0 0 8px;">Network summary<span class="cn" style="display:block;color:var(--muted);font-weight:400;">全网汇总</span></h4><table><thead><tr><th style="text-align:left;">Metric</th><th>A</th><th>B</th><th>WoW</th></tr></thead><tbody id="netSummaryTable"></tbody></table></div>
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
        <th data-key="scan_eff" data-type="number">Scan eff. (pcs/hr)<span class="sortarrow"></span></th>
        <th data-key="drive_eff" data-type="number">Drive eff. (mph)<span class="sortarrow"></span></th>
        <th data-key="mi_per_stop" data-type="number">Mi/stop<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="hitcount" data-type="number">Hit dim.<span class="sortarrow"></span></th>
        <th style="text-align:left;" data-key="repeat" data-type="string">Repeat<span class="sortarrow"></span></th>
      </tr></thead><tbody id="priorityTable"></tbody></table>
    </div>

    <h4 style="font-size:12.5px;margin:20px 0 8px;">B-scan verification candidates (date B) — system-suggested, not auto-applied<span class="cn" style="display:block;color:var(--muted);font-weight:400;">B scan差异修正候选路线（较晚日期）— 系统提示，不自动生效</span></h4>
    <p style="font-size:11px;color:var(--muted);margin:0 0 10px;">Filter: £/parcel ≥ £1.00 AND (forecast−actual)/forecast ≥ 40% AND Bulkout = Yes. <span class="cn" style="display:block;">筛选条件：单票成本≥£1.00 且 (预测-实际)/预测≥40% 且 Bulkout=Yes。</span></p>
    <div class="tblwrap">
      <table><thead><tr>
        <th style="text-align:left;">Route ID<span class="cn">路线ID</span></th>
        <th style="text-align:left;">Depot<span class="cn">仓</span></th>
        <th style="text-align:left;">Driver<span class="cn">司机</span></th>
        <th>Forecast<span class="cn">预测量</span></th>
        <th>Actual<span class="cn">实际揽收</span></th>
        <th>Gap<span class="cn">偏差</span></th>
        <th>£/parcel<span class="cn">单票成本</span></th>
      </tr></thead><tbody id="bscanTable"></tbody></table>
    </div>

    <h4 style="font-size:12.5px;margin:20px 0 8px;">AB-scan corrections applied<span class="cn" style="display:block;color:var(--muted);font-weight:400;">已应用的AB scan修正</span></h4>
    <p id="abScanNote" style="font-size:12px;"></p>
  </div>
  `;
}
