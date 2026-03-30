# 🚀 Guía de Deployment FanFlow v2 en VPS con Portainer + Nginx Proxy Manager

## Pre-requisitos

- VPS con Ubuntu 22.04+ (mínimo 2GB RAM, 20GB SSD)
- Docker Engine 20.10+ instalado
- Docker Compose 2.0+ instalado
- Portainer instalado (opcional, pero recomendado para UI)
- **Nginx Proxy Manager ya running** (escuchando en 80/443)
- Dominio propio (ej: fanflow.example.com)
- SSH access al VPS

## Paso 1: Preparar el VPS

### 1.1 Conectarse al VPS
```bash
ssh root@tu-vps-ip
```

### 1.2 Instalar Docker (si no está instalado)
```bash
# Actualizar sistema
apt update && apt upgrade -y

# Instalar dependencias
apt install -y curl wget gnupg lsb-release ca-certificates

# Agregar repositorio de Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instalar Docker
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verificar instalación
docker --version
docker compose version

# Habilitar Docker al startup
systemctl enable docker
```

### 1.3 Crear estructura de directorios
```bash
mkdir -p /opt/fanflow/{config,data}
cd /opt/fanflow
```

---

## Paso 2: Portainer (Opcional - UI para gestionar contenedores)

Si quieres interfaz visual para Docker:

```bash
docker run -d \
  --name=portainer \
  --restart=always \
  -p 8000:8000 \
  -p 9000:9000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest
```

Acceder en: `http://tu-vps-ip:9000`

**Si prefieres CLI**, puedes omitir Portainer y usar solo `docker compose` commands.

---

## Paso 3: Configurar Nginx Proxy Manager (ya instalado)

Nginx Proxy Manager ya está running en tu VPS. Solo necesitas:

### 3.1 Acceder a NPM
- Abrir navegador: `http://tu-vps-ip:81`
- Login con tus credenciales

### 3.2 Verificar que NPM escucha en 80/443
NPM debe estar manejando ya el tráfico HTTP/HTTPS. Los certificados SSL están configurados centralmente en NPM.

---

## Paso 4: Desplegar FanFlow en Docker

### 4.1 Clonar o copiar el proyecto
```bash
cd /opt/fanflow

# Si tienes acceso a Git
git clone https://github.com/tu-usuario/fanflow.git .

# O copiar los archivos manualmente
# rsync -av ./FanFlow\ v2/ root@tu-vps-ip:/opt/fanflow/
```

### 4.2 Crear archivo .env.prod
En `/opt/fanflow/.env.prod`:

```bash
# Database
POSTGRES_USER=fanflow
POSTGRES_PASSWORD=<generar-contraseña-segura>
POSTGRES_DB=fanflow

# Redis
REDIS_PASSWORD=<generar-contraseña-segura>

# NextAuth
NEXTAUTH_URL=https://fanflow.example.com
NEXTAUTH_SECRET=<generar-con-openssl>

# Encryption
ENCRYPTION_KEY=<32-bytes-hex-64-caracteres>

# Stripe (obtener en https://dashboard.stripe.com)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Logging
LOG_LEVEL=info
```

**Generar valores seguros:**

```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY (64 caracteres hex)
openssl rand -hex 32

# POSTGRES_PASSWORD y REDIS_PASSWORD
openssl rand -base64 32
```

### 4.3 Actualizar docker-compose.prod.yml
Modificar las referencias a variables de entorno:

```bash
# Reemplazar en docker-compose.prod.yml:
NEXTAUTH_URL=${NEXTAUTH_URL}  # -> https://fanflow.example.com
LOG_LEVEL=${LOG_LEVEL}  # -> info

# Asegurarse que el archivo source el .env.prod correcto
```

### 4.4 Desplegar FanFlow

**Opción A - Vía CLI (recomendado):**
```bash
cd /opt/fanflow
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

**Opción B - Vía Portainer (si lo tienes):**
1. Portainer → Stacks → Add Stack
2. Name: `fanflow-prod`
3. Paste docker-compose.prod.yml
4. Configurar variables desde .env.prod
5. Deploy

---

## Paso 5: Agregar FanFlow a Nginx Proxy Manager

En tu Nginx Proxy Manager existente (http://tu-vps-ip:81):

1. **Dashboard → Proxy Hosts → Add Proxy Host**
2. **Details:**
   - **Domain Names:** `fanflow.example.com`
   - **Scheme:** `http`
   - **Forward Hostname/IP:** `localhost` (o la IP interna del Docker host)
   - **Forward Port:** `3000`
3. **SSL:**
   - **SSL Certificate:** Request a new SSL Certificate (Let's Encrypt automático)
   - **Email:** tu@email.com
   - **Force SSL:** ✅
   - **HTTP/2 Support:** ✅
4. **Advanced (opcional):**
   ```
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header Host $host;
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```
5. **Save**

Verificar en: `https://fanflow.example.com` → debería mostrar la landing page

---

## Paso 6: Post-Deployment

### 6.1 Ejecutar migraciones de BD
```bash
# Acceder al contenedor de la app
docker compose -f /opt/fanflow/docker-compose.prod.yml exec app npm run db:push
```

