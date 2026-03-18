# FanFlow v2 — Roadmap de Mejoras

## Estado Actual (Completado)

- **Fase 1-2-4**: Core features (conversaciones, IA multi-provider, scoring, contactos, templates, reportes, price advisor)
- **Fase 3**: SaaS completo (billing Stripe, límites por plan, landing, onboarding)
- **Admin Panel**: Superadmin con SEO config, auditoría, estadísticas globales
- **Producción**: Docker + Portainer + Nginx Proxy Manager en VPS

---

## Mejoras Propuestas

### Impacto Alto (Diferenciadores Clave)

---

### Fase 5: Team Management (Chatters)

**Prioridad**: 🔴 Alta
**Justificación**: Impacta el middleware de auth que afecta a todo lo demás. Desbloquea el plan Business de verdad.

**Descripción**: Permitir que un creator invite "chatters" (miembros de equipo) que pueden responder conversaciones en su nombre. Roles: owner, manager, chatter. Métricas de rendimiento por chatter.

**Schema nuevo**:
- `team_members` — Relación creator↔usuario con rol y permisos
- `team_invites` — Invitaciones por email con token y expiración (7 días)
- `conversation_assignments` — Asignación de conversaciones a chatters
- Columna `sent_by_id` en `messages` para tracking de quién escribió

**Cambio crítico — Auth middleware**:
- Agregar `activeCreatorId` al JWT (puede diferir de `id` si es chatter)
- `ctx.creatorId = activeCreatorId` y `ctx.actingUserId = user.id`
- Restricciones por rol:
  - `owner`: acceso total
  - `manager`: todo excepto billing, AI config, team management
  - `chatter`: solo conversaciones asignadas, enviar mensajes, ver sugerencias IA

**Servicios**:
- `src/server/services/team.ts` — Invitar, aceptar, remover, permisos, team switcher

**Router tRPC** (`src/server/api/routers/team.ts`):
- `getMembers`, `invite`, `revokeInvite`, `removeMember`, `updateMemberRole`
- `acceptInvite`, `getMyTeams`, `switchTeam`
- `assignConversation`, `unassignConversation`

**Modificaciones a routers existentes**:
- `conversations.list` → filtrar por asignación si es chatter
- `messages.addCreatorMessage` → guardar `sentById`, verificar asignación
- `contacts.create/update/delete` → solo owner/manager
- `billing.ts`, `ai-config.ts`, `platforms.ts` → solo owner

**UI**:
- `/team` — Gestión de equipo (lista, invitar, roles)
- `/invite/[token]` — Página pública para aceptar invitación
- `team-switcher.tsx` — Dropdown en sidebar para cambiar equipo
- `assignment-selector.tsx` — Asignar conversación a chatter
- `chat-panel.tsx` — Mostrar nombre del chatter en cada mensaje

**Plan gating**:

| Feature | Free | Starter | Pro | Business |
|---------|------|---------|-----|----------|
| Team members | 0 | 0 | 3 | 10 |
| Roles custom | ❌ | ❌ | ❌ | ✅ |
| Asignaciones | ❌ | ❌ | ✅ | ✅ |

---

### Fase 6: Integración Telegram Bot API

**Prioridad**: 🔴 Alta
**Justificación**: Elimina la fricción del copy-paste manual. Es la plataforma más fácil de integrar (API oficial, webhooks nativos). Habilita auto-respuestas reales.

**Descripción**: Integración bidireccional en tiempo real con Telegram. El creator conecta un bot, los fans escriben al bot, los mensajes aparecen en FanFlow automáticamente, y el creator responde desde FanFlow (o la IA auto-responde).

**Schema nuevo**:
- `telegram_bot_configs` — Config del bot por creator (token encriptado, webhookSecret, status, auto-reply settings)
- Columna `platform_user_id` en `contacts` (Telegram chat_id)
- Columnas `external_message_id` y `source` en `messages`

**Servicios**:
- `src/server/services/telegram.ts` — validateBotToken, setWebhook, deleteWebhook, sendMessage, parseIncomingUpdate
- `src/server/services/telegram-handler.ts` — handleIncomingMessage (busca/crea contacto, conversación, inserta mensaje, encola análisis + auto-reply)

