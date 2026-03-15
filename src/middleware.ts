import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];
const AUTH_PATHS = ["/login", "/register"];
const ADMIN_PATHS = ["/admin"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always set pathname header
  const response = NextResponse.next();
  response.headers.set("x-next-pathname", pathname);

  // Check JWT token
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Protected routes: redirect to login if no session
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!isPublicPath && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin routes: require role === "admin"
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));
  if (isAdminPath) {
    if (!token || (token as any).role !== "admin") {
      return NextResponse.redirect(new URL("/conversations", request.url));
    }
  }

  // Auth routes: redirect to dashboard if already logged in
  const isAuthPath = AUTH_PATHS.some((p) => pathname.startsWith(p));
  if (isAuthPath && token) {
    return NextResponse.redirect(new URL("/conversations", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/onboarding/:path*",
    "/billing/:path*",
    "/conversations/:path*",
    "/contacts/:path*",
    "/settings/:path*",
    "/dashboard/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
