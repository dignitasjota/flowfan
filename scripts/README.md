# FanFlow Deployment Scripts

## Quick Start

### 1. Setup (Generate .env.prod)
```bash
./scripts/deploy.sh setup
```
This will:
- Generate secure values (NEXTAUTH_SECRET, ENCRYPTION_KEY, passwords)
- Create `.env.prod` file
- **You must edit `.env.prod` to add your domain and Stripe keys**

### 2. Start Services
```bash
./scripts/deploy.sh start
```
This will:
- Build Docker images
- Start all services (app, worker, postgres, redis)
- Run database migrations
- Show service status

### 3. Verify Health
```bash
./scripts/deploy.sh health
```

## All Commands

| Command | Description |
|---------|-------------|
| `setup` | Generate `.env.prod` with secure values |
| `start` | Build and start services |
| `stop` | Stop all services |
| `logs [service]` | Stream logs (default: app) |
| `backup` | Create database backup |
| `update` | Pull latest code and redeploy |
| `health` | Check health of all services |
| `help` | Show help |

## Examples

```bash
# View app logs in real-time
./scripts/deploy.sh logs app

# View postgres logs
./scripts/deploy.sh logs postgres

# Create database backup
./scripts/deploy.sh backup

# Update to latest version
./scripts/deploy.sh update

# Check if everything is healthy
./scripts/deploy.sh health
```

## Troubleshooting

### Script doesn't run
```bash
# Make sure it's executable
chmod +x ./scripts/deploy.sh

# Run with explicit bash
bash ./scripts/deploy.sh start
```

### .env.prod not found
```bash
# Create it first
./scripts/deploy.sh setup

# Edit it
nano .env.prod
```

### Services won't start
```bash
# Check logs
./scripts/deploy.sh logs app

# Check Docker is running
docker ps

# Try rebuilding
docker compose -f docker-compose.prod.yml build --no-cache
```

## What Each Script Does

### deploy.sh
Main deployment helper script with these functions:
- **setup**: Creates `.env.prod` with randomly generated secure values
- **start**: Builds images, starts containers, runs migrations
- **stop**: Gracefully stops all services
- **logs**: Streams logs from any service
- **backup**: Creates SQL backup of PostgreSQL database
- **update**: Pulls git changes and redeploys
- **health**: Checks Docker container and API health

## Environment Variables

`.env.prod` contains:
- **Database**: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
- **Redis**: REDIS_PASSWORD
- **Auth**: NEXTAUTH_URL, NEXTAUTH_SECRET
- **Encryption**: ENCRYPTION_KEY (for storing API keys at rest)
- **Stripe**: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, Price IDs, Publishable Key
- **Logging**: LOG_LEVEL

**See DEPLOYMENT.md for detailed setup instructions.**
