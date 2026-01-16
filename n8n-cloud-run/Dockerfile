FROM n8nio/n8n:latest

# Set environment variables for Cloud Run
ENV N8N_HOST=0.0.0.0
ENV N8N_PORT=8080
ENV N8N_PROTOCOL=https
ENV WEBHOOK_URL=https://n8n-suresafe.run.app
ENV N8N_EDITOR_BASE_URL=https://n8n-suresafe.run.app
ENV GENERIC_TIMEZONE=America/Chicago
ENV N8N_PERSONALIZATION_ENABLED=false
ENV N8N_DIAGNOSTICS_ENABLED=false
ENV N8N_USER_MANAGEMENT_DISABLED=true
ENV N8N_BASIC_AUTH_ACTIVE=true
ENV N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true

# Data persistence via Cloud SQL or SQLite
ENV DB_TYPE=sqlite
ENV DB_SQLITE_DATABASE=/home/node/.n8n/database.sqlite

# Expose the port Cloud Run expects
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1