### 6.2 Verificar logs
```bash
# Logs de la app
docker compose -f /opt/fanflow/docker-compose.prod.yml logs -f app

# Logs del worker
docker compose -f /opt/fanflow/docker-compose.prod.yml logs -f worker

# Logs de PostgreSQL
docker compose -f /opt/fanflow/docker-compose.prod.yml logs -f postgres
```

### 6.3 Health check
```bash
# Dentro del VPS
curl http://localhost:3000/api/health

# Desde navegador
https://fanflow.example.com/api/health
```

---

## Paso 7: Monitoreo y Mantenimiento

### 7.1 Portainer Monitoring
- En Portainer, ver estado de contenedores
- Configurar alertas de salud

### 7.2 Renovación de certificados SSL
- Let's Encrypt se renueva automáticamente cada 90 días
- Nginx Proxy Manager maneja esto automáticamente

### 7.3 Backups de base de datos

**Backup manual:**
```bash
# Crear backup de PostgreSQL
docker compose -f /opt/fanflow/docker-compose.prod.yml exec postgres pg_dump -U fanflow fanflow > /opt/fanflow/backups/fanflow_$(date +%Y%m%d_%H%M%S).sql

# Crear backup de Redis
docker compose -f /opt/fanflow/docker-compose.prod.yml exec redis redis-cli BGSAVE
docker cp fanflow-redis-1:/data/dump.rdb /opt/fanflow/backups/redis_$(date +%Y%m%d_%H%M%S).rdb
```

**Backup automático (cron):**
```bash
# Editar crontab
crontab -e

# Agregar línea (backup diario a las 2 AM)
0 2 * * * cd /opt/fanflow && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U fanflow fanflow > /opt/fanflow/backups/fanflow_$(date +\%Y\%m\%d).sql
```

### 7.4 Actualizar la aplicación

```bash
# 1. Descargar últimos cambios
cd /opt/fanflow
git pull origin main

# 2. Reconstruir imagen
docker compose -f docker-compose.prod.yml build --no-cache

# 3. Redeploy (sin downtime)
docker compose -f docker-compose.prod.yml up -d

# 4. Verificar logs
docker compose -f docker-compose.prod.yml logs -f app
```

---

## Paso 8: Configurar Webhook de Stripe

En Stripe Dashboard (https://dashboard.stripe.com/webhooks):

1. **Create endpoint**
2. **Endpoint URL:** `https://fanflow.example.com/api/webhooks/stripe`
3. **Events to send:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. **Copy Signing secret** → agregar a `.env.prod` como `STRIPE_WEBHOOK_SECRET`

---

## Troubleshooting

### El sitio muestra "502 Bad Gateway"
```bash
# Verificar que la app está corriendo
docker compose -f /opt/fanflow/docker-compose.prod.yml ps

# Ver logs
docker compose -f /opt/fanflow/docker-compose.prod.yml logs app

# Reiniciar servicios
docker compose -f /opt/fanflow/docker-compose.prod.yml restart app
```

### Base de datos no se conecta
```bash
# Verificar PostgreSQL
docker compose -f /opt/fanflow/docker-compose.prod.yml exec postgres psql -U fanflow -d fanflow -c "SELECT 1"

# Ver logs de PostgreSQL
docker compose -f /opt/fanflow/docker-compose.prod.yml logs postgres
```

### Redis no responde
```bash
# Verificar Redis
docker compose -f /opt/fanflow/docker-compose.prod.yml exec redis redis-cli ping

# Limpiar datos si es necesario (⚠️ cuidado)
docker volume rm fanflow_redis_data
```

### NPM no alcanza la app (502 Bad Gateway)
```bash
# Verificar que FanFlow está corriendo
docker compose -f /opt/fanflow/docker-compose.prod.yml ps app

# Verificar puerta 3000 desde el host
curl http://localhost:3000/api/health

# En NPM, asegurarse que "Forward Hostname/IP" es correcto:
# - Si Docker está en localhost: localhost:3000
# - Si Docker está en otra máquina: ip-del-docker:3000
```

---

## Checklist Final

- ✅ Docker y Docker Compose instalados
- ✅ Portainer configurado (puerto 9000)
- ✅ Nginx Proxy Manager ya running (puerto 81, 80/443)
- ✅ `.env.prod` creado con `./scripts/deploy.sh setup`
- ✅ `.env.prod` editado: dominio + Stripe keys
- ✅ FanFlow desplegado: `./scripts/deploy.sh start`
- ✅ Proxy host en NPM: `fanflow.example.com` → `localhost:3000`
- ✅ SSL en NPM: Let's Encrypt automático
- ✅ Migraciones de BD ejecutadas (automático)
- ✅ `http://localhost:3000/api/health` → 200
- ✅ `https://fanflow.example.com` → landing page
- ✅ Webhook de Stripe configurado

---

## Rollback de emergencia

```bash
# Volver a versión anterior
cd /opt/fanflow
git revert HEAD
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# O restaurar desde backup
psql -U fanflow fanflow < /opt/fanflow/backups/fanflow_YYYYMMDD.sql
```

---

## Recursos útiles

- 📚 [Portainer Documentation](https://docs.portainer.io/)
- 🔒 [Nginx Proxy Manager](https://nginxproxymanager.com/)
- 🐳 [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- 💳 [Stripe Webhooks](https://stripe.com/docs/webhooks)
- 🔐 [Let's Encrypt](https://letsencrypt.org/)


