import { describe, it, expect } from "vitest";
import { isVideoUrl, getVideoDuration } from "@/lib/media";

describe("getVideoDuration", () => {
  it("returns null in non-browser environments (no document)", async () => {
    // El test runner de unit no provee `document`; el helper defiende ese
    // path retornando null en lugar de intentar crear un <video>.
    expect(typeof document).toBe("undefined");
    const result = await getVideoDuration("https://cdn/clip.mp4");
    expect(result).toBeNull();
  });
});

describe("isVideoUrl", () => {
  it("detects common video extensions", () => {
    expect(isVideoUrl("https://cdn/foo.mp4")).toBe(true);
    expect(isVideoUrl("https://cdn/foo.mov")).toBe(true);
    expect(isVideoUrl("https://cdn/foo.m4v")).toBe(true);
    expect(isVideoUrl("https://cdn/foo.webm")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isVideoUrl("https://cdn/CLIP.MP4")).toBe(true);
  });

  it("returns false for image extensions", () => {
    expect(isVideoUrl("https://cdn/foo.jpg")).toBe(false);
    expect(isVideoUrl("https://cdn/foo.png")).toBe(false);
    expect(isVideoUrl("https://cdn/foo.webp")).toBe(false);
    expect(isVideoUrl("https://cdn/foo.gif")).toBe(false);
  });

  it("handles trailing query strings and fragments", () => {
    expect(isVideoUrl("https://cdn/foo.mp4?token=abc")).toBe(true);
    expect(isVideoUrl("https://cdn/foo.mp4#start=10")).toBe(true);
  });

  it("returns false when the extension appears mid-path but not at the end", () => {
    expect(isVideoUrl("https://cdn/mp4-encoder/result.jpg")).toBe(false);
  });

  it("returns false on extension-less URLs", () => {
    expect(isVideoUrl("https://cdn/no-extension")).toBe(false);
  });
});
