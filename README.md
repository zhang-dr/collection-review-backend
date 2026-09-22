# Collection Network Review 揽收网络复盘工具

Upload the per-depot route-info CSVs, the network billing CSVs, OPC-corrected
totals, and any AB-scan overrides — the app recomputes the same weekly
diagnostic that was previously built by hand, and keeps a history of every
report generated.

Core v1 scope: overall review table, forecast-vs-actual, cancellation
analysis, and cost analysis (£/parcel + priority routes for review). Vehicle
mix (§04 in the manual report series) is not in this version.

## What's inside

```
backend/
  app/
    main.py       FastAPI app: /api/upload, /api/reports, /api/reports/{id}
    pipeline.py    All the business logic (OPC/AB-scan handling, cost calcs,
                   forecast deviation, cancellation analysis, percentile-based
                   priority-route flagging, repeat-driver detection)
    db.py          SQLite persistence (data/reports.db)
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

## Before you expose this publicly: add access control

**The app has no login of its own.** Anyone who can reach the URL can upload
data and read every saved report — fine on `localhost` during UAT, not fine
once it's on a public domain, since this handles route-level commercial data
(costs, driver names, merchant names). Before putting it on your domain,
add access control at the reverse-proxy layer, e.g. nginx HTTP basic auth:

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
