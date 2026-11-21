FROM node:22-bookworm-slim AS node-runtime
FROM python:3.12-slim-bookworm
WORKDIR /app
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN groupadd --system egx && useradd --system --gid egx --home /app egx \
 && pip install --no-cache-dir pymupdf==1.26.5 tzdata \
 && mkdir -p /data && chown egx:egx /data
COPY --chown=egx:egx . /app/
USER egx
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 EGX_DATA_DIR=/data
EXPOSE 8787
CMD ["python", "ingest_service.py", "--host", "0.0.0.0", "--port", "8787"]
