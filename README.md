# Collection Network Review 揽收网络复盘工具

Upload the per-depot route-info CSVs, the network billing CSVs, OPC-corrected
totals, and any AB-scan overrides — the app recomputes the same weekly
diagnostic that was previously built by hand, and keeps a history of every
report generated.

Scope: overall review table, forecast-vs-actual, cancellation analysis,
vehicle/duration structure (§04), and cost analysis (£/parcel + priority
routes for review, with B-scan verification candidates). Route-info and
billing uploads are optional per depot/date — a depot that didn't operate a
given period is simply left blank and the report treats it as "not
operating" rather than erroring. OPC-corrected actual pickup is optional
too: leave it blank and the report falls back to that depot's route-level
actual pickup total (flagged in the UI as a "fallback", not silently shown
as OPC-confirmed). There's also a one-click "export for AI analysis" button
that packages the report's data for pasting into your own AI chat — see
"Export for AI analysis" below.

## What's inside

```
backend/
  app/
    main.py       FastAPI app: /api/upload, /api/reports, /api/reports/{id},
                   /api/auth/*, /api/reports/{id}/insights/export
    pipeline.py    All the business logic (OPC/AB-scan handling, cost calcs,
                   forecast deviation, cancellation analysis, percentile-based
                   priority-route flagging, repeat-driver detection)
    auth.py        Lightweight username(+optional password) login
    db.py          SQLite persistence (data/reports.db)
    insights.py    Builds the paste-ready "export for AI analysis" text
                   (methodology + distilled report data). This app never
                   calls any third-party AI service itself.
    static/        Frontend — plain HTML/CSS/JS, zero build step, zero
                   external dependencies (all charts are native CSS/inline SVG)
  requirements.txt
  Dockerfile
  docker-compose.yml
```

There is no build step and no JS framework — `static/app.js` is loaded
directly by the browser, and it renders the report from whatever JSON
`/api/upload` or `/api/reports/{id}` returns.

## Run it locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8811
```

Open `http://localhost:8811/`. Report history is stored in
`backend/data/reports.db` (created automatically on first run).

## Run it with Docker

```bash
cd backend
docker compose up -d --build
```

This builds the image, starts the container on port 8811, and persists
`data/reports.db` to `./data` on the host so history survives rebuilds.

## Deploying to your own domain

This is a plain FastAPI/uvicorn app, so it deploys the same way as any other
Python web service. Two common patterns — pick whichever matches how you
already host things:

### Option A — Docker + reverse proxy (recommended if you're not sure)

1. Copy the `backend/` folder to your server.
2. `docker compose up -d --build` (as above) — the app now listens on
   `127.0.0.1:8811` on that machine.
3. Put a reverse proxy in front of it for your domain + TLS. With nginx:

   ```nginx
   server {
       listen 443 ssl;
       server_name review.yourdomain.com;

       ssl_certificate     /etc/letsencrypt/live/review.yourdomain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/review.yourdomain.com/privkey.pem;

       client_max_body_size 50m;  # route-info/billing CSVs can be sizeable

       location / {
           proxy_pass http://127.0.0.1:8811;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_connect_timeout 120s;
           proxy_send_timeout 120s;
           proxy_read_timeout 120s;
       }
   }
   ```

   Get a certificate with `certbot --nginx -d review.yourdomain.com` (or
   however you already manage TLS for your domain).

### Option B — systemd service, no Docker

1. Copy `backend/` to the server, create a venv, `pip install -r requirements.txt`.
2. Create `/etc/systemd/system/collection-review.service`:

   ```ini
   [Unit]
   Description=Collection Network Review
   After=network.target

   [Service]
   WorkingDirectory=/opt/collection-review-app/backend
   ExecStart=/opt/collection-review-app/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8811
   Restart=on-failure
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

3. `systemctl enable --now collection-review`, then put the same nginx block
   from Option A in front of it.

Either way, the app itself should only listen on `127.0.0.1` — let the
reverse proxy be the one thing exposed to the internet, so it can also
handle TLS and (see below) access control.

### Deploying under a subpath (e.g. `yourdomain.com/CBTAnalysis`)

The frontend computes its own API base URL from wherever `app.js` was
actually loaded from (see `API_BASE` at the top of `static/app.js`), so
nothing in the app needs to change for this — it works identically at the
domain root or under any subpath. All that's needed is an nginx `location`
block that strips the prefix before forwarding to uvicorn (note the
trailing slash on both the location and the `proxy_pass` target — that's
what does the stripping):

```nginx
location = /CBTAnalysis { return 301 /CBTAnalysis/; }  # normalize the no-trailing-slash case

