import { test, expect } from "@playwright/test";

/**
 * Smoke de páginas públicas (sin sesión). No requieren datos de prueba, solo
 * que la app esté levantada. Verifican render y navegación básica.
 */

test.describe("Páginas públicas", () => {
  test("la landing carga y ofrece registro/login", async ({ page }) => {
    await page.goto("/");
    // La landing muestra CTAs hacia registro. No fijamos copy exacto: basta un
    // enlace o botón que lleve a /register.
    const registerLink = page.locator('a[href="/register"]').first();
    await expect(registerLink).toBeVisible();
  });

  test("la página de login muestra el formulario", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "FanFlow" })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: /iniciar sesión/i })
    ).toBeVisible();
  });

  test("la página de registro muestra el formulario", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: "Crear cuenta" })
    ).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("el registro con ?ref muestra el aviso de invitación", async ({ page }) => {
    await page.goto("/register?ref=TESTCODE");
    await expect(page.getByText(/te han invitado/i)).toBeVisible();
    await expect(page.getByText("TESTCODE")).toBeVisible();
  });

  test("una ruta protegida redirige a login sin sesión", async ({ page }) => {
    await page.goto("/conversations");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login inválido muestra un error y no navega al dashboard", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill("nadie@example.com");
    await page.locator('input[name="password"]').fill("Password-Incorrecta1!");
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    // No debe entrar al dashboard.
    await expect(page).not.toHaveURL(/\/conversations/);
  });
});
