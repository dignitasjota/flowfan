# Error Handling - Fase 3

## 🎯 Mejoras Implementadas

### 1. Hook `useTrpcErrorHandler`
**Archivo:** `src/hooks/useTrpcErrorHandler.ts`

Hook centralizado para capturar y manejar errores tRPC:

```typescript
const { handleError } = useTrpcErrorHandler();

try {
  await mutation.mutateAsync(...)
} catch (error) {
  if (!handleError(error)) {
    // Error no fue manejado por el hook
    console.error("Custom error handling", error)
  }
}
```

**Errores manejados:**
- `FORBIDDEN` → Muestra modal de upgrade (límite excedido)
- `UNAUTHORIZED` → Redirige a login

### 2. Componentes Actualizados

#### `chat-panel.tsx`
- Captura errores en `suggest()`
- Captura errores en `regenerate()`
- Muestra modal si se alcanza límite de mensajes IA

#### `step-first-contact.tsx` (onboarding)
- Captura errores en `contacts.create()`
- Muestra error local si se alcanza límite de contactos
- Permite intentar de nuevo

### 3. Modal de Upgrade Mejorado

**Archivo:** `src/components/billing/upgrade-modal.tsx`

Mejoras visuales y funcionales:
- ✨ Animación de entrada (`zoom-in-95`)
- 🎨 Colores más llamativos (amber para límites)
- 💡 Sugerencia helpful
- 🎯 Z-index alta para siempre estar visible
- 📱 Responsive en móvil

```typescript
const { showUpgrade, hideUpgrade } = useUpgradeModal();

// Mostrar modal con mensaje personalizado
showUpgrade("Has alcanzado el límite de contactos (5 máximo)")
```

### 4. Provider Global (Opcional)

**Archivo:** `src/components/providers/TrpcErrorProvider.tsx`

Interceptor global para errores no capturados:
```typescript
<TrpcErrorProvider>
  {children}
</TrpcErrorProvider>
```

## 📋 Flujo de Error

```
Usuario intenta accióan que excede límite
       ↓
tRPC lanza error FORBIDDEN
       ↓
Componente captura error con try/catch
       ↓
handleError(error) chequea si es FORBIDDEN
       ↓
showUpgrade() abre modal
       ↓
Usuario ve mensaje claro y CTA a /billing
```

## 🧪 Cómo Testear

### Test 1: Límite de Contactos (Plan Free)
1. Crear usuario nuevo (plan Free = 5 contactos máximo)
2. Ir a `/onboarding` → Paso 3
3. Agregar 5 contactos exitosamente
4. Intentar agregar el 6to
5. **Esperado:** Modal de upgrade aparece

### Test 2: Límite de Mensajes IA
1. Crear usuario con plan Free (20 mensajes IA/mes máximo)
2. Ir a `/conversations`
3. Intentar generar 21 sugerencias
4. **Esperado:** Modal de upgrade aparece después del 20to

### Test 3: Error de Autenticación
1. Forzar logout desde DevTools (borrar cookie)
2. Intentar acceder a endpoint protegido
3. **Esperado:** Redirige automáticamente a `/login`

## 📝 Mensajes de Error Personalizados

Cada función de check en `usage-limits.ts` retorna mensajes claros:

```typescript
// Ejemplo de mensaje
"Has alcanzado el límite de 5 contactos en el plan free.
Actualiza tu plan para añadir más."
```

Estos mensajes se pasan directamente al modal.

## 🔄 Integración en Nuevos Componentes

Para cualquier componente que haga mutations:

```typescript
import { useTrpcErrorHandler } from "@/hooks/useTrpcErrorHandler";

export function MyComponent() {
  const { handleError } = useTrpcErrorHandler();
  const mutation = trpc.something.useMutation();

  const handleAction = async () => {
    try {
      await mutation.mutateAsync({...})
    } catch (error) {
      if (!handleError(error)) {
        // Tu lógica de error custom
      }
    }
  }
}
```

## ✅ Estado Actual

| Componente | Manejo de Errores |
|------------|------------------|
| chat-panel.tsx | ✅ Implementado |
| step-first-contact.tsx | ✅ Implementado |
| upgrade-modal.tsx | ✅ Mejorado |
| useTrpcErrorHandler | ✅ Creado |
| TrpcErrorProvider | ✅ Disponible (opcional) |

## 🚀 Próximas Mejoras (Opcional)

- [ ] Toast notifications para errores menores
- [ ] Analytics: Trackear cuando users alcanzan límites
- [ ] Sugerencias de qué hacer (mostrar plan recomendado)
- [ ] Email de notificación cuando se acerca límite
- [ ] Countdown visual antes de alcanzar límite
