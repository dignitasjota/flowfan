#!/bin/bash

# FlowFan Deployment Script
# Uso: ./scripts/deploy.sh [setup|start|stop|logs|backup|migrate|update|health]

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( dirname "$SCRIPT_DIR" )"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ENV_FILE="${PROJECT_ROOT}/.env.prod"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error()   { echo -e "${RED}❌ $1${NC}"; }

# docker compose con el fichero de producción y SIEMPRE con .env.prod.
# Antes no se pasaba --env-file: compose solo lee `.env`, así que las
# variables de .env.prod no llegaban a los contenedores.
dc() {
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# Commit actual, inyectado en las imágenes como build arg (GIT_SHA).
export_git_sha() {
    GIT_SHA="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)"
    export GIT_SHA
}

check_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env.prod not found!"
        log_info "Run './scripts/deploy.sh setup' first to create it"
        exit 1
    fi
}

# Setup: Create .env.prod and generate secure values
setup() {
    log_info "FlowFan Deployment Setup"

    if [ -f "$ENV_FILE" ]; then
        log_warning ".env.prod already exists. Backup:"
        cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    log_info "Generating secure values..."
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr '/+' '_-')
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr '/+' '_-')

    cat > "$ENV_FILE" << ENVEOF
# Database
POSTGRES_USER=fanflow
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=fanflow

# Redis
REDIS_PASSWORD=${REDIS_PASSWORD}

# NextAuth (CHANGE THIS!)
NEXTAUTH_URL=https://your-domain.example.com
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}

# Encryption for API keys at rest
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Stripe (Get from https://dashboard.stripe.com)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Logging
LOG_LEVEL=info
ENVEOF

    log_success ".env.prod created with generated values:"
    log_info "  NEXTAUTH_URL: https://your-domain.example.com (UPDATE THIS!)"
    log_info "  STRIPE_* keys: (UPDATE THESE!)"
    log_warning "Edit $ENV_FILE and set your domain and Stripe keys before deploying!"
}

# Database backup (usa el usuario/DB reales del contenedor, no hardcodeados)
backup() {
    check_env_file

    BACKUP_DIR="${PROJECT_ROOT}/backups"
    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="${BACKUP_DIR}/flowfan_$(date +%Y%m%d_%H%M%S).sql"

    log_info "Creating database backup..."
    dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_FILE"

    log_success "Backup created: $BACKUP_FILE"
    log_info "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
}

# Espera a que el contenedor `app` esté healthy (healthcheck del compose).
wait_for_app() {
    log_info "Waiting for app to become healthy (max 5 min)..."
    local cid status
    for _ in $(seq 1 60); do
        cid="$(dc ps -q app)"
        status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
        if [ "$status" = "healthy" ]; then
            log_success "App is healthy"
            return 0
        fi
        sleep 5
    done
    log_error "App did not become healthy. Last status: ${status:-unknown}"
    dc logs --tail 100 app
    exit 1
}

# Comprueba que el worker corre la imagen del commit actual. Evita migrar con
# un schema antiguo (pasó al redeployar desde Portainer sin reconstruir).
check_worker_image() {
    local expected running
    expected="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)"
    running="$(dc exec -T worker printenv GIT_SHA 2>/dev/null | tr -d '\r' || true)"
    if [ "$running" != "$expected" ]; then
        log_error "The worker is running build '${running:-unknown}', but the code is at '${expected}'."
        log_info "Rebuild first: ./scripts/deploy.sh update  (or: GIT_SHA=${expected} docker compose ... build --no-cache app worker && ... up -d)"
        exit 1
    fi
    log_success "Worker image matches commit ${expected}"
}

# Migraciones: backup + db:push (interactivo) + trigger de búsqueda.
# db:push puede preguntar (¿columna nueva o renombrada?, ¿aceptar pérdida de
# datos?). Con `exec -T` no hay TTY y el comando fallaba; ahora se exige una
# terminal y se ejecuta de forma interactiva.
migrate() {
    check_env_file
    check_worker_image

    if [ ! -t 0 ] || [ ! -t 1 ]; then
        log_error "Migrations need an interactive terminal (drizzle-kit may ask questions)."
        log_info "Run './scripts/deploy.sh migrate' from an SSH session, or use the worker console in Portainer:"
        log_info "  npm run db:push && npm run db:ensure-search"
        exit 1
    fi

    backup

    log_info "Applying schema (db:push). If asked 'create or rename?', choose create unless it is a real rename."
    log_warning "If it warns about DATA LOSS, answer No and review before continuing."
    dc exec worker npm run db:push

    log_info "Ensuring full-text search trigger (db:ensure-search)..."
    dc exec -T worker npm run db:ensure-search

    log_info "Restarting app and worker..."
    dc restart app worker
    log_success "Database migrations completed!"
}

