# 🚀 Guía de Deployment FlowFan v2 en VPS con Portainer + Nginx Proxy Manager

## Pre-requisitos

- VPS con Ubuntu 22.04+ (mínimo 2GB RAM, 20GB SSD)
- Docker Engine 20.10+ instalado
- Docker Compose 2.0+ instalado
- Portainer instalado (opcional, pero recomendado para UI)
- **Nginx Proxy Manager ya running** (escuchando en 80/443)
- Dominio propio (ej: flowfan.example.com)
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

## Paso 4: Desplegar FlowFan en Docker

### 4.1 Clonar o copiar el proyecto
```bash
cd /opt/fanflow

# Si tienes acceso a Git
git clone https://github.com/tu-usuario/fanflow.git .

# O copiar los archivos manualmente
# rsync -av ./FlowFan\ v2/ root@tu-vps-ip:/opt/fanflow/
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
NEXTAUTH_URL=https://flowfan.example.com
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
NEXTAUTH_URL=${NEXTAUTH_URL}  # -> https://flowfan.example.com
LOG_LEVEL=${LOG_LEVEL}  # -> info

# Asegurarse que el archivo source el .env.prod correcto
```

### 4.4 Desplegar FlowFan

**Opción A - Vía CLI (recomendado):**
```bash
cd /opt/fanflow
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

**Opción B - Vía Portainer (si lo tienes):**
1. Portainer → Stacks → Add Stack
2. Name: `fanflow-prod`
3. Paste docker-compose.prod.yml
4. Configurar variables desde .env.prod (añade también `GIT_SHA` con el commit, ver abajo)
5. Deploy

> ⚠️ **Portainer no reconstruye las imágenes al redesplegar.** `app` y `worker`
> se construyen desde el código (`build:` en el compose). "Update the stack" o
> "Pull and redeploy" hacen `docker compose up -d`, que **reutiliza la imagen
> existente** si ya hay una: el contenedor sigue con el código antiguo aunque
> el repositorio esté actualizado. Para actualizar, reconstruye por SSH
> (sección 7.4) o activa la opción de re-build/re-pull si tu versión de
> Portainer la ofrece **y verifica** el resultado.
>
> **Cómo verificar qué código corre:** `https://tu-dominio/api/health` devuelve
> `"build": "<commit>"`. Debe coincidir con `git rev-parse --short HEAD` del
> servidor. Si devuelve `"unknown"`, la imagen se construyó sin `GIT_SHA`
> (por ejemplo desde Portainer sin esa variable); en ese caso comprueba en la
> consola del worker que el código es el nuevo, p. ej.
> `grep ensure-search /app/package.json`.

---

## Paso 5: Agregar FlowFan a Nginx Proxy Manager

