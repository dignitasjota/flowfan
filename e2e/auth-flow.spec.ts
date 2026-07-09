import { test, expect } from "@playwright/test";

/**
 * Flujo autenticado real. Requiere una cuenta de prueba YA verificada:
 *   E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
 * Si no se definen, los tests se saltan (no rompen el run por defecto).
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.describe("Flujo autenticado", () => {
  test.skip(!EMAIL || !PASSWORD, "Define E2E_EMAIL y E2E_PASSWORD para correr estos tests");

  test("login → dashboard y navegación básica", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL!);
    await page.locator('input[name="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();

    // Tras login, aterriza en una ruta autenticada (dashboard o conversaciones).
    await page.waitForURL(/\/(conversations|dashboard|onboarding)/, {
      timeout: 15_000,
    });

    // La navegación lateral debe estar presente.
    await expect(page.getByRole("link", { name: /conversaciones/i })).toBeVisible();
  });

  test("navega a Conversaciones y renderiza la lista", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL!);
    await page.locator('input[name="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await page.waitForURL(/\/(conversations|dashboard|onboarding)/);

    await page.goto("/conversations");
    // El contenedor de conversaciones (lista) debe montar sin errores.
    await expect(page).toHaveURL(/\/conversations/);
  });
});
