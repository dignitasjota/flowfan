# FanFlow v2 — Estado del Proyecto

> **Documento de referencia para agentes y desarrolladores.**
> Última actualización: 2026-03-14
> Estado actual: **Producción-ready**. Todas las funcionalidades core implementadas, testeadas y documentadas.

---

## 1. Qué es FanFlow

SaaS CRM para creadores de contenido adulto (OnlyFans, Instagram, etc.) con asistente IA para gestionar conversaciones con fans. El producto permite:

- Gestionar múltiples fans (contactos) y sus conversaciones
- Obtener sugerencias de respuesta generadas por IA en tiempo real
- Analizar el comportamiento y sentimiento de cada fan automáticamente
- Puntuar a cada fan en un funnel de conversión (cold → vip)
- Recibir recomendaciones proactivas de acción
- Manejar plantillas de respuesta reutilizables
- Monetizar con planes de suscripción (Free / Starter / Pro / Business)

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 15 (App Router) |
| Frontend | React 19 + TailwindCSS v4 |
| Backend API | tRPC v11 |
| Base de datos | PostgreSQL 16 (Drizzle ORM) |
| Cache / Colas | Redis 7 + BullMQ |
| Auth | NextAuth v4 (credentials provider, JWT) |
| IA | Multi-proveedor: Anthropic, OpenAI, Google, MiniMax, Kimi |
| Pagos | Stripe (Checkout Sessions, Customer Portal, Webhooks) |
| Logs | Pino (JSON estructurado, configurable via LOG_LEVEL) |
| Tests | Vitest v4 + coverage v8 |
| CI/CD | GitHub Actions |
| Deploy | Docker Compose + Portainer + Nginx Proxy Manager (VPS) |

---

## 3. Arquitectura general

### Multi-tenancy
Toda la información está aislada por `creator_id`. La tabla `creators` es el tenant principal. Todas las demás tablas tienen `creator_id` con `CASCADE DELETE`.

### Flujo de autenticación
1. Registro → `POST /api/auth/register` (rate limit, CSRF, validación, bcrypt×12)
2. Login → NextAuth credentials provider
3. Sesión → JWT almacenada en cookie (`NEXTAUTH_SECRET`)
4. Middleware → `src/middleware.ts` protege rutas y redirige según sesión
5. tRPC → `protectedProcedure` extrae `ctx.creatorId` del JWT en cada request

### Flujo de mensajes con IA
1. Fan manda mensaje → `messages.addFanMessage` lo guarda en DB
2. Se encola job en Redis (`analysisQueue`, BullMQ)
3. Worker (`src/server/worker.ts`) lo procesa: analiza sentimiento, actualiza perfil del fan
4. Al pedir sugerencia → `ai.suggest` corre `generateSuggestion` + `analyzeMessage` en paralelo
5. El resultado actualiza el contactProfile (engagement, funnel stage, payment probability)

---

## 4. Estructura de archivos clave

