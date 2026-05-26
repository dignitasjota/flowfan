import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "@/server/services/poll-retry";

const originalFetch = global.fetch;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("returns the response immediately on 2xx (no retry, no delay)", async () => {
    const mock = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    global.fetch = mock as typeof global.fetch;

    const res = await fetchWithRetry("https://x/api");
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("returns 4xx immediately without retrying (definitive error)", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    global.fetch = mock as typeof global.fetch;

    const res = await fetchWithRetry("https://x/api");
    expect(res.status).toBe(404);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx with backoff and returns success on a later attempt", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(new Response("nope", { status: 502 }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    global.fetch = mock as typeof global.fetch;

    const promise = fetchWithRetry("https://x/api", undefined, { baseDelayMs: 100 });
    // Avanza el backoff: 100ms + 200ms = 300ms
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("throws after maxAttempts when 5xx persists", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("down", { status: 500 }));
    global.fetch = mock as typeof global.fetch;

    const promise = fetchWithRetry("https://x/api", undefined, {
      maxAttempts: 3,
      baseDelayMs: 50,
    });
    promise.catch(() => {}); // suppress unhandled rejection while we tick
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).rejects.toThrow(/HTTP 500/);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("retries on network errors (fetch throws)", async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unreachable"))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    global.fetch = mock as typeof global.fetch;

    const promise = fetchWithRetry("https://x/api", undefined, { baseDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(500);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on AbortError (caller-initiated cancel)", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const mock = vi.fn().mockRejectedValue(abortErr);
    global.fetch = mock as typeof global.fetch;

    await expect(fetchWithRetry("https://x/api")).rejects.toThrow(/aborted/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("caps backoff at maxDelayMs", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("x", { status: 503 }));
    global.fetch = mock as typeof global.fetch;

    const promise = fetchWithRetry("https://x/api", undefined, {
      maxAttempts: 5,
      baseDelayMs: 10_000,
      maxDelayMs: 100, // cap absurdamente bajo
    });
    promise.catch(() => {});
    // Sin el cap el segundo intento esperaría 10s. Con cap 100ms, todos los
    // intentos completan dentro de 500ms.
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(5);
  });
});
