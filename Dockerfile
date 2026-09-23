FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# SQLite data lives here — mount a volume at /app/data to persist it
# across container restarts/rebuilds (see docker-compose.yml).
RUN mkdir -p /app/data

EXPOSE 8811

# Most PaaS platforms (Railway, Render, ...) assign a random port via the
# $PORT env var and route traffic to it; fall back to 8811 for plain
# `docker run` / docker-compose where $PORT isn't set.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8811}"]