location /CBTAnalysis/ {
    proxy_pass http://127.0.0.1:8811/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 50m;
    proxy_connect_timeout 120s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
}
```

This can live inside the same `server { }` block as the rest of
`yourdomain.com`, alongside whatever else that domain already serves.

### Option C — Railway / Render / Fly.io + a Netlify rewrite

If your domain's main site is static and served by **Netlify** (with GitHub
as the source repo, Cloudflare for DNS), you don't have an nginx server to
edit — but you also don't need one. Netlify can transparently proxy one path
to an external service while everything else keeps being served as before.

1. Push `backend/` to its own GitHub repo (or a folder in an existing one).
2. Create an account on a platform that runs a persistent Docker container
   from a GitHub repo — **Railway** and **Render** are the simplest,
   **Fly.io** is the cheapest per-resource. None currently have a truly free
   always-on tier with persistent disk; budget roughly $3–10/month depending
   on the platform. All three auto-detect the `Dockerfile` in this repo.
3. Connect the repo, and **add a persistent volume mounted at `/app/data`**
   — this is where `reports.db` lives; without a persistent volume, report
   history resets on every redeploy/restart.
4. Deploy. The platform assigns a public URL (e.g.
   `https://your-app.up.railway.app`) and a `$PORT` env var — the
   `Dockerfile`'s `CMD` already reads `$PORT` if it's set, so no changes
   needed there.
5. In the GitHub repo that Netlify deploys `zhangxihao.com` from, add a
   rewrite rule (in `netlify.toml`, or a `_redirects` file at the site's
   publish root) so `/CBTAnalysis/*` proxies to that backend URL:

   ```toml
   [[redirects]]
     from = "/CBTAnalysis/*"
     to = "https://your-app.up.railway.app/:splat"
     status = 200
     force = true
   ```

   `status = 200` makes this a transparent proxy (the browser still shows
   `zhangxihao.com/CBTAnalysis/...`), not a redirect that would navigate
   away to the platform's own domain.
6. Cloudflare needs no changes if it's only doing DNS for `zhangxihao.com`
   pointing at Netlify. If it's proxying (orange-clouded), that's fine too —
   it just passes the already-proxied response through.

The app's own path-detection (`API_BASE` in `app.js`) and the `$PORT`
handling in the `Dockerfile` mean nothing in the app itself needs to change
for this path — only the platform account and the Netlify rewrite rule.

## Export for AI analysis

The report has a "导出给AI分析 / Export for AI analysis" panel. Clicking the
button doesn't call any AI service — this app never does. Instead it builds
a single paste-ready text block combining the house methodology (Data →
Insight → So what → Now what, bilingual, headline-as-conclusion) with a
distilled version of that report's computed data, via
`GET /api/reports/{id}/insights/export`. You copy that text (or download it
as a `.txt` file) and paste it into your own AI chat — claude.ai, ChatGPT,
or whatever you already have a subscription to — and it generates the
narrative there, using your own account.

This is deliberately simpler than calling a provider's API from the server:
no API key to manage, no per-provider cost or rate limit to track, and no
server-side timeout to work around (an earlier version of this app called
providers' APIs directly and had to work around proxy timeouts like
Netlify's 26-second limit — none of that applies once generation happens in
your own AI chat instead of on this server). `app/insights.py` only builds
the text; it makes no network calls itself.

## Accounts: admin-gated, with author-based delete permission

Login is no longer self-service. The hardcoded admin username (`Xihao`, set
in `app/auth.py`'s `ADMIN_USERNAME`) is the only account that can create new
accounts — it bootstraps itself on its first-ever login (there'd otherwise
be no way to create the first account), and every other username must be
created by the admin from the "管理 Admin" tab (visible only when logged in
as the admin). The admin account always has admin rights regardless of
what's in the database — that's enforced in code (`auth.is_admin`), not just
a default value, so it can't accidentally be revoked by editing the DB.

Anyone who can log in can upload data and read every saved report. Deleting
a report is restricted by authorship: the admin can delete any report from
the "历史报告 / History" tab, while any other account can only delete
reports it created itself (enforced server-side in `api_delete_report` in
`app/main.py`, not just hidden in the UI — a non-owner's delete request gets
a 403). This is still not a full permissions/roles system and not a real
security boundary against someone who can already reach the URL. Before
putting this on a public domain, also add access control at the
reverse-proxy layer, e.g. nginx HTTP basic auth:

```nginx
location / {
    auth_basic "Collection Network Review";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:8811;
    ...
}
```

(`htpasswd -c /etc/nginx/.htpasswd yourusername`) — or your reverse proxy /
hosting platform's equivalent (Cloudflare Access, an IP allowlist, etc.), or
put it behind whatever VPN/SSO your team already uses.

## Data & backups

All report history lives in one SQLite file: `backend/data/reports.db`.
Back it up like any other file — there's no external database to configure.
Uploaded CSVs themselves are not retained; only the computed report JSON is
stored.

## Extending it

- `pipeline.py`'s `compute_report()` is the single place all business logic
  lives — the OPC-vs-route-level-actual methodology, AB-scan override
  application, percentile-based priority-route flagging (bottom 20% scan
  efficiency, bottom 20% driving efficiency, top 20% mileage/stop), and
  repeat-driver detection are all there, matching the manual weekly report
  exactly.
- Adding the vehicle-mix section (§04) later: add its computation to
  `compute_report()`'s return dict, then port the corresponding chart/table
  render functions from the manual `report.html` into `static/app.js`
  (the stacked-bar and grouped-bar renderers are already there and reusable).
