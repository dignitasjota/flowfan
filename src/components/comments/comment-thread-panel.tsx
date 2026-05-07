"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type Props = {
  postId: string;
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  reddit: "Reddit",
  twitter: "Twitter",
};

const VARIANT_COLORS: Record<string, string> = {
  casual: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  sales: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  retention: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export function CommentThreadPanel({ postId }: Props) {
  const utils = trpc.useUtils();
  const post = trpc.socialComments.getPost.useQuery({ id: postId });
  const comments = trpc.socialComments.listComments.useQuery({
    postId,
    onlyUnhandled: false,
  });

  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [variants, setVariants] = useState<
    { type: string; label: string; content: string }[] | null
  >(null);

  const suggest = trpc.socialComments.suggest.useMutation({
    onSuccess: (data) => {
      setVariants(data.variants);
    },
  });

  const reply = trpc.socialComments.replyToComment.useMutation({
    onSuccess: () => {
      utils.socialComments.listComments.invalidate({ postId });
      utils.socialComments.listPosts.invalidate();
      utils.socialComments.overview.invalidate();
      setReplyDraft("");
      setVariants(null);
    },
  });

  const markHandled = trpc.socialComments.markHandled.useMutation({
    onSuccess: () => {
      utils.socialComments.listComments.invalidate({ postId });
      utils.socialComments.listPosts.invalidate();
      utils.socialComments.overview.invalidate();
    },
  });

  const sortedComments = useMemo(() => comments.data ?? [], [comments.data]);
  const activeComment = sortedComments.find((c) => c.id === activeCommentId);

  function selectComment(id: string) {
    setActiveCommentId(id);
    setVariants(null);
    setReplyDraft("");
  }

  function applyVariant(content: string) {
    setReplyDraft(content);
  }

  function submitReply() {
    if (!activeCommentId || !replyDraft.trim()) return;
    reply.mutate({ commentId: activeCommentId, content: replyDraft.trim() });
  }

  if (post.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Cargando post...</div>;
  }
  if (!post.data) {
    return <div className="p-6 text-sm text-gray-500">Post no encontrado</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Post header */}
      <div className="border-b border-gray-800 bg-gray-900/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
          <span className="rounded-full bg-gray-800 px-2 py-0.5">
            {PLATFORM_LABELS[post.data.platformType] ?? post.data.platformType}
          </span>
          {post.data.url && (
            <Link
              href={post.data.url}
              target="_blank"
              className="text-indigo-400 hover:underline"
            >
              Ver original ↗
            </Link>
          )}
          <span className="ml-auto">
            {post.data.commentsCount} comentarios •{" "}
            <span className="text-amber-300">
              {post.data.unhandledCount} pendientes
            </span>
          </span>
        </div>
        {post.data.title && (
          <h3 className="text-base font-semibold text-white">
            {post.data.title}
          </h3>
        )}
        {post.data.content && (
          <p className="mt-1 line-clamp-3 text-sm text-gray-300">
            {post.data.content}
          </p>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Comment thread */}
        <div className="flex-1 overflow-y-auto p-4">
          {comments.isLoading ? (
            <div className="text-sm text-gray-500">Cargando...</div>
          ) : sortedComments.length === 0 ? (
            <div className="text-center text-sm text-gray-500">
              Aún no hay comentarios en este post.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedComments.map((c) => {
                const selected = c.id === activeCommentId;
                const isCreator = c.role === "creator";
                return (
                  <button
                    key={c.id}
                    onClick={() => selectComment(c.id)}
                    className={cn(
                      "block w-full rounded-lg border p-3 text-left transition",
                      isCreator
                        ? "ml-8 border-indigo-500/30 bg-indigo-500/5"
                        : "border-gray-800 bg-gray-900/40 hover:border-gray-700",
                      selected && "ring-1 ring-indigo-500"
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isCreator ? "text-indigo-300" : "text-gray-200"
                        )}
                      >
                        {isCreator ? "Tú" : c.authorDisplayName || c.authorUsername}
                      </span>
                      {!isCreator && c.authorContact && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                          Contacto
                        </span>
                      )}
                      {!isCreator && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            c.isHandled
                              ? "bg-gray-700 text-gray-400"
                              : "bg-amber-500/20 text-amber-300"
                          )}
                        >
                          {c.isHandled ? "Resuelto" : "Pendiente"}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-500">
                        {new Date(c.createdAt).toLocaleString("es-ES", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200">{c.content}</p>
                    {!isCreator && c.authorContact?.profile && (
                      <div className="mt-2 flex gap-2 text-xs text-gray-500">
                        <span>Eng: {c.authorContact.profile.engagementLevel}</span>
                        <span>•</span>
                        <span>Pago: {c.authorContact.profile.paymentProbability}</span>
                        <span>•</span>
                        <span>{c.authorContact.profile.funnelStage}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reply panel */}
        {activeComment && activeComment.role === "fan" && (
          <div className="w-96 border-l border-gray-800 bg-gray-900/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">Responder</h4>
              <button
                onClick={() => {
                  setActiveCommentId(null);
                  setReplyDraft("");
                  setVariants(null);
                }}
                className="text-xs text-gray-500 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mb-3 rounded-md bg-gray-800/60 p-2 text-xs">
              <div className="text-gray-400">
                {activeComment.authorDisplayName || activeComment.authorUsername}:
              </div>
              <div className="text-gray-200">{activeComment.content}</div>
            </div>

            <button
              onClick={() => suggest.mutate({ commentId: activeComment.id })}
              disabled={suggest.isPending}
              className="mb-3 w-full rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {suggest.isPending ? "Generando..." : "✨ Sugerir respuesta IA"}
            </button>

            {variants && (
              <div className="mb-3 space-y-2">
                {variants.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => applyVariant(v.content)}
                    className={cn(
                      "block w-full rounded-md border p-2 text-left text-xs transition hover:opacity-80",
                      VARIANT_COLORS[v.type] ?? VARIANT_COLORS.casual
                    )}
                  >
                    <div className="mb-1 font-semibold uppercase tracking-wide">
                      {v.label}
                    </div>
                    <div className="text-gray-200">{v.content}</div>
                  </button>
                ))}
              </div>
            )}

            <textarea
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder="Escribe tu respuesta pública..."
              rows={4}
              className="mb-2 w-full rounded-md border border-gray-700 bg-gray-800 p-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />

            <div className="flex gap-2">
              <button
                onClick={submitReply}
                disabled={!replyDraft.trim() || reply.isPending}
                className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {reply.isPending ? "Enviando..." : "Responder"}
              </button>
              <button
                onClick={() =>
                  markHandled.mutate({
                    id: activeComment.id,
                    isHandled: !activeComment.isHandled,
                  })
                }
                disabled={markHandled.isPending}
                className="rounded-md bg-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-50"
                title={
                  activeComment.isHandled
                    ? "Marcar como pendiente"
                    : "Marcar como resuelto"
                }
              >
                {activeComment.isHandled ? "Reabrir" : "✓ Resuelto"}
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              La respuesta se publicará en el hilo. Sin presión comercial; el AI
              está calibrado para tono público.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