```
src/
├── app/
│   ├── (auth)/           # Login, register, forgot-password, reset-password
│   ├── (dashboard)/      # Conversations, contacts, settings, billing, onboarding, dashboard
│   ├── api/
│   │   ├── auth/         # register, forgot-password, reset-password, verify-email
│   │   ├── health/       # Health check endpoint
│   │   ├── trpc/         # tRPC handler
│   │   └── webhooks/stripe/  # Stripe webhook
│   ├── layout.tsx
│   └── page.tsx          # Landing pública (si no hay sesión) o redirect a /conversations
│
├── components/
│   ├── billing/          # plan-badge, upgrade-modal, usage-card
│   ├── conversations/    # chat-panel, contact-panel, conversation-list
│   ├── landing/          # hero, features, pricing-table, faq, footer
│   ├── layout/           # sidebar
│   ├── onboarding/       # onboarding-wizard, step-platform, step-ai-config, step-first-contact
│   ├── settings/         # platform-settings, ai-model-settings, template-settings, account-settings
│   └── ui/               # skeleton, toast
│
├── lib/
│   ├── constants.ts      # PLATFORM_TYPES, FUNNEL_STAGES, schemas Zod (fuente única de verdad)
│   ├── crypto.ts         # AES-256-GCM encrypt/decrypt para API keys en reposo
│   ├── logger.ts         # Pino logger con createChildLogger(module)
│   ├── rate-limit.ts     # Rate limiting con Redis sorted sets
│   ├── stripe.ts         # Singleton Stripe + PLAN_PRICE_IDS + getPlanFromPriceId
│   └── env.ts            # Variables de entorno validadas con @t3-oss/env-nextjs
│
├── middleware.ts          # Autenticación JWT, redireccionamiento rutas protegidas/públicas
│
└── server/
    ├── api/
    │   ├── root.ts        # Router principal (registra todos los sub-routers)
    │   ├── trpc.ts        # createTRPCRouter, protectedProcedure, publicProcedure
    │   └── routers/
    │       ├── account.ts       # getProfile, deleteAccount
    │       ├── ai.ts            # suggest, regenerate, summarizeConversation, generateReport, getPriceAdvice
    │       ├── ai-config.ts     # get, upsert, testConnection, getAssignments, upsertAssignment, deleteAssignment
    │       ├── billing.ts       # getPlan, getUsage, createCheckoutSession, createPortalSession, getInvoices, completeOnboarding
    │       ├── contacts.ts      # list, getById, create, update
    │       ├── conversations.ts # list, getById, create, updateStatus
    │       ├── intelligence.ts  # getContactScoring, getSentimentTrend, getTopContacts, getDashboardStats, exportContactsData, notifications CRUD, getProactiveActions
    │       ├── messages.ts      # list, addFanMessage, addCreatorMessage
    │       ├── platforms.ts     # list, upsert, delete
    │       └── templates.ts     # list, getById, create, update, delete, incrementUsage, getCategories
    │
    ├── db/
    │   ├── index.ts       # Instancia Drizzle ORM + postgres connection
    │   └── schema.ts      # Definición completa de tablas, enums y relaciones
    │
    ├── queues/
    │   └── index.ts       # BullMQ queue "message-analysis" (3 reintentos, backoff exponencial)
    │
    ├── services/
    │   ├── ai.ts                  # callAIProvider (multi-proveedor), generateSuggestion, stripThinkingBlocks, PROVIDER_MODELS
    │   ├── ai-analysis.ts         # analyzeMessage → SentimentResult (score, label, topics, purchaseIntent...)
    │   ├── ai-config-resolver.ts  # resolveAIConfig (task-specific > default)
    │   ├── contact-report.ts      # generateContactReport → ContactReport
    │   ├── conversation-summary.ts# summarizeConversation → ConversationSummary
    │   ├── price-advisor.ts       # getPriceAdvice → PriceAdvice
    │   ├── proactive-actions.ts   # generateProactiveActions → ProactiveAction[]
    │   ├── profile-updater.ts     # updateContactProfile (signals + scores + notificaciones)
    │   ├── scoring.ts             # updateSignals, calculateScores → ScoringResult
    │   └── usage-limits.ts        # PLAN_LIMITS, checkContactLimit, checkAIMessageLimit, checkPlatformLimit, checkTemplateLimit, checkReportLimit, checkFeatureAccess, getUsageSummary
    │
    ├── auth.ts            # Configuración NextAuth (credentials provider, callbacks JWT/session)
    ├── redis.ts           # Instancia Redis singleton (ioredis)
    └── worker.ts          # BullMQ Worker (concurrency 5, rate limit 10/s, graceful shutdown)
```

---

## 5. Base de datos — Tablas y relaciones

