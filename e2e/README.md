# Tests E2E (Playwright)

Tests de flujo en **navegador real** (Chromium), complementarios a:

- los tests unitarios/integración con mocks en `__tests__/` (`npm test`)
- los tests E2E de base de datos real en `__tests__/e2e/` (SQL contra Postgres)

## Setup

```bash
# 1. Instalar el navegador (una vez)
npx playwright install chromium

# 2. Levantar la app con Postgres + Redis (en otra terminal)
docker compose -f docker-compose.dev.yml up -d
npm run dev            # o: npm run build && npm run start

# 3. Ejecutar los tests
npm run test:e2e       # headless
npm run test:e2e:ui    # modo UI interactivo
```

## Configuración

- `E2E_BASE_URL` — URL de la app (default `http://localhost:3000`).
- `E2E_WEB_SERVER=1` — deja que Playwright arranque la app con `npm run start`
  (requiere un build previo). Por defecto asume que ya la levantaste tú.
- `E2E_EMAIL` / `E2E_PASSWORD` — credenciales de una **cuenta de prueba ya
  verificada**. Sin ellas, los tests de `auth-flow.spec.ts` se saltan solos.

## Qué cubre

- `smoke.spec.ts` — páginas públicas (landing, login, registro), aviso de
  invitación con `?ref`, redirección de rutas protegidas a login, y que un
  login inválido no entra al dashboard. **No requieren cuenta de prueba.**
- `auth-flow.spec.ts` — login real → dashboard y navegación. **Requiere
  `E2E_EMAIL`/`E2E_PASSWORD`.**

## Notas

- Playwright NO se ejecuta con `npm test` (ese es Vitest). Usa `npm run test:e2e`.
- Los tests usan `.spec.ts`; Vitest solo recoge `__tests__/**/*.test.ts`, así que
  no hay colisión entre ambos runners.
- Los artefactos (`test-results/`, `playwright-report/`) están en `.gitignore`.
