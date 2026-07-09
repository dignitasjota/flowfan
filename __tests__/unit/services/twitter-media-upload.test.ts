import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadTwitterMediaFromUrl } from "@/server/services/twitter-media-upload";

const originalFetch = global.fetch;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binRes(bytes: Uint8Array, status = 200): Response {
  return new Response(new Blob([bytes as BlobPart]), {
    status,
    headers: { "content-type": "application/octet-stream" },
  });
}

async function readCommand(call: unknown[]): Promise<string | null> {
  const init = call[1] as { body?: FormData };
  if (!init?.body) return null;
  return (init.body.get("command") as string | null) ?? null;
}

describe("uploadTwitterMediaFromUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("image: single-part upload, no chunking", async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff]); // jpeg-ish
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("https://cdn/")) return binRes(imageBytes);
      // multipart upload
      return jsonRes({ data: { id: "media-img-1" } });
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await uploadTwitterMediaFromUrl({
      accessToken: "tok",
      mediaUrl: "https://cdn/photo.jpg",
    });
    expect(result.mediaId).toBe("media-img-1");
    expect(result.sizeBytes).toBe(3);
    // Solo 2 llamadas: fetch source + multipart upload (no INIT/APPEND)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const commands = await Promise.all(
      fetchMock.mock.calls.slice(1).map(readCommand)
    );
    expect(commands).toEqual([null]); // upload sin "command" → single-part
  });

  it("video: chunked INIT → APPEND × N → FINALIZE → STATUS until succeeded", async () => {
    // ~10MB de "vídeo" para forzar 3 chunks de 4MB
    const videoBytes = new Uint8Array(10 * 1024 * 1024);
    let statusCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: FormData }) => {
      if (url.startsWith("https://cdn/")) return binRes(videoBytes);
      if (url.includes("command=STATUS")) {
        statusCalls++;
        return jsonRes({
          processing_info:
            statusCalls < 2
              ? { state: "in_progress", check_after_secs: 1 }
              : { state: "succeeded" },
        });
      }
      const cmd = init?.body?.get("command") as string | null;
      if (cmd === "INIT") return jsonRes({ data: { id: "media-vid-1" } });
      if (cmd === "APPEND") return new Response(null, { status: 204 });
      if (cmd === "FINALIZE") {
        return jsonRes({
          processing_info: { state: "pending", check_after_secs: 1 },
        });
      }
      throw new Error(`unexpected url=${url} command=${cmd}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = uploadTwitterMediaFromUrl({
      accessToken: "tok",
      mediaUrl: "https://cdn/clip.mp4",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.mediaId).toBe("media-vid-1");

    // Reconstruyo la secuencia de comandos: source + INIT + 3 APPEND + FINALIZE + ≥2 STATUS
    const commands: (string | null)[] = [];
    for (const call of fetchMock.mock.calls) {
      const url = call[0] as string;
      if (url.startsWith("https://cdn/")) {
        commands.push("source");
        continue;
      }
      if (url.includes("command=STATUS")) {
        commands.push("STATUS");
        continue;
      }
      commands.push(await readCommand(call));
    }
    expect(commands[0]).toBe("source");
    expect(commands[1]).toBe("INIT");
    expect(commands.filter((c) => c === "APPEND")).toHaveLength(3); // 10MB / 4MB → 3
    expect(commands.filter((c) => c === "FINALIZE")).toHaveLength(1);
    expect(commands.filter((c) => c === "STATUS").length).toBeGreaterThanOrEqual(1);
  });

  it("video: throws when processing reports failed", async () => {
    const videoBytes = new Uint8Array(1024);
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: FormData }) => {
      if (url.startsWith("https://cdn/")) return binRes(videoBytes);
      const cmd = init?.body?.get("command") as string | null;
      if (cmd === "INIT") return jsonRes({ data: { id: "media-fail" } });
      if (cmd === "APPEND") return new Response(null, { status: 204 });
      if (cmd === "FINALIZE") {
        return jsonRes({
          processing_info: {
            state: "failed",
            error: { message: "InvalidMedia" },
          },
        });
      }
      throw new Error("unexpected");
    });
    global.fetch = fetchMock as typeof global.fetch;

    await expect(
      uploadTwitterMediaFromUrl({
        accessToken: "tok",
        mediaUrl: "https://cdn/clip.mp4",
      })
    ).rejects.toThrow(/InvalidMedia|processing failed/i);
  });

  it("image >5MB throws a clear size error", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    global.fetch = vi.fn().mockResolvedValue(binRes(big)) as typeof global.fetch;
    await expect(
      uploadTwitterMediaFromUrl({
        accessToken: "tok",
        mediaUrl: "https://cdn/big.png",
      })
    ).rejects.toThrow(/5MB/);
  });
});