```
creators (tenant principal)
  ├── platforms         (personalidad por red social, 1 por tipo de plataforma)
  ├── contacts          (fans)
  │   └── contactProfiles   (perfil dinámico: engagement, funnelStage, behavioralSignals...)
  ├── conversations     (hilos de conversación)
  │   └── messages          (mensajes individuales con campo `sentiment` JSONB)
  ├── notes             (notas del creador sobre un contacto)
  ├── aiConfigs         (configuración IA: proveedor, modelo, apiKey cifrada)
  ├── aiModelAssignments(asignaciones multi-modelo por tipo de tarea)
  ├── aiUsageLog        (registro de tokens consumidos)
  ├── responseTemplates (plantillas de respuesta)
  ├── notifications     (eventos importantes: funnel advance, payment spike)
  └── passwordResetTokens (tokens de recuperación de contraseña, 1h expiración)
```

**Enums de base de datos:**
- `platformTypeEnum`: instagram, tinder, reddit, onlyfans, twitter, telegram, snapchat, other
- `subscriptionPlanEnum`: free, starter, pro, business
- `subscriptionStatusEnum`: active, past_due, canceled, trialing
- `messageRoleEnum`: fan, creator
- `conversationStatusEnum`: active, paused, archived
- `funnelStageEnum`: cold, curious, interested, hot_lead, buyer, vip
- `responseSpeedEnum`: fast, medium, slow
- `conversationDepthEnum`: superficial, moderate, deep
- `estimatedBudgetEnum`: low, medium, high, premium
- `aiRequestTypeEnum`: suggestion, analysis, scoring, summary
- `aiProviderEnum`: anthropic, openai, google, minimax, kimi
- `aiTaskTypeEnum`: suggestion, analysis, summary, report, price_advice

---

## 6. Sistema de planes y límites

| Feature | Free | Starter ($15/mes) | Pro ($29/mes) | Business (custom) |
|---------|------|-------------------|---------------|-------------------|
| Contactos | 5 | 50 | ∞ | ∞ |
| Mensajes IA/mes | 20 | 200 | 2.000 | ∞ |
| Plataformas | 1 | 3 | ∞ | ∞ |
| Templates | 3 | 20 | ∞ | ∞ |
| Reportes IA/mes | 0 | 5 | ∞ | ∞ |
| Price Advisor | ❌ | ❌ | ✅ | ✅ |
| Multi-modelo IA | ❌ | ❌ | ✅ | ✅ |
| Exportar datos | ❌ | CSV | CSV+JSON | CSV+JSON+API |

Los límites se aplican en los routers antes de cada mutación. Un `TRPCError` con código `FORBIDDEN` bloquea la operación y el frontend muestra un modal de upgrade.

---

## 7. Sistema de scoring de fans

El scoring es el corazón del producto. Se ejecuta de forma asíncrona vía worker.

### BehavioralSignals (señales acumuladas)
```typescript
{
  messageCount, avgMessageLength, avgSentiment, sentimentTrend,
  avgPurchaseIntent, maxPurchaseIntent, topicFrequency,
  budgetMentions, lastMessageAt, avgTimeBetweenMessages, conversationCount
}
```

### ScoringResult (scores calculados)
- `engagementLevel` (0-100): combinación de frecuencia (25%), longitud (15%), sentimiento (20%), profundidad (15%), recencia (15%), conversaciones (10%)
- `paymentProbability` (0-100): intent (30%), budget mentions (20%), engagement (20%), momentum (15%), sentimiento (15%)
- `funnelStage`: avanza cuando paymentProbability supera umbrales (30%→interested, 50%→hot_lead, 70%→buyer, 85%→vip). **Nunca retrocede.**

### Notificaciones automáticas
- **Funnel advance**: cuando un fan sube de etapa
- **Payment probability spike**: cuando la probabilidad de pago sube ≥15 puntos

---

## 8. Sistema multi-modelo IA

Cada tarea puede usar un proveedor/modelo diferente:
- `suggestion` — Generar respuestas al fan
- `analysis` — Analizar sentimiento del mensaje
- `summary` — Resumir conversación
- `report` — Generar reporte detallado del fan
- `price_advice` — Recomendar precio