En tu Nginx Proxy Manager existente (http://tu-vps-ip:81):

1. **Dashboard → Proxy Hosts → Add Proxy Host**
2. **Details:**
   - **Domain Names:** `flowfan.example.com`
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
   # SEC-4: SOBRESCRIBIR (no anexar) X-Forwarded-For. Con $proxy_add_x_forwarded_for
   # el cliente puede inyectar el primer valor y evadir el rate limit de fuerza
   # bruta. Usa $remote_addr para que el primer valor sea siempre la IP real.
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header Host $host;
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```
   > Si tienes una cadena de proxies de confianza que **deben** anexar al XFF,
   > mantén `$proxy_add_x_forwarded_for` y define la env `TRUSTED_PROXY_HOPS=N`
   > (número de proxies de confianza) para que la app cuente la IP desde la derecha.
5. **Save**

Verificar en: `https://flowfan.example.com` → debería mostrar la landing page

---

## Paso 6: Post-Deployment

### 6.1 Ejecutar migraciones de BD

Producción aplica el schema con `db:push` (compara `src/server/db/schema.ts`
con la base de datos y aplica la diferencia). **No uses `db:migrate` en el
servidor:** la imagen del worker no incluye la carpeta `drizzle/`.

Se ejecuta en el contenedor **worker**: la imagen `app` (Next.js standalone)
no incluye `drizzle.config.ts` ni `src/`.

**Antes de migrar, asegúrate de que el worker corre la imagen nueva** (ver el
aviso de Portainer en 4.4). Si migras con una imagen antigua, `db:push` usa el
schema viejo: no aplica los cambios y puede intentar deshacer columnas nuevas.

**Opción A — script (recomendado, por SSH):**
```bash
cd /opt/fanflow
./scripts/deploy.sh migrate
```
Hace backup en `./backups`, comprueba que el worker corre el commit actual,
lanza `db:push` de forma **interactiva**, crea el trigger de búsqueda y
reinicia `app` y `worker`. Necesita una terminal interactiva: no lo lances
desde cron ni desde CI.

**Opción B — consola del worker en Portainer:**
Containers → `worker` → Console → comando `/bin/sh` (la imagen es Alpine, no
hay bash) → Connect:
```sh
cd /app
grep ensure-search package.json   # si no imprime nada, la imagen es antigua: para
npm run db:push
npm run db:ensure-search
```
Después reinicia `app` y `worker`.

**Preguntas de `db:push`:**
- *¿Columna/tabla nueva o renombrada?* → elige **create** salvo que sea un
  renombrado real.
- *Aviso de pérdida de datos (truncar, borrar columna con datos)* → responde
  **No** y revisa antes de continuar.

`db:push` no crea triggers, por eso `db:ensure-search` es obligatorio después:
crea (o repara) el trigger de full-text search de `messages` y rellena la
columna `search_vector`. Es idempotente.

**Scripts de mantenimiento** (también en el worker; las variables vienen del
compose, por eso usan `--env-file-if-exists`):
```bash
docker compose -f /opt/fanflow/docker-compose.prod.yml --env-file /opt/fanflow/.env.prod exec worker npm run grandfather:email-verified -- --dry-run
docker compose -f /opt/fanflow/docker-compose.prod.yml --env-file /opt/fanflow/.env.prod exec worker npm run generate:vapid
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
https://flowfan.example.com/api/health
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

**Con el script (recomendado):**
```bash
cd /opt/fanflow
./scripts/deploy.sh update
```
Hace `git pull`, reconstruye `app` y `worker` con el commit actual (`GIT_SHA`),
redespliega, espera a que la app esté healthy y lanza `migrate` (backup +
`db:push` interactivo + `db:ensure-search` + reinicio).

**A mano:**
```bash
cd /opt/fanflow
git pull origin main
export GIT_SHA=$(git rev-parse --short HEAD)

# Reconstruir: imprescindible, `up -d` solo no recoge el código nuevo
docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache app worker
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Verificar que corre el commit nuevo
curl -s http://localhost:3000/api/health   # "build" debe ser igual a $GIT_SHA

# Migrar (interactivo)
./scripts/deploy.sh migrate
```

Si despliegas desde Portainer, haz igualmente la reconstrucción por SSH:
Portainer no reconstruye las imágenes por sí solo (ver 4.4).

---

## Paso 8: Configurar Webhook de Stripe

En Stripe Dashboard (https://dashboard.stripe.com/webhooks):

1. **Create endpoint**
2. **Endpoint URL:** `https://flowfan.example.com/api/webhooks/stripe`
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
# Verificar que FlowFan está corriendo
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
- ✅ FlowFan desplegado: `./scripts/deploy.sh start`
- ✅ Proxy host en NPM: `flowfan.example.com` → `localhost:3000`
- ✅ SSL en NPM: Let's Encrypt automático
- ✅ Migraciones de BD ejecutadas (`deploy.sh start`/`update` lanzan `migrate`, interactivo)
- ✅ `/api/health` devuelve `"build"` igual al commit desplegado
- ✅ `http://localhost:3000/api/health` → 200
- ✅ `https://flowfan.example.com` → landing page
- ✅ Webhook de Stripe configurado

---

## Rollback de emergencia

```bash
# Volver a versión anterior
cd /opt/fanflow
git revert HEAD
export GIT_SHA=$(git rev-parse --short HEAD)
docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache app worker
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# O restaurar desde backup (psql corre dentro del contenedor de Postgres).
# Ojo: restaurar sobre una BD con datos puede fallar por duplicados; para una
# restauración limpia, recrea antes la base de datos.
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < /opt/fanflow/backups/flowfan_YYYYMMDD_HHMMSS.sql
```

---

## Recursos útiles

- 📚 [Portainer Documentation](https://docs.portainer.io/)
- 🔒 [Nginx Proxy Manager](https://nginxproxymanager.com/)
- 🐳 [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- 💳 [Stripe Webhooks](https://stripe.com/docs/webhooks)
- 🔐 [Let's Encrypt](https://letsencrypt.org/)


