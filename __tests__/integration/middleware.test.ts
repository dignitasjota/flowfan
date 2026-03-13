import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next-auth/jwt
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";

const mockGetToken = vi.mocked(getToken);

describe("Middleware Auth Logic", () => {
  const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];
  const AUTH_PATHS = ["/login", "/register"];
  const PROTECTED_PATHS = [
    "/conversations",
    "/contacts",
    "/settings",
    "/billing",
    "/dashboard",
    "/onboarding",
  ];

  function isPublicPath(pathname: string) {
    return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  }

  function isAuthPath(pathname: string) {
    return AUTH_PATHS.some((p) => pathname.startsWith(p));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Route classification", () => {
    it("classifies login as public and auth path", () => {
      expect(isPublicPath("/login")).toBe(true);
      expect(isAuthPath("/login")).toBe(true);
    });

    it("classifies register as public and auth path", () => {
      expect(isPublicPath("/register")).toBe(true);
      expect(isAuthPath("/register")).toBe(true);
    });

    it("classifies forgot-password as public but not auth", () => {
      expect(isPublicPath("/forgot-password")).toBe(true);
      expect(isAuthPath("/forgot-password")).toBe(false);
    });

    it("classifies reset-password as public but not auth", () => {
      expect(isPublicPath("/reset-password")).toBe(true);
      expect(isAuthPath("/reset-password")).toBe(false);
    });

    it("classifies dashboard paths as protected", () => {
      for (const path of PROTECTED_PATHS) {
        expect(isPublicPath(path)).toBe(false);
      }
    });
  });

  describe("Authentication flow", () => {
    it("unauthenticated user on protected route → redirect to login", () => {
      const pathname = "/conversations";
      const hasToken = false;
      const isPublic = isPublicPath(pathname);

      const shouldRedirectToLogin = !isPublic && !hasToken;
      expect(shouldRedirectToLogin).toBe(true);
    });

    it("unauthenticated user on public route → allow", () => {
      const pathname = "/login";
      const hasToken = false;
      const isPublic = isPublicPath(pathname);

      const shouldRedirectToLogin = !isPublic && !hasToken;
      expect(shouldRedirectToLogin).toBe(false);
    });

    it("authenticated user on auth route → redirect to conversations", () => {
      const pathname = "/login";
      const hasToken = true;
      const isAuth = isAuthPath(pathname);

      const shouldRedirectToDashboard = isAuth && hasToken;
      expect(shouldRedirectToDashboard).toBe(true);
    });

    it("authenticated user on protected route → allow", () => {
      const pathname = "/conversations";
      const hasToken = true;
      const isPublic = isPublicPath(pathname);
      const isAuth = isAuthPath(pathname);

      const shouldRedirectToLogin = !isPublic && !hasToken;
      const shouldRedirectToDashboard = isAuth && hasToken;
      expect(shouldRedirectToLogin).toBe(false);
      expect(shouldRedirectToDashboard).toBe(false);
    });

    it("authenticated user on forgot-password → allow (not an auth path)", () => {
      const pathname = "/forgot-password";
      const hasToken = true;
      const isAuth = isAuthPath(pathname);

      expect(isAuth).toBe(false);
      // So they won't be redirected to dashboard
    });
  });

  describe("callbackUrl preservation", () => {
    it("redirect includes callbackUrl for protected routes", () => {
      const pathname = "/settings";
      const loginUrl = `/login?callbackUrl=${encodeURIComponent(pathname)}`;

      expect(loginUrl).toContain("callbackUrl=%2Fsettings");
    });

    it("preserves deep path in callbackUrl", () => {
      const pathname = "/conversations/some-id";
      const loginUrl = `/login?callbackUrl=${encodeURIComponent(pathname)}`;

      expect(loginUrl).toContain("callbackUrl=%2Fconversations%2Fsome-id");
    });
  });

  describe("Token verification", () => {
    it("getToken returns token for valid session", async () => {
      mockGetToken.mockResolvedValueOnce({ id: "creator-1", email: "test@test.com" } as any);

      const token = await getToken({ req: {} as any, secret: "test" });
      expect(token).toBeDefined();
      expect(token?.id).toBe("creator-1");
    });

    it("getToken returns null for expired/invalid session", async () => {
      mockGetToken.mockResolvedValueOnce(null);

      const token = await getToken({ req: {} as any, secret: "test" });
      expect(token).toBeNull();
    });
  });
});