**Resolución de config** (`ai-config-resolver.ts`):
1. Assignment específico de tarea con su propia API key
2. Assignment específico de tarea usando la key por defecto
3. Config por defecto del creador

Las API keys se cifran con **AES-256-GCM** antes de guardar en DB (`src/lib/crypto.ts`). Se necesita `ENCRYPTION_KEY` en variables de entorno (64 chars hex = 32 bytes).

---

## 9. Seguridad implementada

- **Autenticación**: NextAuth JWT con `NEXTAUTH_SECRET`
- **Multi-tenancy**: `protectedProcedure` inyecta `creatorId`; todas las queries filtran por `creatorId`
- **Rate limiting**: Redis sorted sets. Configurado en registro (3/5min), auth (5/1min)
- **CSRF**: Verificación de `Origin` header en endpoints API
- **Cifrado en reposo**: API keys cifradas AES-256-GCM
- **Password hashing**: bcrypt con cost factor 12
- **Anti-enumeración**: `forgot-password` siempre retorna 200 independientemente de si el email existe
- **Ownership checks**: Verificación explícita en `conversations.create`, `messages.list`, `messages.addFanMessage`, `messages.addCreatorMessage`
- **TRPCError tipados**: Todos los errores usan `TRPCError` con códigos correctos (NOT_FOUND, FORBIDDEN, UNAUTHORIZED)
- **Headers de seguridad**: Configurados en `next.config.js`

---

## 10. Variables de entorno requeridas

```bash
# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/fanflow

# Auth
NEXTAUTH_URL=https://tu-dominio.com
NEXTAUTH_SECRET=string-aleatorio-largo

# Cifrado de API keys
ENCRYPTION_KEY=64-caracteres-hex

# Redis
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...

# Opcional
LOG_LEVEL=info  # debug | info | warn | error
```

---

## 11. Tests — Suite completa (367 tests)

**Configuración**: `vitest.config.ts` + `__tests__/setup.ts` (mocks de Redis, variables de entorno)

### Tests unitarios — Servicios
| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `unit/services/ai-analysis.test.ts` | 15 | Parsing JSON, code fences, thinking blocks, clamping, fallbacks |
| `unit/services/ai-config-resolver.test.ts` | 6 | Resolución por prioridad, descifrado de keys |
| `unit/services/ai-provider.test.ts` | 12 | Anthropic/OpenAI SDK calls, variants, stripThinkingBlocks, PROVIDER_MODELS |
| `unit/services/contact-report.test.ts` | 7 | Parsing, clamping, límites arrays, riskLevel, fallbacks |
| `unit/services/conversation-summary.test.ts` | 10 | Parsing, code fences, thinking blocks, nextSteps límite, fallbacks |
| `unit/services/price-advisor.test.ts` | 7 | Parsing, clamping precios/confianza, timing, fallbacks |
| `unit/services/proactive-actions.test.ts` | 15 | 5 tipos de acción, prioridad, displayName fallback |
| `unit/services/profile-updater.test.ts` | 8 | Signals, scores, notificaciones funnel/payment, scoring history cap |
| `unit/services/scoring.test.ts` | 33 | updateSignals (promedios, trend, topics, budget), calculateScores (engagement, payment, funnel, clamping, factors) |
| `unit/services/usage-limits.test.ts` | 20 | 4 planes, jerarquía, feature gating (priceAdvisor, multiModel) |

### Tests unitarios — Librerías
| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `unit/lib/constants.test.ts` | 10 | PLATFORM_TYPES, PLATFORM_LABELS, PLATFORM_OPTIONS, schemas Zod |
| `unit/lib/crypto.test.ts` | 14 | Encrypt/decrypt roundtrip, IV aleatorio, unicode, isEncrypted |