# Start services (primer despliegue)
start() {
    check_env_file

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed!"
        exit 1
    fi
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose v2 is not installed!"
        exit 1
    fi

    cd "$PROJECT_ROOT"
    export_git_sha

    log_info "Building images (commit ${GIT_SHA})..."
    dc build --no-cache

    log_info "Starting containers..."
    dc up -d

    # Antes se buscaba "app.*running" en `docker compose ps`, que en Compose v2
    # muestra "Up", así que las migraciones nunca se ejecutaban.
    wait_for_app
    migrate

    log_info ""
    dc ps
    log_success "FlowFan is ready!"
    log_info "API Health: http://localhost:3000/api/health"
    log_info "Next: Configure in Nginx Proxy Manager (forward to localhost:3000)"
}

# Stop services
stop() {
    check_env_file
    log_warning "Stopping FlowFan services..."
    dc down
    log_success "Services stopped"
}

# View logs
logs() {
    check_env_file
    SERVICE=${1:-app}
    log_info "Showing logs for: $SERVICE (Ctrl+C to exit)"
    dc logs -f "$SERVICE"
}

# Update and redeploy
update() {
    check_env_file
    cd "$PROJECT_ROOT"

    log_info "Pulling latest code..."
    git pull origin main
    export_git_sha

    log_info "Rebuilding images (commit ${GIT_SHA})..."
    dc build --no-cache app worker

    log_info "Redeploying services..."
    dc up -d

    wait_for_app
    migrate

    log_success "Update completed!"
    dc ps
}

# Health check
health() {
    check_env_file

    log_info "Container status:"
    dc ps

    log_info ""
    log_info "Attempting health checks..."
    if body="$(curl -fs http://localhost:3000/api/health)"; then
        log_success "API is healthy: $body"
    else
        log_warning "API health check failed"
    fi

    if dc exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > /dev/null 2>&1; then
        log_success "PostgreSQL is healthy"
    else
        log_warning "PostgreSQL health check failed"
    fi

    if dc exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        log_success "Redis is healthy"
    else
        log_warning "Redis health check failed"
    fi
}

help() {
    echo -e "${BLUE}FlowFan Deployment Helper${NC}

Usage: ./scripts/deploy.sh [command]

Commands:
  ${GREEN}setup${NC}     Create .env.prod with generated secure values
  ${GREEN}start${NC}     First deploy: build, start, wait for health and migrate
  ${GREEN}stop${NC}      Stop all services
  ${GREEN}logs${NC}      Show logs (usage: logs [service_name])
  ${GREEN}backup${NC}    Create database backup in ./backups
  ${GREEN}migrate${NC}   Backup + db:push (interactive) + db:ensure-search + restart
  ${GREEN}update${NC}    git pull, rebuild app+worker, redeploy and migrate
  ${GREEN}health${NC}    Check health of all services
  ${GREEN}help${NC}      Show this help message

${YELLOW}First time setup:${NC}
  1. ./scripts/deploy.sh setup
  2. Edit .env.prod with your domain and Stripe keys
  3. ./scripts/deploy.sh start
  4. Configure the proxy host in Nginx Proxy Manager (forward to localhost:3000)
  5. Open https://your-domain/api/health

${YELLOW}Run 'start', 'update' and 'migrate' from an interactive SSH session.${NC}
${YELLOW}See DEPLOYMENT.md for detailed instructions${NC}"
}

COMMAND=${1:-help}

case "$COMMAND" in
    setup)   setup ;;
    start)   start ;;
    stop)    stop ;;
    logs)    logs "${2:-app}" ;;
    backup)  backup ;;
    migrate) migrate ;;
    update)  update ;;
    health)  health ;;
    help)    help ;;
    *)
        log_error "Unknown command: $COMMAND"
        help
        exit 1
        ;;
esac
