import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración E2E con navegador real (Playwright).
 *
 * Opt-in: los tests apuntan a `E2E_BASE_URL` (default http://localhost:3000).
 * Levanta la app antes (`npm run dev` o `npm run build && npm run start`) con
 * Postgres + Redis, o deja que Playwright la arranque vía `webServer` poniendo
 * `E2E_WEB_SERVER=1` (usa `npm run start`, requiere un build previo).
 *
 * Setup:
 *   npm i -D @playwright/test   (ya está en devDependencies)
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Los tests que requieren sesión se saltan solos si no defines
 * `E2E_EMAIL` / `E2E_PASSWORD` (una cuenta de prueba ya verificada).
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_WEB_SERVER
    ? {
        command: "npm run start",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