### Tests unitarios — Routers tRPC
| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `unit/routers/account.test.ts` | 7 | getProfile (columnas), deleteAccount (password, confirmación ELIMINAR) |
| `unit/routers/ai-config.test.ts` | 12 | Encrypt/masking API key, upsert, testConnection, multi-model, feature gating |
| `unit/routers/ai.test.ts` | 13 | Limit checks, config resolution, regenerate, report, price advice |
| `unit/routers/billing.test.ts` | 12 | Planes, Stripe checkout/portal, invoices, onboarding |
| `unit/routers/contacts.test.ts` | 11 | Filtros, paginación, create con limit check, update ownership |
| `unit/routers/conversations.test.ts` | 11 | Search in-memory, ownership, hasMoreMessages, status |
| `unit/routers/intelligence.test.ts` | 18 | Scoring, funnel distribution, export CSV/JSON por plan, notifications |
| `unit/routers/messages.test.ts` | 10 | Queue enqueue, timestamps, AI suggestion metadata |
| `unit/routers/platforms.test.ts` | 6 | Upsert (update vs insert), personality config, limit check |
| `unit/routers/templates.test.ts` | 13 | Filtros platform/category, CRUD, incrementUsage, categories |

### Tests de integración
| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `integration/auth.test.ts` | 11 | Password regex, rate limiting, tokens |
| `integration/api-register.test.ts` | 12 | Validación, rate limit, CSRF, email único, hash |
| `integration/api-forgot-password.test.ts` | 5 | Anti-enumeración, token expiration |
| `integration/api-reset-password.test.ts` | 8 | Token verification, password update, rate limit |
| `integration/api-health.test.ts` | 8 | Healthy/degraded, latency, HTTP 200/503 |
| `integration/middleware.test.ts` | 9 | Rutas públicas/protegidas, callbackUrl, token verification |
| `integration/stripe-webhook.test.ts` | 7 | Plan mapping, firma, transiciones de estado |
| `integration/worker.test.ts` | 10 | Config resolution, analysis, profile update, error handling |

**Comandos:**
```bash
npm run test           # Ejecutar todos
npm run test:watch     # Modo watch
npm run test:coverage  # Con cobertura v8
```

---

## 12. Git hooks y CI/CD

### Pre-commit (Husky + lint-staged)
Cada `git commit` ejecuta automáticamente los tests de los archivos `.test.ts` modificados.

Configurado en `package.json`:
```json
"lint-staged": {
  "**/*.test.ts": "vitest run --run"
}
```

### GitHub Actions (`.github/workflows/ci.yml`)
En cada push/PR a `main` se ejecutan en paralelo:
1. **Lint** — `next lint`
2. **TypeCheck** — `tsc --noEmit`
3. **Tests** — `vitest run` (367 tests, sin DB ni Redis reales)

Y solo si los 3 pasan:
4. **Build** — `next build`
5. **Docker Build** — verifica que la imagen construye

---

## 13. Onboarding de nuevos usuarios

Al registrarse, `onboardingCompleted = false`. El layout del dashboard redirige a `/onboarding`.

Wizard de 3 pasos:
1. **Plataforma**: Elegir red social + configurar personalidad (tono, estilo, objetivos)
2. **IA**: Elegir proveedor + introducir API key + probar conexión
3. **Primer contacto**: Añadir el primer fan

Al completar → `billing.completeOnboarding()` pone `onboardingCompleted = true`.

---

## 14. Billing y Stripe

### Flujo de upgrade
1. Usuario pulsa "Upgrade" → `billing.createCheckoutSession({ plan: "starter" | "pro" })`
2. Si no tiene `stripeCustomerId`, se crea en Stripe y se guarda en DB
3. Se crea una Checkout Session y se redirige a Stripe
4. Usuario paga → Stripe llama al webhook `POST /api/webhooks/stripe`
5. Webhook actualiza `subscriptionPlan`, `subscriptionStatus`, `stripeSubscriptionId`, `currentPeriodEnd`

### Webhook maneja estos eventos
- `checkout.session.completed` → activa suscripción
- `customer.subscription.updated` → sincroniza plan/estado
- `customer.subscription.deleted` → revierte a free
- `invoice.payment_failed` → pone `past_due` (muestra banner en dashboard)

