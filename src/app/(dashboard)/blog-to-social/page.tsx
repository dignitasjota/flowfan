"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PostComposer } from "@/components/scheduler/post-composer";

type Platform = "reddit" | "twitter" | "instagram";

type RedditDraft = { platform: "reddit"; title: string; body: string };
type TwitterDraft = { platform: "twitter"; tweet: string; thread: string[] };
type InstagramDraft = {
  platform: "instagram";
  caption: string;
  hashtags: string[];
};
type Draft = RedditDraft | TwitterDraft | InstagramDraft;

const PLATFORM_ICONS: Record<Platform, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  instagram: "Instagram",
};

type ComposerPreset = {
  title?: string;
  content: string;
  platform: Platform;
  redditUrl?: string;
  twitterTweet?: string;
  twitterThread?: string[];
};

export default function BlogToSocialPage() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Set<Platform>>(
    new Set(["reddit", "twitter"])
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [composerPreset, setComposerPreset] = useState<ComposerPreset | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const accounts = trpc.scheduler.listAccounts.useQuery();

  const extract = trpc.blogToSocial.extract.useMutation({
    onSuccess: (data) => {
      if (data.title) setTitle(data.title);
      if (data.excerpt) setExcerpt(data.excerpt);
      setContent(data.content);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const generate = trpc.blogToSocial.generate.useMutation({
    onSuccess: (data) => {
      setDrafts(data.drafts as Draft[]);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function runGenerate() {
    if (!content.trim() || content.length < 50) {
      setError("Pega contenido del blog (mínimo 50 caracteres) o usa Extraer.");
      return;
    }
    if (platforms.size === 0) {
      setError("Selecciona al menos una plataforma.");
      return;
    }
    generate.mutate({
      title: title.trim() || null,
      excerpt: excerpt ?? null,
      url: url.trim() || null,
      content: content.trim(),
      platforms: Array.from(platforms),
    });
  }

  function updateDraft(index: number, updated: Draft) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? updated : d)));
  }

  function openScheduler(d: Draft) {
    if (d.platform === "reddit") {
      setComposerPreset({
        title: d.title,
        content: d.body,
        platform: "reddit",
      });
    } else if (d.platform === "twitter") {
      const fullThread = [d.tweet, ...d.thread].filter(Boolean).join("\n\n");
      setComposerPreset({
        content: fullThread,
        platform: "twitter",
        twitterTweet: d.tweet,
        twitterThread: d.thread,
      });
    } else {
      const captionWithTags = `${d.caption}\n\n${d.hashtags.join(" ")}`.trim();
      setComposerPreset({
        content: captionWithTags,
        platform: "instagram",
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Blog-to-Social</h1>
        <p className="text-sm text-gray-400">
          Pega una URL o el texto de un artículo. La IA genera adaptaciones
          listas para Reddit, Twitter / X e Instagram.
        </p>
      </div>

      {/* Input panel */}
      <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            URL del blog (opcional)
          </span>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://miblog.com/articulo"
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={() => extract.mutate({ url: url.trim() })}
              disabled={!url.trim() || extract.isPending}
              className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50"
            >
              {extract.isPending ? "Extrayendo..." : "Extraer"}
            </button>
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Título
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título del artículo"
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Contenido del artículo
          </span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Pega aquí el cuerpo del artículo..."
            rows={8}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">
            {content.length} caracteres
          </span>
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Plataformas destino
          </span>
          <div className="flex flex-wrap gap-2">
            {(["reddit", "twitter", "instagram"] as const).map((p) => (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                  platforms.has(p)
                    ? "border-indigo-500 bg-indigo-500/20 text-white"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                )}
              >
                {PLATFORM_ICONS[p]} {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          onClick={runGenerate}
          disabled={generate.isPending}
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generate.isPending ? "Generando..." : "✨ Generar posts con IA"}
        </button>
      </div>

      {/* Drafts */}
      {drafts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">
            Drafts generados
          </h2>
          {drafts.map((d, i) => (
            <DraftCard
              key={`${d.platform}-${i}`}
              draft={d}
              onChange={(updated) => updateDraft(i, updated)}
              onSchedule={() => openScheduler(d)}
              onRegenerate={() => runGenerate()}
              regenerating={generate.isPending}
            />
          ))}
        </div>
      )}

      {composerPreset && (
        <PostComposer
          accounts={(accounts.data ?? []).map((a) => ({
            id: a.id,
            platformType: a.platformType,
            connectionType: a.connectionType,
            isActive: a.isActive,
            accountUsername: a.accountUsername,
          }))}
          onClose={() => setComposerPreset(null)}
          onCreated={() => {
            setComposerPreset(null);
          }}
          initialValues={{
            title: composerPreset.title,
            content: composerPreset.content,
            platforms: [composerPreset.platform],
            twitterTweet: composerPreset.twitterTweet,
            twitterThread: composerPreset.twitterThread,
          }}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft,
  onChange,
  onSchedule,
  onRegenerate,
  regenerating,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSchedule: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">
          {PLATFORM_ICONS[draft.platform]} {PLATFORM_LABELS[draft.platform]}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            ↻ Regenerar
          </button>
          <button
            onClick={onSchedule}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
          >
            📅 Programar
          </button>
        </div>
      </div>

      {draft.platform === "reddit" && (
        <div className="space-y-2">
          <input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-white"
          />
          <textarea
            value={draft.body}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            rows={10}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <div className="text-xs text-gray-500">
            {draft.title.length}/300 título · {draft.body.length} chars cuerpo
          </div>
        </div>
      )}

      {draft.platform === "twitter" && (
        <div className="space-y-2">
          <textarea
            value={draft.tweet}
            onChange={(e) => onChange({ ...draft, tweet: e.target.value })}
            rows={3}
            maxLength={270}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <div className="text-xs text-gray-500">
            {draft.tweet.length}/270 (tweet principal)
          </div>
          {draft.thread.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-gray-800 bg-gray-950/40 p-2">
              <div className="text-xs text-gray-400">
                Hilo ({draft.thread.length} tweets)
              </div>
              {draft.thread.map((t, idx) => (
                <textarea
                  key={idx}
                  value={t}
                  onChange={(e) => {
                    const nextThread = [...draft.thread];
                    nextThread[idx] = e.target.value;
                    onChange({ ...draft, thread: nextThread });
                  }}
                  rows={2}
                  maxLength={270}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {draft.platform === "instagram" && (
        <div className="space-y-2">
          <textarea
            value={draft.caption}
            onChange={(e) => onChange({ ...draft, caption: e.target.value })}
            rows={6}
            maxLength={2200}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <div className="text-xs text-gray-500">
            {draft.caption.length}/2200 caption
          </div>
          <div className="flex flex-wrap gap-1.5">
            {draft.hashtags.map((h, idx) => (
              <span
                key={idx}
                className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-300"
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
