import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { db } from "@/server/db";
import { oauthPendingFlows } from "@/server/db/schema";
import {
  buildTwitterAuthorizationUrl,
  generatePkce,
} from "@/server/services/oauth-twitter";
import { buildInstagramAuthorizationUrl } from "@/server/services/oauth-instagram";

const STATE_TTL_MIN = 10;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (provider !== "twitter" && provider !== "instagram") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(
      new URL("/login", request.url),
      303
    );
  }
  const creatorId =
    session.user.activeCreatorId ?? session.user.id;

  try {
    const state = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + STATE_TTL_MIN * 60_000);

    let authUrl: string;
    let codeVerifier: string | null = null;

    if (provider === "twitter") {
      const pkce = generatePkce();
      codeVerifier = pkce.verifier;
      authUrl = buildTwitterAuthorizationUrl({
        state,
        codeChallenge: pkce.challenge,
      });
    } else {
      authUrl = buildInstagramAuthorizationUrl(state);
    }

    await db.insert(oauthPendingFlows).values({
      state,
      creatorId,
      provider,
      codeVerifier,
      expiresAt,
    });

    return NextResponse.redirect(authUrl, 303);
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.redirect(
      new URL(
        `/scheduler?oauth_error=${encodeURIComponent(msg)}`,
        request.url
      ),
      303
    );
  }
}
