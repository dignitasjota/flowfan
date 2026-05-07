import {
  callAIProvider,
  stripThinkingBlocks,
  type AIConfig,
} from "./ai";
import { getLanguageInstruction } from "./language-utils";

export type SocialPlatform = "reddit" | "twitter" | "instagram";

export type ExtractedContent = {
  title: string | null;
  excerpt: string | null;
  content: string;
  url: string | null;
};

export type RedditDraft = {
  platform: "reddit";
  title: string;
  body: string;
};

export type TwitterDraft = {
  platform: "twitter";
  /** Single primary tweet (always ≤ 270 chars). */
  tweet: string;
  /** Optional thread continuation, each ≤ 270 chars. Empty array if not generated. */
  thread: string[];
};

export type InstagramDraft = {
  platform: "instagram";
  caption: string;
  hashtags: string[];
};

export type SocialDraft = RedditDraft | TwitterDraft | InstagramDraft;

export type GenerationResult = {
  drafts: SocialDraft[];
  tokensUsed: number;
};

const MAX_FETCH_BYTES = 500_000;

// ============================================================
// HTML extraction (no extra deps)
// ============================================================

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function pickBetween(
  html: string,
  openRe: RegExp,
  closeRe: RegExp
): string | null {
  const open = html.match(openRe);
  if (!open) return null;
  const start = (open.index ?? 0) + open[0].length;
  const close = html.slice(start).match(closeRe);
  if (!close) return null;
  const end = start + (close.index ?? 0);
  return html.slice(start, end);
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FanFlow/1.0; +https://flowfan.app)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < MAX_FETCH_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const html = new TextDecoder("utf-8", { fatal: false }).decode(
    chunks.length === 1 ? chunks[0] : concat(chunks)
  );

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 300) : null;

  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  const ogDesc = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  );
  const metaDesc = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  );

  const excerpt =
    decodeEntities(ogDesc?.[1] ?? metaDesc?.[1] ?? "").slice(0, 500) || null;

  // Try article > main > body in order
  let body =
    pickBetween(html, /<article[^>]*>/i, /<\/article>/i) ??
    pickBetween(html, /<main[^>]*>/i, /<\/main>/i) ??
    pickBetween(html, /<body[^>]*>/i, /<\/body>/i) ??
    html;

  // Pull paragraphs preferentially
  const paragraphs = Array.from(body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((m) => stripTags(m[1]))
    .filter((p) => p.length > 40)
    .slice(0, 25);

  const content = (paragraphs.length > 0 ? paragraphs.join("\n\n") : stripTags(body))
    .slice(0, 10_000);

  return {
    title: title ?? ogTitle?.[1] ?? null,
    excerpt,
    content,
    url,
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// ============================================================
// AI generation
// ============================================================

function buildPrompt(
  platforms: SocialPlatform[],
  language?: string
): string {
  const parts: string[] = [];
  parts.push(
    `Eres un social media manager experto. A partir del articulo o contenido proporcionado, crea adaptaciones para las plataformas indicadas. Cada plataforma tiene su tono y formato propio.

PLATAFORMAS A GENERAR: ${platforms.join(", ")}

REGLAS DE FORMATO (OBLIGATORIO):
- Devuelve SOLO un JSON valido con esta estructura, sin texto adicional ni explicaciones:
{
  "drafts": [
    ${platforms.includes("reddit") ? `{ "platform": "reddit", "title": "...", "body": "..." }` : ""}${platforms.length > 1 && platforms.includes("reddit") ? "," : ""}
    ${platforms.includes("twitter") ? `{ "platform": "twitter", "tweet": "...", "thread": ["...", "..."] }` : ""}${platforms.length > 1 && platforms.includes("twitter") ? "," : ""}
    ${platforms.includes("instagram") ? `{ "platform": "instagram", "caption": "...", "hashtags": ["#tag1", "#tag2"] }` : ""}
  ]
}

REGLAS POR PLATAFORMA:
- Reddit: titulo claro y atractivo (max 280 chars), cuerpo con valor real y conversacional (1500-3000 chars), usa parrafos cortos.
- Twitter/X: tweet principal corto y con hook (max 270 chars). Si el contenido lo justifica, anade 2-5 tweets de hilo (cada uno max 270 chars). Si no, devuelve thread vacio [].
- Instagram: caption envolvente (300-1500 chars), 5-10 hashtags relevantes y especificos. Hashtags en array separado, NO en el caption.

REGLAS GENERALES:
- No inventes datos que no esten en el contenido fuente.
- Mantente fiel al tema y al tono del contenido original.
- Cero clickbait barato.`
  );
  if (language) {
    parts.push(`\n${getLanguageInstruction(language)}`);
  }
  return parts.join("\n");
}

function buildUserMessage(content: ExtractedContent): string {
  const lines: string[] = [];
  if (content.title) lines.push(`TITULO ORIGINAL: ${content.title}`);
  if (content.url) lines.push(`URL: ${content.url}`);
  if (content.excerpt) lines.push(`RESUMEN: ${content.excerpt}`);
  lines.push(`\nCONTENIDO:\n${content.content}`);
  return lines.join("\n");
}

function tryParseDrafts(text: string): SocialDraft[] {
  const cleaned = stripThinkingBlocks(text);
  // Sometimes the model wraps in ```json fences
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : cleaned).trim();
  // Find first { and last } for tolerant parsing
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return [];
  const slice = raw.slice(firstBrace, lastBrace + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const drafts = (parsed as { drafts?: unknown[] }).drafts;
  if (!Array.isArray(drafts)) return [];

  const out: SocialDraft[] = [];
  for (const d of drafts) {
    if (!d || typeof d !== "object") continue;
    const obj = d as Record<string, unknown>;
    if (obj.platform === "reddit" && typeof obj.title === "string" && typeof obj.body === "string") {
      out.push({
        platform: "reddit",
        title: obj.title.slice(0, 300),
        body: obj.body.slice(0, 30_000),
      });
    } else if (obj.platform === "twitter" && typeof obj.tweet === "string") {
      const thread = Array.isArray(obj.thread)
        ? (obj.thread.filter((t) => typeof t === "string") as string[]).map(
            (t) => t.slice(0, 270)
          )
        : [];
      out.push({
        platform: "twitter",
        tweet: obj.tweet.slice(0, 270),
        thread,
      });
    } else if (obj.platform === "instagram" && typeof obj.caption === "string") {
      const hashtags = Array.isArray(obj.hashtags)
        ? (obj.hashtags.filter((h) => typeof h === "string") as string[])
            .map((h) => (h.startsWith("#") ? h : `#${h}`))
            .slice(0, 15)
        : [];
      out.push({
        platform: "instagram",
        caption: obj.caption.slice(0, 2200),
        hashtags,
      });
    }
  }
  return out;
}

export async function generatePostsForPlatforms(
  config: AIConfig,
  content: ExtractedContent,
  platforms: SocialPlatform[],
  options?: { language?: string }
): Promise<GenerationResult> {
  if (platforms.length === 0) {
    return { drafts: [], tokensUsed: 0 };
  }

  const systemPrompt = buildPrompt(platforms, options?.language);
  const userMessage = buildUserMessage(content);

  const result = await callAIProvider(
    config,
    systemPrompt,
    [{ role: "user", content: userMessage }],
    2048
  );

  const drafts = tryParseDrafts(result.text);

  return {
    drafts,
    tokensUsed: result.tokensUsed,
  };
}
