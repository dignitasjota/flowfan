"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  /** Existing URLs (uploaded or pasted). Pipes back changes to the parent. */
  value: string[];
  onChange: (urls: string[]) => void;
  /** Max URLs allowed. Twitter caps at 4; Reddit/IG = 1. */
  max?: number;
  /** Tooltip / placeholder hint for the paste-URL input. */
  hint?: string;
};

const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";

export function MediaUploader({
  value,
  onChange,
  max = 4,
  hint = "Pega URL o sube una imagen",
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    if (value.length >= max) {
      setError(`Máx ${max} ${max === 1 ? "imagen" : "imágenes"}`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Upload failed (${res.status})`);
      }
      // The endpoint returns `mediaItem` or `{data: {url}}` depending on path.
      // Use publicUrl if present, otherwise build from storagePath.
      const url =
        data.publicUrl ??
        data.data?.url ??
        (data.storagePath ? `/api/media/${data.id}` : null);
      if (!url) {
        throw new Error("Upload succeeded but no public URL returned");
      }
      onChange([...value, url]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = ""; // allow re-selecting same file
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadFile(file);
  }

  function addPasteUrl() {
    const trimmed = pasteUrl.trim();
    if (!trimmed.startsWith("http")) {
      setError("La URL debe empezar por http");
      return;
    }
    if (value.length >= max) {
      setError(`Máx ${max} ${max === 1 ? "imagen" : "imágenes"}`);
      return;
    }
    onChange([...value, trimmed]);
    setPasteUrl("");
    setError(null);
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-1.5">
      {/* Drop zone + button */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-md border border-dashed p-3 text-center transition",
          dragOver
            ? "border-indigo-500 bg-indigo-500/10"
            : "border-gray-700 bg-gray-900/40",
          uploading && "opacity-50"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={onPick}
          disabled={uploading || value.length >= max}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || value.length >= max}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {uploading ? "Subiendo..." : "📎 Subir imagen"}
        </button>
        <span className="ml-2 text-[11px] text-gray-500">
          o arrastra aquí (JPG/PNG/WebP/GIF, máx 8MB)
        </span>
      </div>

      {/* Paste URL */}
      <div className="flex gap-2">
        <input
          type="url"
          value={pasteUrl}
          onChange={(e) => setPasteUrl(e.target.value)}
          placeholder={hint}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPasteUrl();
            }
          }}
          className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={addPasteUrl}
          disabled={!pasteUrl.trim() || value.length >= max}
          className="rounded-md bg-gray-700 px-3 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
        >
          + URL
        </button>
      </div>

      {/* Uploaded thumbnails */}
      {value.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {value.map((url, i) => (
            <div
              key={i}
              className="group relative aspect-square overflow-hidden rounded-md border border-gray-700 bg-gray-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="upload preview"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0.3";
                }}
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
