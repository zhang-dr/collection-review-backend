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
as OPC-confirmed). There's also an optional AI-generated narrative — see
"AI-generated insights" below.

## What's inside

```
backend/
  app/
    main.py       FastAPI app: /api/upload, /api/reports, /api/reports/{id},
                   /api/auth/*, /api/insights/providers,
                   /api/reports/{id}/insights
    pipeline.py    All the business logic (OPC/AB-scan handling, cost calcs,
                   forecast deviation, cancellation analysis, percentile-based
                   priority-route flagging, repeat-driver detection)
    auth.py        Password login with administrator-only account creation
    db.py          SQLite persistence (data/reports.db)
    insights.py    Optional AI-generated narrative — the only part of the
                   app that calls a third-party service (Claude / Gemini /
                   ChatGPT), and only when a user clicks "Generate insights"
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

## AI-generated insights (optional)

The report has an "AI 洞察 / AI-generated insights" panel that turns the
computed numbers into a McKinsey-style narrative — headline-as-conclusion,
bilingual, fact-based bullets citing the actual figures — instead of just
charts and tables. It's entirely optional and strictly opt-in: nothing is
sent anywhere until a user clicks "Generate insights" on a specific report,
and the result is cached (`reports.insights` in the DB) so re-opening that
report later doesn't spend another API call.

Three providers are supported so you aren't locked into one vendor — pick
whichever you already have an API key for. Each is enabled independently by
setting its API-key environment variable on the server (Railway → your
service → Variables, or the equivalent on whatever platform you used above);
a provider with no key set simply shows as "未配置 / not configured" in the
dropdown and can't be selected.

| Provider | API key env var | Model env var (optional) | Default model |
|---|---|---|---|
| Claude (Anthropic) | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | `claude-sonnet-4-5` |
| Gemini (Google) | `GEMINI_API_KEY` | `GEMINI_MODEL` | `gemini-2.5-flash` |
| ChatGPT (OpenAI) | `OPENAI_API_KEY` | `OPENAI_MODEL` | `gpt-4o-mini` |

You only need to set the key(s) for the provider(s) you actually want
available — setting none just hides/disables the feature (the button still
works, it returns a clear "not configured" error). Optionally set
`AI_PROVIDER` (`claude` / `gemini` / `openai`) to change which provider is
pre-selected in the dropdown; it defaults to `claude`.

These are the only environment variables this app ever reads a secret from,
and it never stores the key itself anywhere — each request reads it fresh
from the environment and calls the provider's API directly over HTTPS
(stdlib `urllib`, no extra pip dependency).

## Before you expose this publicly: add access control

Only accounts created by the configured administrator can log in. Authenticated
users can upload data and read every saved report; report access is shared,
not isolated per user. The built-in login is suitable for a trusted team but
is not a complete enterprise identity system, so consider stronger controls
once route-level commercial data (costs, driver names, merchant names) is on
a public domain. Before putting it on your domain, also add access control
at the reverse-proxy layer, e.g. nginx HTTP basic auth:

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
