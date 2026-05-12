import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import {
  oauthPendingFlows,
  socialAccounts,
} from "@/server/db/schema";
import { encrypt } from "@/lib/crypto";
import {
  exchangeTwitterCode,
  getTwitterMe,
} from "@/server/services/oauth-twitter";
import { exchangeInstagramCode } from "@/server/services/oauth-instagram";

function redirectWithError(request: NextRequest, msg: string) {
  return NextResponse.redirect(
    new URL(
      `/scheduler?oauth_error=${encodeURIComponent(msg)}`,
      request.url
    ),
    303
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (provider !== "twitter" && provider !== "instagram") {
    return redirectWithError(request, "Unknown provider");
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  if (error) {
    return redirectWithError(
      request,
      `${provider}: ${error} — ${searchParams.get("error_description") ?? ""}`
    );
  }
  if (!code || !state) {
    return redirectWithError(request, "Missing code or state");
  }

  // Resolve pending flow + validate not expired
  const pending = await db.query.oauthPendingFlows.findFirst({
    where: eq(oauthPendingFlows.state, state),
  });
  if (!pending) {
    return redirectWithError(request, "Invalid or expired state");
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await db
      .delete(oauthPendingFlows)
      .where(eq(oauthPendingFlows.id, pending.id));
    return redirectWithError(request, "OAuth flow expired, try again");
  }
  if (pending.provider !== provider) {
    return redirectWithError(request, "Provider mismatch");
  }

  // Consume the pending row immediately to avoid replay
  await db
    .delete(oauthPendingFlows)
    .where(eq(oauthPendingFlows.id, pending.id));

  try {
    if (provider === "twitter") {
      if (!pending.codeVerifier) {
        return redirectWithError(request, "Missing PKCE verifier");
      }
      const tokens = await exchangeTwitterCode({
        code,
        codeVerifier: pending.codeVerifier,
      });
      const me = await getTwitterMe(tokens.accessToken);
      await upsertNativeAccount({
        creatorId: pending.creatorId,
        platformType: "twitter",
        accountUsername: me.username,
        externalAccountId: me.id,
        oauthAccessToken: tokens.accessToken,
        oauthRefreshToken: tokens.refreshToken,
        oauthExpiresInSec: tokens.expiresInSec,
        oauthScopes: tokens.scope.split(" "),
      });
    } else {
      const tokens = await exchangeInstagramCode(code);
      await upsertNativeAccount({
        creatorId: pending.creatorId,
        platformType: "instagram",
        accountUsername: tokens.username,
        externalAccountId: tokens.igUserId,
        oauthAccessToken: tokens.accessToken,
        oauthRefreshToken: null,
        oauthExpiresInSec: tokens.expiresInSec,
        oauthScopes: [],
        metadata: { pageId: tokens.pageId, igUserId: tokens.igUserId },
      });
    }
  } catch (err) {
    return redirectWithError(request, (err as Error).message);
  }

  return NextResponse.redirect(
    new URL(
      `${pending.redirectAfter ?? "/scheduler"}?oauth_connected=${provider}`,
      request.url
    ),
    303
  );
}

async function upsertNativeAccount(args: {
  creatorId: string;
  platformType: "twitter" | "instagram";
  accountUsername: string;
  externalAccountId: string;
  oauthAccessToken: string;
  oauthRefreshToken: string | null;
  oauthExpiresInSec: number;
  oauthScopes: string[];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + args.oauthExpiresInSec * 1000);
  const encAccess = encrypt(args.oauthAccessToken);
  const encRefresh = args.oauthRefreshToken
    ? encrypt(args.oauthRefreshToken)
    : null;

  const existing = await db.query.socialAccounts.findFirst({
    where: and(
      eq(socialAccounts.creatorId, args.creatorId),
      eq(socialAccounts.platformType, args.platformType)
    ),
  });

  if (existing) {
    await db
      .update(socialAccounts)
      .set({
        connectionType: "native",
        accountUsername: args.accountUsername,
        externalAccountId: args.externalAccountId,
        encryptedOauthAccessToken: encAccess,
        encryptedOauthRefreshToken: encRefresh,
        oauthExpiresAt: expiresAt,
        oauthScopes: args.oauthScopes,
        encryptedCredentials: null,
        isActive: true,
        lastVerifiedAt: new Date(),
        lastErrorMessage: null,
        metadata: args.metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, existing.id));
  } else {
    await db.insert(socialAccounts).values({
      creatorId: args.creatorId,
      platformType: args.platformType,
      connectionType: "native",
      accountUsername: args.accountUsername,
      externalAccountId: args.externalAccountId,
      encryptedOauthAccessToken: encAccess,
      encryptedOauthRefreshToken: encRefresh,
      oauthExpiresAt: expiresAt,
      oauthScopes: args.oauthScopes,
      isActive: true,
      lastVerifiedAt: new Date(),
      metadata: args.metadata ?? {},
    });
  }
}
