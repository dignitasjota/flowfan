import { describe, it, expect } from "vitest";
import { bufferMatchesMime } from "@/lib/file-magic";

describe("bufferMatchesMime", () => {
  it("validates JPEG (FF D8 FF)", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(bufferMatchesMime(jpeg, "image/jpeg")).toBe(true);
    expect(bufferMatchesMime(jpeg, "image/png")).toBe(false);
  });

  it("validates PNG signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(bufferMatchesMime(png, "image/png")).toBe(true);
    expect(bufferMatchesMime(png, "image/jpeg")).toBe(false);
  });

  it("validates GIF87a and GIF89a", () => {
    const gif87 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0]);
    const gif89 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0]);
    expect(bufferMatchesMime(gif87, "image/gif")).toBe(true);
    expect(bufferMatchesMime(gif89, "image/gif")).toBe(true);
    expect(bufferMatchesMime(gif87, "image/png")).toBe(false);
  });

  it("validates WEBP with wildcard size bytes between RIFF and WEBP", () => {
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x12, 0x34, 0x56, 0x78, // size (wildcard)
      0x57, 0x45, 0x42, 0x50,
      0, 0,
    ]);
    expect(bufferMatchesMime(webp, "image/webp")).toBe(true);
    // RIFF + WAVE (audio) NO debe matchear webp
    const wav = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x12, 0x34, 0x56, 0x78,
      0x57, 0x41, 0x56, 0x45, // "WAVE"
    ]);
    expect(bufferMatchesMime(wav, "image/webp")).toBe(false);
  });

  it("validates MP4 ftyp signature at offset 4", () => {
    const mp4 = Buffer.from([
      0x00, 0x00, 0x00, 0x18, // box size
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      0x6d, 0x70, 0x34, 0x32, // brand
    ]);
    expect(bufferMatchesMime(mp4, "video/mp4")).toBe(true);
    expect(bufferMatchesMime(mp4, "video/quicktime")).toBe(true); // misma firma
    expect(bufferMatchesMime(mp4, "image/jpeg")).toBe(false);
  });

  it("validates WebM EBML header", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0]);
    expect(bufferMatchesMime(webm, "video/webm")).toBe(true);
    expect(bufferMatchesMime(webm, "video/mp4")).toBe(false);
  });

  it("returns true for unknown MIMEs (degradación segura — no podemos verificar)", () => {
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    expect(bufferMatchesMime(bytes, "application/pdf")).toBe(true);
  });

  it("returns false when the buffer is shorter than the signature", () => {
    const tiny = Buffer.from([0xff]);
    expect(bufferMatchesMime(tiny, "image/jpeg")).toBe(false);
  });

  it("blocks a PDF disguised as JPEG", () => {
    // PDF empieza con 25 50 44 46
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(bufferMatchesMime(pdf, "image/jpeg")).toBe(false);
  });
});