**Webhook** (`src/app/api/webhooks/telegram/route.ts`):
- Ruta pública, validada por `X-Telegram-Bot-Api-Secret-Token`
- Retorna 200 inmediatamente, procesamiento async

**Router tRPC** (`src/server/api/routers/telegram.ts`):
- `connect`, `disconnect`, `getStatus`, `updateSettings`, `testConnection`

**Colas BullMQ nuevas**:
- `telegram-outgoing` — Enviar mensaje del creator via bot
- `telegram-auto-reply` — IA genera + envía respuesta automática

**Modificaciones**:
- `messages.addCreatorMessage` → si conversación es Telegram, encolar envío via bot
- `chat-panel.tsx` → badge "Telegram" en conversaciones live, indicador auto-reply

**UI**:
- `src/components/settings/telegram-settings.tsx` — Conectar bot, estado, toggle auto-reply
- Sección nueva en `/settings`

**Plan gating**:

| Feature | Free | Starter | Pro | Business |
|---------|------|---------|-----|----------|
| Telegram Bot | ❌ | ❌ | ✅ | ✅ |
| Auto-reply IA | ❌ | ❌ | ✅ (con límite msg) | ✅ (ilimitado) |

---

### Fase 7: Mass Messaging / Broadcasts

**Prioridad**: 🔴 Alta
**Justificación**: Herramienta de monetización #1 para creadores. Envío masivo a segmentos de fans. Depende de Telegram para envío automático.

**Descripción**: Crear broadcasts seleccionando un segmento de contactos (por tags, funnel stage, plataforma, engagement), componer mensaje con variables, y enviar masivamente. Para Telegram: envío automático via bot. Para otras plataformas: lista de mensajes para copiar manualmente.

**Schema nuevo**:
- `broadcasts` — Broadcast principal con contenido, filtros, status, stats
- `broadcast_recipients` — Destinatarios individuales con status de envío

**Servicios**:
- `src/server/services/broadcast.ts` — resolveSegment, resolveVariables ({{displayName}}, {{username}}), createBroadcastRecipients
- `src/server/services/broadcast-sender.ts` — Envío real por Telegram o marcado manual

**Colas BullMQ nuevas**:
- `broadcast-processing` — Resuelve segmento, crea recipients, encola envíos individuales
- `broadcast-send` — Envía 1 mensaje individual (rate limited: 30/s para Telegram)

**Router tRPC** (`src/server/api/routers/broadcasts.ts`):
- `list`, `getById`, `create`, `previewSegment`, `send`, `schedule`, `cancel`, `duplicate`

**UI**:
- `/broadcasts` — Lista de broadcasts con estado y stats
- `/broadcasts/new` — Wizard de 3 pasos:
  1. Seleccionar segmento (filtros visuales)
  2. Componer mensaje (editor con variables + preview en tiempo real)
  3. Revisar y enviar/programar
- `segment-builder.tsx` — Filtros por tags, funnel, plataforma, engagement
- `message-composer.tsx` — Editor con variables insertables
- `broadcast-stats.tsx` — Barra de progreso sent/failed/pending
- Agregar "Broadcasts" al sidebar

**Plan gating**:

| Feature | Free | Starter | Pro | Business |
|---------|------|---------|-----|----------|
| Broadcasts/mes | 0 | 2 | 10 | ∞ |
| Max recipients | 0 | 25 | 500 | ∞ |
| Programación | ❌ | ❌ | ✅ | ✅ |

---

### Impacto Medio (Mejoras Competitivas)

---

### Fase 8: Revenue Tracking por Fan

**Prioridad**: 🟡 Media
**Justificación**: El scoring de "payment probability" es predictivo, pero falta el dato real. Saber exactamente cuánto ha gastado cada fan permite calcular ROI del tiempo de chat.

**Descripción**: Rastrear ingresos reales por fan: tips, PPV desbloqueados, suscripciones. Dashboard de revenue con métricas por contacto, por período y por plataforma.

**Funcionalidades**:
- Registro manual de transacciones (tip, PPV, suscripción, custom)
- Revenue por contacto con historial
- Revenue total del creator con gráficos temporales
- ROI por hora de chat (revenue / tiempo invertido)
- Integración con scoring existente (payment probability vs revenue real)

