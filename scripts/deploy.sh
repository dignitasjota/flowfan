#!/bin/bash

# FanFlow Deployment Script
# Uso: ./scripts/deploy.sh [setup|start|stop|logs|backup|update]

set -e

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

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if .env.prod exists
check_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env.prod not found!"
        log_info "Run './scripts/deploy.sh setup' first to create it"
        exit 1
    fi
}

# Setup: Create .env.prod and generate secure values
setup() {
    log_info "FanFlow Deployment Setup"

    if [ -f "$ENV_FILE" ]; then
        log_warning ".env.prod already exists. Backup:"
        cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    # Generate secure values
    log_info "Generating secure values..."
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr '/+' '_-')
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr '/+' '_-')

    # Create .env.prod
    cat > "$ENV_FILE" << EOF
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
# Testing keys:
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Logging
LOG_LEVEL=info
EOF

    log_success ".env.prod created with generated values:"
    log_info "  NEXTAUTH_URL: https://your-domain.example.com (UPDATE THIS!)"
    log_info "  STRIPE_* keys: (UPDATE THESE!)"
    log_warning "Edit $ENV_FILE and set your domain and Stripe keys before deploying!"
}

# Start services
start() {
    check_env_file

    log_info "Starting FanFlow services..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed!"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed!"
        exit 1
    fi

    cd "$PROJECT_ROOT"

    log_info "Building images..."
    docker compose -f "$COMPOSE_FILE" build --no-cache

    log_info "Starting containers..."
    docker compose -f "$COMPOSE_FILE" up -d

    log_info "Waiting for services to be healthy..."
    sleep 5

    # Check if app is running
    if docker compose -f "$COMPOSE_FILE" ps | grep -q "app.*running"; then
        log_success "Services started!"

        log_info "Running database migrations..."
        docker compose -f "$COMPOSE_FILE" exec -T app npm run db:push

        log_success "Database migrations completed!"

        log_info ""
        log_info "Services running:"
        docker compose -f "$COMPOSE_FILE" ps

        log_info ""
        log_success "FanFlow is ready!"
        log_info "API Health: http://localhost:3000/api/health"
        log_info "Portainer: http://localhost:9000"
        log_info "Nginx Proxy Manager: http://localhost:81"
    else
        log_error "Failed to start services. Check logs:"
        docker compose -f "$COMPOSE_FILE" logs
        exit 1
    fi
}

# Stop services
stop() {
    check_env_file

    log_warning "Stopping FanFlow services..."
    docker compose -f "$COMPOSE_FILE" down
    log_success "Services stopped"
}

# View logs
logs() {
    check_env_file

    SERVICE=${1:-app}
    log_info "Showing logs for: $SERVICE (Ctrl+C to exit)"
    docker compose -f "$COMPOSE_FILE" logs -f "$SERVICE"
}

# Database backup
backup() {
    check_env_file

    BACKUP_DIR="${PROJECT_ROOT}/backups"
    mkdir -p "$BACKUP_DIR"

    BACKUP_FILE="${BACKUP_DIR}/fanflow_$(date +%Y%m%d_%H%M%S).sql"

    log_info "Creating database backup..."
    docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U fanflow fanflow > "$BACKUP_FILE"

    log_success "Backup created: $BACKUP_FILE"
    log_info "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
}

# Update and redeploy
update() {
    check_env_file

    log_info "Updating FanFlow..."

    cd "$PROJECT_ROOT"

    log_info "Pulling latest code..."
    git pull origin main

    log_info "Rebuilding images..."
    docker compose -f "$COMPOSE_FILE" build --no-cache

    log_info "Redeploying services..."
    docker compose -f "$COMPOSE_FILE" up -d

    log_info "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" exec -T app npm run db:push || true

    log_success "Update completed!"
    log_info ""
    docker compose -f "$COMPOSE_FILE" ps
}

# Health check
health() {
    check_env_file

    log_info "Checking FanFlow health..."

    # Check Docker containers
    log_info "Container status:"
    docker compose -f "$COMPOSE_FILE" ps

    log_info ""
    log_info "Attempting health checks..."

    # Try to connect to API
    if curl -s http://localhost:3000/api/health > /dev/null; then
        log_success "API is healthy"
    else
        log_warning "API health check failed"
    fi

    # Check database
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U fanflow > /dev/null 2>&1; then
        log_success "PostgreSQL is healthy"
    else
        log_warning "PostgreSQL health check failed"
    fi

    # Check Redis
    if docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping > /dev/null 2>&1; then
        log_success "Redis is healthy"
    else
        log_warning "Redis health check failed"
    fi
}

# Show help
help() {
    cat << EOF
${BLUE}FanFlow Deployment Helper${NC}

Usage: ./scripts/deploy.sh [command]

Commands:
  ${GREEN}setup${NC}     Create .env.prod with generated secure values
  ${GREEN}start${NC}     Build and start all services
  ${GREEN}stop${NC}      Stop all services
  ${GREEN}logs${NC}      Show logs (usage: logs [service_name])
  ${GREEN}backup${NC}    Create database backup
  ${GREEN}update${NC}    Pull latest code and redeploy
  ${GREEN}health${NC}    Check health of all services
  ${GREEN}help${NC}      Show this help message

Examples:
  ./scripts/deploy.sh setup
  ./scripts/deploy.sh start
  ./scripts/deploy.sh logs app
  ./scripts/deploy.sh backup
  ./scripts/deploy.sh update
  ./scripts/deploy.sh health

${YELLOW}First time setup:${NC}
  1. ./scripts/deploy.sh setup
  2. Edit .env.prod with your domain and Stripe keys
  3. ./scripts/deploy.sh start
  4. Open http://localhost/api/health or https://your-domain/api/health

${YELLOW}See DEPLOYMENT.md for detailed instructions${NC}
EOF
}

# Main
COMMAND=${1:-help}

case "$COMMAND" in
    setup)
        setup
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    logs)
        logs "$2"
        ;;
    backup)
        backup
        ;;
    update)
        update
        ;;
    health)
        health
        ;;
    help)
        help
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        help
        exit 1
        ;;
esac
