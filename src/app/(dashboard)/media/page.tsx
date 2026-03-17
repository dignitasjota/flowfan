"use client";

import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const mediaTypeLabels: Record<string, string> = {
  image: "Imagen",
  video: "Vídeo",
  gif: "GIF",
};

export default function MediaPage() {
  const [filter, setFilter] = useState<{ mediaType?: "image" | "video" | "gif"; categoryId?: string; search?: string }>({});
  const [showUploader, setShowUploader] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);

  const stats = trpc.media.getStats.useQuery(undefined, { retry: false });
  const categories = trpc.media.listCategories.useQuery();
  const items = trpc.media.list.useQuery({ ...filter, limit: 100 }, { retry: false });

  // Plan no lo permite
  if (items.error?.data?.code === "FORBIDDEN") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="text-lg font-medium text-white">Media Vault</p>
          <p className="mt-2 text-sm text-gray-400">
            Esta funcionalidad requiere el plan Starter o superior.
          </p>
          <a href="/billing" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Ver planes
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">Media Vault</h1>
          <p className="mt-1 text-sm text-gray-400">Biblioteca de contenido</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCategories(true)}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:text-white"
          >
            Categorías
          </button>
          <button
            onClick={() => setShowUploader(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + Subir
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats.data && (
        <div className="mt-4 flex gap-4">
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.totalFiles} archivos
          </span>
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.totalSizeMB} MB
          </span>
          {stats.data.mostSent && (
            <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
              Más enviado: {stats.data.mostSent.originalName} ({stats.data.mostSent.sendCount}x)
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Buscar..."
          value={filter.search ?? ""}
          onChange={(e) => setFilter({ ...filter, search: e.target.value || undefined })}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500"
        />
        <select
          value={filter.mediaType ?? ""}
          onChange={(e) => setFilter({ ...filter, mediaType: (e.target.value || undefined) as typeof filter.mediaType })}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
        >
          <option value="">Todos los tipos</option>
          <option value="image">Imágenes</option>
          <option value="video">Vídeos</option>
          <option value="gif">GIFs</option>
        </select>
        <select
          value={filter.categoryId ?? ""}
          onChange={(e) => setFilter({ ...filter, categoryId: e.target.value || undefined })}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
        >
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.data?.items.map((item) => (
          <button
            key={item.id}
            onClick={() => setShowDetail(item.id)}
            className="group relative aspect-square overflow-hidden rounded-lg border border-gray-800 bg-gray-900 hover:border-gray-600 transition-colors"
          >
            {item.thumbnailPath ? (
              <img
                src={`/api/media/${item.id}?thumb=1`}
                alt={item.originalName}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : item.mediaType === "video" ? (
              <div className="flex h-full w-full items-center justify-center bg-gray-800">
                <svg className="h-10 w-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gray-800">
                <span className="text-2xl">🖼️</span>
              </div>
            )}
            {/* Overlay */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="truncate text-xs text-white">{item.originalName}</p>
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <span>{mediaTypeLabels[item.mediaType]}</span>
                {item.sendCount > 0 && <span>· {item.sendCount} envíos</span>}
              </div>
            </div>
            {/* Tags badges */}
            {item.tags && item.tags.length > 0 && (
              <div className="absolute right-1 top-1">
                <span className="rounded bg-indigo-600/80 px-1 py-0.5 text-[9px] text-white">
                  {item.tags.length} tags
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {items.data?.items.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-lg text-gray-400">Sin contenido aún</p>
          <p className="mt-1 text-sm text-gray-600">Sube tu primer archivo para empezar</p>
          <button
            onClick={() => setShowUploader(true)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + Subir archivo
          </button>
        </div>
      )}

      {/* Upload modal */}
      {showUploader && (
        <UploadModal
          categories={categories.data ?? []}
          onClose={() => {
            setShowUploader(false);
            items.refetch();
            stats.refetch();
          }}
        />
      )}

      {/* Detail modal */}
      {showDetail && (
        <DetailModal
          mediaId={showDetail}
          categories={categories.data ?? []}
          onClose={() => {
            setShowDetail(null);
            items.refetch();
            stats.refetch();
          }}
        />
      )}

      {/* Categories modal */}
      {showCategories && (
        <CategoriesModal
          onClose={() => {
            setShowCategories(false);
            categories.refetch();
          }}
        />
      )}
    </div>
  );
}

// ==================== Upload Modal ====================

function UploadModal({
  categories,
  onClose,
}: {
  categories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const upload = async () => {
    setUploading(true);
    setError("");
    let done = 0;

    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      if (categoryId) form.append("categoryId", categoryId);
      if (tags) form.append("tags", tags);

      try {
        const res = await fetch("/api/media/upload", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Error al subir");
          break;
        }
      } catch {
        setError("Error de conexión");
        break;
      }

      done++;
      setProgress(Math.round((done / files.length) * 100));
    }

    setUploading(false);
    if (!error) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white">Subir archivos</h2>

        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-700 p-8 hover:border-indigo-500 transition-colors"
        >
          <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <p className="mt-2 text-sm text-gray-400">Arrastra archivos aquí o haz click</p>
          <p className="text-xs text-gray-600">JPG, PNG, GIF, WebP, MP4, MOV, WebM · Max 50MB</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
                <span className="truncate">{f.name}</span>
                <span className="text-gray-500">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
            ))}
          </div>
        )}

        {/* Options */}
        <div className="mt-4 flex gap-3">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
          >
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (separados por coma)"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500"
          />
        </div>

        {/* Progress */}
        {uploading && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-gray-800">
              <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-400">{progress}% completado</p>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cancelar
          </button>
          <button
            onClick={upload}
            disabled={files.length === 0 || uploading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {uploading ? "Subiendo..." : `Subir ${files.length} archivo${files.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Detail Modal ====================

function DetailModal({
  mediaId,
  categories,
  onClose,
}: {
  mediaId: string;
  categories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const item = trpc.media.getById.useQuery({ id: mediaId });
  const updateMutation = trpc.media.update.useMutation({ onSuccess: () => item.refetch() });
  const deleteMutation = trpc.media.delete.useMutation({ onSuccess: onClose });
  const [editTags, setEditTags] = useState<string | null>(null);

  if (!item.data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="rounded-xl bg-gray-900 p-8">
          <p className="text-sm text-gray-400">Cargando...</p>
        </div>
      </div>
    );
  }

  const data = item.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Preview */}
        <div className="flex justify-center rounded-lg bg-gray-800 p-2">
          {data.mediaType === "video" ? (
            <video
              src={`/api/media/${data.id}`}
              controls
              className="max-h-80 rounded"
            />
          ) : (
            <img
              src={`/api/media/${data.id}`}
              alt={data.originalName}
              className="max-h-80 rounded object-contain"
            />
          )}
        </div>

        {/* Info */}
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-white">{data.originalName}</h3>
          <div className="flex flex-wrap gap-2 text-xs text-gray-400">
            <span>{mediaTypeLabels[data.mediaType]}</span>
            <span>·</span>
            <span>{(data.fileSize / 1024 / 1024).toFixed(1)} MB</span>
            {data.width && data.height && (
              <>
                <span>·</span>
                <span>{data.width}×{data.height}</span>
              </>
            )}
            <span>·</span>
            <span>{data.sendCount} envíos</span>
          </div>

          {/* Category */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Categoría:</span>
            <select
              value={data.categoryId ?? ""}
              onChange={(e) =>
                updateMutation.mutate({
                  id: data.id,
                  categoryId: e.target.value || null,
                })
              }
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Tags:</span>
            {editTags === null ? (
              <div className="flex flex-wrap gap-1">
                {data.tags?.map((t) => (
                  <span key={t} className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">{t}</span>
                ))}
                <button
                  onClick={() => setEditTags(data.tags?.join(", ") ?? "")}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  editar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="tag1, tag2, tag3"
                />
                <button
                  onClick={() => {
                    updateMutation.mutate({
                      id: data.id,
                      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
                    });
                    setEditTags(null);
                  }}
                  className="text-xs text-green-400"
                >
                  ✓
                </button>
              </div>
            )}
          </div>

          {/* Send history */}
          {data.sends && data.sends.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 uppercase">Enviado a</p>
              <div className="mt-1 space-y-1">
                {data.sends.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded bg-gray-800 px-3 py-1.5 text-xs">
                    <span className="text-gray-300">{s.contact.displayName ?? s.contact.username}</span>
                    <span className="text-gray-500">{new Date(s.sentAt).toLocaleDateString("es-ES")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-between">
          <button
            onClick={() => {
              if (confirm("¿Eliminar este archivo?")) {
                deleteMutation.mutate({ id: data.id });
              }
            }}
            className="rounded-lg border border-red-800 px-3 py-2 text-sm text-red-400 hover:bg-red-900/20"
          >
            Eliminar
          </button>
          <button onClick={onClose} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Categories Modal ====================

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const categories = trpc.media.listCategories.useQuery();
  const createCat = trpc.media.createCategory.useMutation({ onSuccess: () => categories.refetch() });
  const deleteCat = trpc.media.deleteCategory.useMutation({ onSuccess: () => categories.refetch() });
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white">Categorías</h2>

        <div className="mt-4 space-y-2">
          {categories.data?.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded bg-gray-800 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color ?? "#6366f1" }} />
                <span className="text-sm text-white">{c.name}</span>
              </div>
              <button
                onClick={() => deleteCat.mutate({ id: c.id })}
                className="text-xs text-red-400 hover:text-red-300"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-9 cursor-pointer rounded border border-gray-700 bg-transparent"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nueva categoría"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500"
          />
          <button
            onClick={() => {
              if (name.trim()) {
                createCat.mutate({ name: name.trim(), color });
                setName("");
              }
            }}
            disabled={!name.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            +
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