---

### Fase 9: Mensajes Programados

**Prioridad**: 🟡 Media
**Justificación**: Muy útil combinado con broadcasts. Los creadores trabajan en horarios irregulares pero los fans tienen picos de actividad predecibles.

**Descripción**: Programar mensajes individuales para enviar en horarios óptimos. Sugerencia automática de mejor horario basada en patrones de actividad del fan.

**Funcionalidades**:
- Programar mensaje individual con fecha/hora
- Cola BullMQ con delayed jobs
- Sugerencia de horario óptimo basada en historial de respuestas del fan
- Timezone del fan (detectado o manual)
- Vista de calendario con mensajes programados

---

### Fase 10: Media Vault / Biblioteca de Contenido

**Prioridad**: 🟡 Media
**Justificación**: Los creadores envían contenido repetidamente. Organizar fotos/videos, rastrear qué se envió a quién, evitar duplicados. Esencial para PPV management.

**Descripción**: Almacén de contenido multimedia organizado por tags y categorías. Tracking de envíos por contacto.

**Funcionalidades**:
- Upload de fotos/videos con tags y categorías
- Búsqueda y filtrado de contenido
- Tracking: qué contenido se envió a qué fan
- Prevención de duplicados (alerta si intentas enviar algo ya enviado)
- Integración con broadcasts (adjuntar media)
- Precios sugeridos por contenido (integrar con Price Advisor)
- Storage: S3/MinIO compatible

**Nota sobre almacenamiento — Plan de migración**:

Actualmente el Media Vault guarda archivos en el filesystem local del contenedor Docker (`/app/uploads/`) montado como volumen Docker. Esta solución es válida para volúmenes bajos-medios (<10-20GB).

Cuando el volumen crezca, hay dos opciones de migración preparadas:

**Opción A: MinIO (self-hosted S3) — Para cuando necesites más control**
- Añadir un contenedor MinIO al docker-compose:
  ```yaml
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
  ```
- Instalar SDK: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
- Cambiar `src/app/api/media/upload/route.ts`: reemplazar `writeFile()` por `s3.PutObject()`
- Cambiar `src/app/api/media/[id]/route.ts`: reemplazar `readFile()` por presigned URL de S3
- Ventaja: el navegador descarga directo de MinIO, FanFlow no hace de proxy
- Coste: solo el disco del VPS

**Opción B: Hetzner Object Storage — Para cuando quieras externalizar**
- ~€1/mes por 250GB, data centers EU (GDPR)
- Compatible con API S3, **mismo código que MinIO**
- Solo cambiar 3 env vars:
  ```
  S3_ENDPOINT=https://fsn1.your-objectstorage.com
  S3_REGION=fsn1
  S3_ACCESS_KEY=tu_key
  S3_SECRET_KEY=tu_secret
  S3_BUCKET=fanflow-media
  ```
- Para migrar archivos existentes: `mc mirror minio/fanflow-media hetzner/fanflow-media`

**Archivos a modificar cuando se migre (solo 2)**:
1. `src/app/api/media/upload/route.ts` — cambiar `writeFile()` por `s3.PutObject()`
2. `src/app/api/media/[id]/route.ts` — cambiar `readFile()` por `getSignedUrl()` (presigned URL)

**Cuándo migrar**: cuando el almacenamiento supere ~10GB o cuando notes que FanFlow va lento sirviendo archivos grandes (videos).

---

### Fase 11: Workflows / Automatizaciones

**Prioridad**: 🟡 Media
**Justificación**: El módulo de proactive actions ya genera sugerencias, pero no las ejecuta. Automatizar acciones reduce carga del creator.

**Descripción**: Reglas trigger→acción configurables por el creator.

**Ejemplos de reglas**:
- Si fan no responde en 3 días → enviar follow-up automático
- Si fan sube a VIP → enviar mensaje de bienvenida
- Si sentiment cae por debajo de umbral → alertar al creator
- Si fan menciona "price/precio" → sugerir oferta automáticamente
- Si nuevo contacto → enviar mensaje de bienvenida

