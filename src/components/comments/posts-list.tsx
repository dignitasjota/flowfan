"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type Props = {
  selectedPostId: string | null;
  onSelectPost: (id: string) => void;
};

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "📷",
  reddit: "👽",
  twitter: "🐦",
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  reddit: "Reddit",
  twitter: "Twitter",
};

export function PostsList({ selectedPostId, onSelectPost }: Props) {
  const [filter, setFilter] = useState<"all" | "unhandled">("unhandled");
  const [platform, setPlatform] = useState<
    "instagram" | "reddit" | "twitter" | undefined
  >(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const utils = trpc.useUtils();
  const posts = trpc.socialComments.listPosts.useQuery({
    onlyWithUnhandled: filter === "unhandled",
    platformType: platform,
  });
  const overview = trpc.socialComments.overview.useQuery();

  const createPost = trpc.socialComments.createPost.useMutation({
    onSuccess: () => {
      utils.socialComments.listPosts.invalidate();
      utils.socialComments.overview.invalidate();
      setShowCreate(false);
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Comentarios</h2>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            + Post
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-gray-800/60 p-2">
            <div className="text-base font-semibold text-white">
              {overview.data?.postsCount ?? "—"}
            </div>
            <div className="text-gray-400">Posts</div>
          </div>
          <div className="rounded-md bg-gray-800/60 p-2">
            <div className="text-base font-semibold text-white">
              {overview.data?.commentsCount ?? "—"}
            </div>
            <div className="text-gray-400">Total</div>
          </div>
          <div className="rounded-md bg-amber-500/10 p-2">
            <div className="text-base font-semibold text-amber-300">
              {overview.data?.unhandledCount ?? "—"}
            </div>
            <div className="text-amber-400/80">Pendientes</div>
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          <button
            onClick={() => setFilter("unhandled")}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
              filter === "unhandled"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800/60 text-gray-400 hover:text-white"
            )}
          >
            Pendientes
          </button>
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
              filter === "all"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800/60 text-gray-400 hover:text-white"
            )}
          >
            Todos
          </button>
        </div>

        <div className="mt-2 flex gap-1">
          <button
            onClick={() => setPlatform(undefined)}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              !platform
                ? "bg-gray-700 text-white"
                : "bg-gray-800/40 text-gray-500 hover:text-gray-300"
            )}
          >
            Todas
          </button>
          {(["instagram", "reddit", "twitter"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p === platform ? undefined : p)}
              className={cn(
                "rounded-md px-2 py-1 text-xs",
                platform === p
                  ? "bg-gray-700 text-white"
                  : "bg-gray-800/40 text-gray-500 hover:text-gray-300"
              )}
              title={PLATFORM_LABELS[p]}
            >
              {PLATFORM_ICONS[p]}
            </button>
          ))}
        </div>

        {showCreate && (
          <CreatePostForm
            onSubmit={(values) => createPost.mutate(values)}
            onCancel={() => setShowCreate(false)}
            submitting={createPost.isPending}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {posts.isLoading ? (
          <div className="p-4 text-sm text-gray-500">Cargando...</div>
        ) : posts.data && posts.data.length > 0 ? (
          posts.data.map((post) => {
            const selected = post.id === selectedPostId;
            const title = post.title?.trim() || post.content?.trim() || "(sin título)";
            const preview = title.slice(0, 80);
            return (
              <button
                key={post.id}
                onClick={() => onSelectPost(post.id)}
                className={cn(
                  "block w-full border-b border-gray-800/50 p-3 text-left transition hover:bg-gray-800/40",
                  selected && "bg-gray-800/70"
                )}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="text-sm">{PLATFORM_ICONS[post.platformType] ?? "🌐"}</span>
                  {post.unhandledCount > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
                      {post.unhandledCount}
                    </span>
                  )}
                </div>
                <div className="line-clamp-2 text-sm text-gray-200">{preview}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {post.commentsCount} comentarios
                </div>
              </button>
            );
          })
        ) : (
          <div className="p-6 text-center text-sm text-gray-500">
            <div className="mb-2 text-3xl">💬</div>
            <p className="mb-1">No hay posts con comentarios</p>
            <p className="text-xs">
              Conecta tu cuenta o crea un post manual para empezar.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CreatePostForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (values: {
    platformType: "instagram" | "reddit" | "twitter";
    title?: string;
    content?: string;
    url?: string;
  }) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [platformType, setPlatformType] = useState<
    "instagram" | "reddit" | "twitter"
  >("reddit");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  return (
    <div className="mt-3 rounded-md border border-gray-700 bg-gray-900/60 p-3">
      <select
        value={platformType}
        onChange={(e) =>
          setPlatformType(e.target.value as "instagram" | "reddit" | "twitter")
        }
        className="mb-2 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
      >
        <option value="reddit">Reddit</option>
        <option value="instagram">Instagram</option>
        <option value="twitter">Twitter</option>
      </select>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título"
        className="mb-2 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Contenido (opcional)"
        rows={2}
        className="mb-2 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (opcional)"
        className="mb-2 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
      />
      <div className="flex gap-2">
        <button
          onClick={() =>
            onSubmit({
              platformType,
              title: title || undefined,
              content: content || undefined,
              url: url || undefined,
            })
          }
          disabled={submitting}
          className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitting ? "Creando..." : "Crear"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
