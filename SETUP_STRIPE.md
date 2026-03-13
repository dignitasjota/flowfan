# Configuración de Stripe para Fase 3: Billing

## Pasos para habilitar pagos en FanFlow

### 1. Crear cuenta en Stripe

1. Ir a https://dashboard.stripe.com/register
2. Crear cuenta con tu email
3. Verificar email
4. Completar información de la empresa

### 2. Obtener API Keys

1. En Stripe Dashboard, ir a **Developers** > **API keys**
2. Copiar:
   - **Secret Key** (comienza con `sk_test_`)
   - **Publishable Key** (comienza con `pk_test_`)
3. Pegarlas en `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

### 3. Crear Productos y Precios

En Stripe Dashboard > **Products**:

#### Plan Starter ($15/mes)
1. Click **+ Add product**
2. Nombre: `FanFlow Starter`
3. Descripción: `Plan starter con 50 contactos y 200 mensajes IA/mes`
4. En "Pricing":
   - Seleccionar **Recurring**
   - Precio: `15` USD
   - Intervalo: **Monthly**
5. Click **Save product**
6. En la página del producto, copiar el **Price ID** (comienza con `price_`)
7. Pegarla en `.env` como `STRIPE_STARTER_PRICE_ID`

#### Plan Pro ($29/mes)
1. Click **+ Add product**
2. Nombre: `FanFlow Pro`
3. Descripción: `Plan pro con contactos ilimitados y 2,000 mensajes IA/mes`
4. En "Pricing":
   - Seleccionar **Recurring**
   - Precio: `29` USD
   - Intervalo: **Monthly**
5. Click **Save product**
6. Copiar el **Price ID**
7. Pegarla en `.env` como `STRIPE_PRO_PRICE_ID`

### 4. Configurar Webhook

1. En Stripe Dashboard, ir a **Developers** > **Webhooks**
2. Click **+ Add endpoint**
3. En "Endpoint URL", poner:
   - Dev local: `http://localhost:3000/api/webhooks/stripe`
   - Producción: `https://tu-dominio.com/api/webhooks/stripe`
4. En "Events to send", seleccionar:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. En la página del webhook, copiar el **Signing secret** (comienza con `whsec_`)
7. Pegarla en `.env` como `STRIPE_WEBHOOK_SECRET`

### 5. Sincronizar Base de Datos

```bash
# Ejecutar la migración para agregar columnas de Stripe
npm run db:push
```

O si prefieres hacer reset completo:

```bash
# Opción 1: Ejecutar la migración incremental (recomendado)
npm run db:push

# Opción 2: Reset completo (pierde datos)
psql -U fanflow -d fanflow < schema_complete.sql
```

### 6. Testear en Local

```bash
# Terminal 1: Escuchar webhooks de Stripe
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Copiar el signing secret que genera y pegar en .env como STRIPE_WEBHOOK_SECRET

# Terminal 2: Iniciar el app
npm run dev
```

### 7. Probar Checkout

1. Ir a http://localhost:3000/billing
2. Click en "Elegir Starter" o "Elegir Pro"
3. Usar tarjeta de prueba: `4242 4242 4242 4242`
4. Fecha cualquiera futura, CVC: 123
5. Completar el formulario
6. Después del checkout, verificar que:
   - La suscripción se crea en Stripe Dashboard
   - El plan se actualiza en la BD
   - El usuario es redirigido a `/billing?success=true`

## Archivos Modificados/Creados

### Nuevos archivos:
- `src/lib/stripe.ts` - Cliente Stripe lazy
- `src/server/services/usage-limits.ts` - Validación de límites por plan
- `src/server/api/routers/billing.ts` - Endpoints de billing
- `src/app/api/webhooks/stripe/route.ts` - Webhook handler
- `src/components/billing/` - Componentes de billing
- `src/components/landing/` - Componentes de landing
- `src/components/onboarding/` - Componentes de onboarding
- `drizzle/0001_add_stripe_billing.sql` - Migración Drizzle
- `schema_complete.sql` - Schema completo para nuevas instalaciones

### Archivos modificados:
- `src/server/db/schema.ts` - Nuevas columnas en creators
- `src/lib/env.ts` - Variables de Stripe
- `.env.example` - Placeholder para variables
- `.env` - Variables locales
- `src/server/api/root.ts` - Registro del billing router
- `src/server/api/routers/*.ts` - Integración de límites
- `src/app/page.tsx` - Landing pública
- `src/app/(dashboard)/layout.tsx` - Onboarding redirect + modal + banner
- `src/components/layout/sidebar.tsx` - Link a Billing
- `src/app/(auth)/register/page.tsx` - Auto-login
- `src/components/conversations/chat-panel.tsx` - Indicador uso

## Variables de Entorno Finales

```env
# Database
DATABASE_URL=postgresql://fanflow:fanflow_secret@localhost:5432/fanflow

# Redis
REDIS_URL=redis://localhost:6379

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...

# Stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
```

## Problemas Comunes

### "No API key provided"
- Verificar que `STRIPE_SECRET_KEY` está en `.env`
- Debe ser una key en modo **test** (comienza con `sk_test_`)

### Webhook no recibe eventos
- En local, ejecutar `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Copiar el signing secret y pegar en `STRIPE_WEBHOOK_SECRET`
- En producción, el webhook debe ser accesible públicamente (https)

### Plan no actualiza después de checkout
- Verificar que el webhook recibió el evento en Stripe CLI
- Revisar logs de la app: `npm run dev`
- Confirmar que `STRIPE_WEBHOOK_SECRET` es correcto

## Próximos Pasos

1. Implementar email de confirmación de pago
2. Agregar CVC/CVV a Customer Portal
3. Implementar trials gratis
4. Crear dashboard de uso en tiempo real
5. Notificaciones cuando se acerca límite de uso