**Funcionalidades**:
- Builder visual de reglas (trigger + condiciones + acción)
- Triggers: tiempo sin respuesta, cambio de funnel, sentiment change, keyword detectado, nuevo contacto
- Acciones: enviar mensaje, enviar template, crear notificación, asignar a chatter, cambiar tags
- Historial de ejecución de reglas
- Toggle on/off por regla

---

### Fase 12: Segmentación Avanzada de Fans

**Prioridad**: 🟡 Media
**Justificación**: Más allá del funnel stage, los creadores necesitan listas dinámicas basadas en criterios compuestos para targeting preciso en broadcasts.

**Descripción**: Crear segmentos guardados con filtros compuestos.

**Funcionalidades**:
- Listas dinámicas: gasto > €X AND activo en últimos 7 días AND plataforma = OnlyFans
- Listas estáticas: añadir/quitar contactos manualmente
- Segmentos predefinidos: "Fans calientes", "Inactivos 30d", "Top spenders"
- Integración directa con broadcasts
- Count en tiempo real de contactos por segmento

---

### Impacto Bajo-Medio (Nice to Have)

---

### Fase 13: A/B Testing de Mensajes

**Prioridad**: 🟢 Baja
**Justificación**: Dato interesante para optimizar conversiones, pero requiere volumen suficiente para ser estadísticamente significativo.

**Descripción**: Probar diferentes estilos de respuesta y medir cuál convierte mejor.

**Funcionalidades**:
- Crear variantes A/B de un mensaje o template
- Enviar aleatoriamente a segmentos iguales
- Medir: tasa de respuesta, sentiment del fan, conversión a compra
- Dashboard de resultados con significancia estadística
- Integración con el sistema de sugerencias IA (feedback loop)

---

### Fase 14: PWA / Mobile App

**Prioridad**: 🟢 Baja
**Justificación**: La app es responsive pero una PWA con push notifications sería un upgrade importante para creators que trabajan desde el móvil.

**Funcionalidades**:
- Service Worker para offline básico
- Push notifications (nuevo mensaje de fan, broadcast completado, alerta de scoring)
- Manifest.json para "Add to Home Screen"
- Optimización de UI para touch (swipe actions, bottom nav)

---

### Fase 15: Calendario de Contenido

**Prioridad**: 🟢 Baja
**Justificación**: Complementa media vault y broadcasts. Los creadores planifican posts y promociones con antelación.

**Funcionalidades**:
- Vista de calendario mensual/semanal
- Planificar posts, promociones y campañas de PPV
- Vincular con broadcasts programados
- Vincular con media vault
- Recordatorios y notificaciones

---

### Fase 16: Programa de Referidos

**Prioridad**: 🟢 Baja
**Justificación**: Crecimiento orgánico. Que creators inviten a otros creators a cambio de descuento o comisión.

**Funcionalidades**:
- Código/link de referido único por creator
- Descuento para el referido (primer mes gratis o % off)
- Comisión para el referrer (% del plan del referido durante X meses)
- Dashboard de referidos: invitados, convertidos, earnings
- Integración con Stripe (cupones automáticos)

---

## Resumen de Prioridades

| Fase | Feature | Impacto | Dependencias |
|------|---------|---------|-------------|
| 5 | Team Management | 🔴 Alto | Ninguna (hacer primero, impacta auth) |
| 6 | Telegram Bot | 🔴 Alto | Fase 5 (chatters pueden responder Telegram) |
| 7 | Broadcasts | 🔴 Alto | Fase 6 (envío automático por Telegram) |
| 8 | Revenue Tracking | 🟡 Medio | Ninguna |
| 9 | Mensajes Programados | 🟡 Medio | Fase 6 (envío por Telegram) |
| 10 | Media Vault | 🟡 Medio | Ninguna |
| 11 | Workflows | 🟡 Medio | Fase 6 + 7 (acciones automáticas) |
| 12 | Segmentación Avanzada | 🟡 Medio | Fase 7 (targeting para broadcasts) |
| 13 | A/B Testing | 🟢 Bajo | Fase 7 (broadcasts como canal) |
| 14 | PWA / Mobile | 🟢 Bajo | Ninguna |
| 15 | Calendario | 🟢 Bajo | Fase 10 (media vault) |
| 16 | Referidos | 🟢 Bajo | Fase 3 (billing/Stripe) ✅ ya existe |