### Portal de cliente
`billing.createPortalSession()` → redirige al Customer Portal de Stripe para gestionar suscripción.

---

## 15. Despliegue en producción (VPS con Portainer + Nginx Proxy Manager)

**Requisitos:** VPS (Ubuntu 22.04+, 2GB RAM+), Docker, acceso SSH, dominio propio.

### Servicios Docker
- `app` — Next.js en puerto 3000 (healthcheck `/api/health`)
- `worker` — BullMQ worker para análisis IA asincrónico
- `postgres` — PostgreSQL 16 (volumen persistente)
- `redis` — Redis 7 con AOF (volumen persistente)

### Preparación del VPS
1. SSH al VPS e instalar Docker + Docker Compose
2. Crear `/opt/fanflow` con el código del proyecto
3. Generar variables seguras:
   ```bash
   NEXTAUTH_SECRET=$(openssl rand -base64 32)
   ENCRYPTION_KEY=$(openssl rand -hex 32)
   POSTGRES_PASSWORD=$(openssl rand -base64 32)
   ```

### Despliegue con Portainer
1. Instalar Portainer: `docker run ... portainer/portainer-ce`
2. Acceder a `http://vps-ip:9000`
3. Crear Stack con `docker-compose.prod.yml`
4. Configurar variables de entorno (.env.prod)
5. Deploy → servicios arrancan con healthchecks

### Nginx Proxy Manager
1. Desplegar NPM en puerto 80/443
2. En NPM UI (`:81`), crear **Proxy Host:**
   - Domain: `fanflow.example.com`
   - Forward to: `app:3000`
   - SSL: Let's Encrypt (automático)
3. El tráfico HTTPS es manejado por NPM

### Post-deploy
```bash
# Ejecutar migraciones DB
docker compose exec app npm run db:push

# Verificar salud
curl https://fanflow.example.com/api/health

# Monitoring en Portainer + logs
docker compose logs -f app
```

### Webhooks de Stripe
En Stripe Dashboard, crear endpoint en `https://fanflow.example.com/api/webhooks/stripe` con eventos:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

**Ver `DEPLOYMENT.md` para instrucciones paso a paso completas.**

---

## 16. Tareas pendientes / Posibles mejoras

Estas funcionalidades **no están implementadas** pero el código tiene TODOs:

- [ ] **Email service**: `register` y `forgot-password` generan las URLs pero no envían emails. Integrar Resend, SendGrid o similar.
- [ ] **Email verification**: La tabla tiene `emailVerified` pero el flujo no fuerza verificar antes de acceder.
- [ ] **Cancel Stripe subscription on deleteAccount**: El router `account.deleteAccount` tiene un `TODO` para cancelar la suscripción de Stripe antes de borrar el cuenta.
- [ ] **E2E tests con Playwright**: Los tests actuales son unitarios/integración con mocks. Faltan tests de flujo completo en navegador real.
- [ ] **Business plan checkout**: Solo `starter` y `pro` tienen Price IDs. Business es custom/manual.

---

## 17. Patrones y convenciones importantes

- **Siempre usar `ctx.creatorId`** en queries para garantizar multi-tenancy. Nunca confiar en datos del frontend.
- **`TRPCError` para todos los errores** en routers. Nunca `throw new Error()`.
- **Constantes en `src/lib/constants.ts`**. No redefinir enums de plataforma o funnel stage en ningún otro lugar.
- **API keys siempre cifradas** antes de guardar. Siempre descifrar antes de usar. Nunca enviar la key real al frontend (enmascarar con `maskApiKey`).
- **Optimistic updates** en el frontend para operaciones frecuentes (enviar mensaje, crear contacto). Usar el patrón `onMutate` / `onSettled` con `utils.cancelQuery`.
- **Logs con `createChildLogger`** en servicios y routers. Nunca `console.log` en producción.
- **Worker asíncrono** para análisis IA. Nunca bloquear el request del usuario con operaciones de análisis.
