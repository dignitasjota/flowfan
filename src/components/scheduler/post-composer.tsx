"use client";

import { useState } from "react";
import { cn, formatDateTimeLocal } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { trpc } from "@/lib/trpc";
import { PostPreview } from "@/components/scheduler/post-preview";
import { MediaUploader } from "@/components/scheduler/media-uploader";

type ConnectedAccount = {
  id?: string;
  platformType: string;
  connectionType: "native" | "webhook";
  isActive: boolean;
  accountUsername?: string | null;
};

type Props = {
  initialDate?: Date;
  accounts: ConnectedAccount[];
  onClose: () => void;
  onCreated: () => void;
  initialValues?: {
    title?: string;
    content?: string;
    platforms?: ("reddit" | "twitter" | "instagram")[];
    redditSubreddit?: string;
    twitterTweet?: string;
    twitterThread?: string[];
  };
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  instagram: "Instagram",
};

const PLATFORM_ICONS: Record<string, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
};

type RedditKind = "self" | "link" | "image" | "video" | "videogif";
type Frequency = "daily" | "weekly" | "monthly";

export function PostComposer({
  initialDate,
  accounts,
  onClose,
  onCreated,
  initialValues,
}: Props) {
  const defaultDate = initialDate ?? new Date(Date.now() + 60 * 60 * 1000);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [content, setContent] = useState(initialValues?.content ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialValues?.platforms ?? [])
  );
  const [scheduleAt, setScheduleAt] = useState(formatDateTimeLocal(defaultDate));
  const [subreddit, setSubreddit] = useState(
    initialValues?.redditSubreddit ?? ""
  );
  const [tweetMain, setTweetMain] = useState(initialValues?.twitterTweet ?? "");
  const [tweetThread, setTweetThread] = useState<string[]>(
    initialValues?.twitterThread ?? []
  );
  const [twitterMediaUrls, setTwitterMediaUrls] = useState<string[]>([]);
  const [redditKind, setRedditKind] = useState<RedditKind>("self");
  const [redditUrl, setRedditUrl] = useState("");
  const [redditImageUrls, setRedditImageUrls] = useState<string[]>([]);
  const [redditVideoUrls, setRedditVideoUrls] = useState<string[]>([]);
  const [redditPosterUrls, setRedditPosterUrls] = useState<string[]>([]);
  const [instagramImageUrls, setInstagramImageUrls] = useState<string[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [recFrequency, setRecFrequency] = useState<Frequency>("weekly");
  const [recDayOfWeek, setRecDayOfWeek] = useState(1);
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recHour, setRecHour] = useState(10);
  const [recMinute, setRecMinute] = useState(0);
  const [recUntil, setRecUntil] = useState("");
  const [recMaxCount, setRecMaxCount] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewPlatform, setPreviewPlatform] = useState<
    "reddit" | "twitter" | "instagram" | null
  >(null);
  // Multi-account: explicit account selection per platform. Empty string =
  // "first active" (the server resolves it).
  const [accountIdByPlatform, setAccountIdByPlatform] = useState<
    Record<string, string>
  >({});

  const create = trpc.scheduler.create.useMutation({
    onSuccess: () => {
      onCreated();
    },
    onError: (err) => setErrorMsg(err.message),
  });

  function togglePlatform(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function submit() {
    setErrorMsg(null);
    const platforms = Array.from(selected);
    if (platforms.length === 0) {
      setErrorMsg("Selecciona al menos una plataforma.");
      return;
    }
    const date = new Date(scheduleAt);
    if (Number.isNaN(date.getTime())) {
      setErrorMsg("Fecha inválida.");
      return;
    }

    const platformConfigs: Record<string, Record<string, unknown>> = {};
    // Inject explicit accountId for each selected platform if the user picked one
    for (const p of platforms) {
      const chosen = accountIdByPlatform[p];
      if (chosen) {
        platformConfigs[p] = { ...(platformConfigs[p] ?? {}), accountId: chosen };
      }
    }
    if (selected.has("reddit")) {
      if (!subreddit.trim()) {
        setErrorMsg("Especifica el subreddit destino.");
        return;
      }
      const isVideoKind =
        redditKind === "video" || redditKind === "videogif";
      const redditMediaUrl =
        redditKind === "image"
          ? redditImageUrls[0]
          : isVideoKind
          ? redditVideoUrls[0]
          : redditUrl.trim();
      if (
        (redditKind === "link" ||
          redditKind === "image" ||
          isVideoKind) &&
        !redditMediaUrl
      ) {
        setErrorMsg(
          redditKind === "link"
            ? "Pega la URL del enlace."
            : redditKind === "image"
            ? "Sube una imagen o pega una URL pública."
            : "Sube un vídeo o pega una URL pública."
        );
        return;
      }
      const redditPosterUrl = isVideoKind ? redditPosterUrls[0] : undefined;
      if (isVideoKind && !redditPosterUrl) {
        setErrorMsg(
          "Reddit necesita una imagen de portada (poster) para el vídeo."
        );
        return;
      }
      platformConfigs.reddit = {
        ...(platformConfigs.reddit ?? {}),
        subreddit: subreddit.trim(),
        kind: redditKind,
        ...(redditKind !== "self" ? { url: redditMediaUrl } : {}),
        ...(redditPosterUrl ? { posterUrl: redditPosterUrl } : {}),
      };
    }

    let twitterContentForFlatten: string | undefined;
    if (selected.has("twitter")) {
      const mainTweet = tweetMain.trim() || content.trim();
      if (!mainTweet) {
        setErrorMsg("Para Twitter / X necesitas al menos el tweet principal.");
        return;
      }
      const cleanThread = tweetThread
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const tooLong = [mainTweet, ...cleanThread].find((t) => t.length > 270);
      if (tooLong) {
        setErrorMsg(
          `Twitter/X limita a 270 caracteres por tweet. Hay un tweet con ${tooLong.length}.`
        );
        return;
      }
      const mediaList = twitterMediaUrls.slice(0, 4);
      platformConfigs.twitter = {
        ...(platformConfigs.twitter ?? {}),
        tweet: mainTweet,
        thread: cleanThread,
        ...(mediaList.length > 0 ? { mediaUrls: mediaList } : {}),
      };
      // Flatten for content fallback (other platforms / general consumers)
      twitterContentForFlatten = [mainTweet, ...cleanThread].join("\n\n");
    }

    if (selected.has("instagram")) {
      if (instagramImageUrls.length === 0) {
        setErrorMsg(
          "Instagram requiere una imagen o vídeo. Súbelo o pega una URL pública."
        );
        return;
      }
      if (instagramImageUrls.length > 10) {
        setErrorMsg("Instagram carrusel admite máximo 10 elementos.");
        return;
      }
      platformConfigs.instagram = {
        ...(platformConfigs.instagram ?? {}),
        mediaUrls: instagramImageUrls,
      };
    }

    let recurrenceRule:
      | {
          frequency: Frequency;
          hour: number;
          minute: number;
          dayOfWeek?: number;
          dayOfMonth?: number;
          until?: string;
          maxCount?: number;
        }
      | undefined;
    if (recurring) {
      recurrenceRule = {
        frequency: recFrequency,
        hour: recHour,
        minute: recMinute,
        ...(recFrequency === "weekly" ? { dayOfWeek: recDayOfWeek } : {}),
        ...(recFrequency === "monthly" ? { dayOfMonth: recDayOfMonth } : {}),
      };
      if (recUntil) {
        const u = new Date(recUntil);
        if (!Number.isNaN(u.getTime())) {
          recurrenceRule.until = u.toISOString();
        }
      }
      if (recMaxCount) {
        const n = Number(recMaxCount);
        if (Number.isFinite(n) && n >= 1) {
          recurrenceRule.maxCount = Math.floor(n);
        }
      }
    }

    const finalContent =
      content.trim() ||
      twitterContentForFlatten ||
      tweetMain.trim() ||
      "";
    if (!finalContent) {
      setErrorMsg("El contenido no puede estar vacío.");
      return;
    }

    create.mutate({
      title: title.trim() || undefined,
      content: finalContent,
      targetPlatforms: platforms as ("reddit" | "twitter" | "instagram")[],
      scheduleAt: date,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      mediaUrls: [],
      platformConfigs,
      recurrenceRule,
    });
  }

  const connectedSet = new Set(
    accounts.filter((a) => a.isActive).map((a) => a.platformType)
  );

  return (
    <Modal
      onClose={onClose}
      closeOnBackdrop={false}
      labelledBy="post-composer-title"
      className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl"
    >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="post-composer-title" className="text-lg font-semibold text-white">Programar publicación</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Multi-account selector: shows for any selected platform with >1 active accounts */}
        {Array.from(selected).map((rawPlatform) => {
          const platform = rawPlatform as "reddit" | "twitter" | "instagram";
          const platformAccounts = accounts.filter(
            (a) => a.isActive && a.platformType === platform && a.id
          );
          if (platformAccounts.length <= 1) return null;
          return (
            <label key={platform} className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-gray-400">
                Cuenta {PLATFORM_LABELS[platform]} ({platformAccounts.length} disponibles)
              </span>
              <select
                value={accountIdByPlatform[platform] ?? ""}
                onChange={(e) =>
                  setAccountIdByPlatform((prev) => ({
                    ...prev,
                    [platform]: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="">Primera disponible (auto)</option>
                {platformAccounts.map((a) => (
                  <option key={a.id} value={a.id ?? ""}>
                    @{a.accountUsername ?? "sin nombre"}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Plataformas destino
          </span>
          <div className="flex flex-wrap gap-2">
            {(["reddit", "twitter", "instagram"] as const).map((p) => {
              const connected = connectedSet.has(p);
              const isSelected = selected.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!connected}
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                    isSelected
                      ? "border-indigo-500 bg-indigo-500/20 text-white"
                      : connected
                      ? "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                      : "cursor-not-allowed border-gray-800 bg-gray-900 text-gray-600"
                  )}
                  title={connected ? "" : "Cuenta no conectada"}
                >
                  {PLATFORM_ICONS[p]} {PLATFORM_LABELS[p]}
                  {!connected && " · no conectada"}
                </button>
              );
            })}
          </div>
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">Título</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (obligatorio para Reddit)"
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Contenido
          </span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Escribe tu publicación..."
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">
            {content.length} caracteres
          </span>
        </label>

        {selected.has("reddit") && (
          <div className="mb-3 space-y-2 rounded-md border border-gray-800 bg-gray-950/40 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-400">
                Subreddit destino
              </span>
              <input
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
                placeholder="ej. AskReddit (sin r/)"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </label>

            <div>
              <span className="mb-1 block text-xs font-medium text-gray-400">
                Tipo de post
              </span>
              <div className="flex gap-1">
                {(["self", "link", "image", "video", "videogif"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRedditKind(k)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1 text-xs transition",
                      redditKind === k
                        ? "border-indigo-500 bg-indigo-500/20 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
                    )}
                  >
                    {k === "self"
                      ? "Texto"
                      : k === "link"
                      ? "Enlace"
                      : k === "image"
                      ? "Imagen"
                      : k === "video"
                      ? "Vídeo"
                      : "GIF"}
                  </button>
                ))}
              </div>
            </div>

            {redditKind === "link" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-400">
                  URL del enlace
                </span>
                <input
                  value={redditUrl}
                  onChange={(e) => setRedditUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                />
              </label>
            )}

            {redditKind === "image" && (
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-400">
                  Imagen
                </span>
                <MediaUploader
                  value={redditImageUrls}
                  onChange={setRedditImageUrls}
                  max={1}
                  hint="Pega URL pública o sube imagen"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Reddit requiere una URL pública (R2/CDN). Subir aquí la deja
                  accesible automáticamente.
                </span>
              </div>
            )}

            {(redditKind === "video" || redditKind === "videogif") && (
              <div className="space-y-2">
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-400">
                    {redditKind === "videogif" ? "Vídeo (GIF loop)" : "Vídeo"}
                  </span>
                  <MediaUploader
                    value={redditVideoUrls}
                    onChange={setRedditVideoUrls}
                    max={1}
                    kinds={["video"]}
                    hint="Pega URL pública o sube vídeo"
                    videoConstraints={
                      redditKind === "videogif"
                        ? { maxSec: 60, label: "Reddit GIF" }
                        : { maxSec: 900, label: "Reddit" }
                    }
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium text-gray-400">
                    Portada (poster)
                  </span>
                  <MediaUploader
                    value={redditPosterUrls}
                    onChange={setRedditPosterUrls}
                    max={1}
                    hint="JPG/PNG público o sube imagen"
                  />
                </div>
                <span className="mt-1 block text-xs text-gray-500">
                  {redditKind === "videogif"
                    ? "Modo GIF: Reddit reproduce el clip en loop sin audio. Ideal para clips ≤60s. La portada se exige por la API."
                    : "Reddit re-hostea el vídeo en su CDN automáticamente (asset lease + S3). La portada se exige por la API."}
                </span>
              </div>
            )}
          </div>
        )}

        {selected.has("twitter") && (
          <div className="mb-3 space-y-2 rounded-md border border-gray-800 bg-gray-950/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-300">
                🐦 Thread Twitter / X
              </span>
              <span className="text-xs text-gray-500">
                {tweetThread.length} tweets en hilo
              </span>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">
                Tweet principal
              </span>
              <textarea
                value={tweetMain}
                onChange={(e) => setTweetMain(e.target.value)}
                maxLength={270}
                rows={2}
                placeholder="Tu primer tweet (máx 270 chars)"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <span className="mt-0.5 block text-[10px] text-gray-500">
                {tweetMain.length}/270
              </span>
            </label>

            {tweetThread.length > 0 && (
              <div className="space-y-1.5">
                {tweetThread.map((t, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="mt-1 text-[10px] text-gray-500">
                      {idx + 2}/
                    </span>
                    <textarea
                      value={t}
                      onChange={(e) => {
                        const next = [...tweetThread];
                        next[idx] = e.target.value;
                        setTweetThread(next);
                      }}
                      maxLength={270}
                      rows={2}
                      placeholder={`Tweet ${idx + 2} del hilo`}
                      className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setTweetThread(
                          tweetThread.filter((_, i) => i !== idx)
                        )
                      }
                      className="mt-1 rounded p-1 text-gray-500 hover:bg-red-500/20 hover:text-red-300"
                      title="Eliminar tweet"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setTweetThread([...tweetThread, ""])}
              className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              + Añadir al hilo
            </button>

            <div className="mt-2">
              <span className="mb-1 block text-[11px] text-gray-500">
                Imágenes (máx 4) o 1 vídeo — se adjunta al tweet principal
              </span>
              <MediaUploader
                value={twitterMediaUrls}
                onChange={setTwitterMediaUrls}
                max={4}
                kinds={["image", "video"]}
                hint="Pega URL pública o sube imagen / vídeo"
                videoConstraints={{ maxSec: 140, label: "X / Twitter" }}
              />
              <span className="mt-0.5 block text-[10px] text-gray-500">
                Subida vía /2/media/upload (OAuth 2.0, scope media.write).
                Vídeo: chunked + polling de procesamiento. X no permite
                mezclar vídeo e imagen en el mismo tweet.
              </span>
            </div>

            <p className="text-[11px] text-gray-500">
              El payload del webhook <code>post.publishing</code> incluye
              <code> tweet </code>y<code> thread[] </code>para que Zapier /
              Make publiquen como hilo nativo en X.
            </p>
          </div>
        )}

        {selected.has("instagram") && (
          <div className="mb-3 space-y-2 rounded-md border border-gray-800 bg-gray-950/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-300">
                📷 Instagram — imagen, vídeo (Reel) o carrusel
              </span>
              <span className="text-[11px] text-gray-500">
                {instagramImageUrls.length}/10
              </span>
            </div>
            <MediaUploader
              value={instagramImageUrls}
              onChange={setInstagramImageUrls}
              max={10}
              kinds={["image", "video"]}
              hint="Pega URL pública o sube imagen / vídeo"
              videoConstraints={{ minSec: 3, maxSec: 90, label: "Reels" }}
            />
            <p className="text-[11px] text-gray-500">
              1 elemento = post único (foto) o Reel (vídeo 3-90s).
              2-10 elementos = carrusel (imágenes y/o vídeos mezclados). Todas
              las URLs deben ser públicas — R2 lo cumple automáticamente. El
              caption se toma del campo &quot;Contenido&quot; (máx 2200
              caracteres).
            </p>
          </div>
        )}

        {selected.size > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">
                Vista previa
              </span>
              <div className="flex gap-1">
                {Array.from(selected).map((p) => {
                  const platform = p as "reddit" | "twitter" | "instagram";
                  const active = previewPlatform === platform;
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() =>
                        setPreviewPlatform(active ? null : platform)
                      }
                      className={cn(
                        "rounded-md px-2 py-1 text-xs",
                        active
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-white"
                      )}
                    >
                      {platform}
                    </button>
                  );
                })}
              </div>
            </div>
            {previewPlatform && (
              <PostPreview
                platform={previewPlatform}
                title={title}
                content={content}
                redditSubreddit={subreddit}
                redditKind={redditKind === "videogif" ? "video" : redditKind}
                redditUrl={
                  redditKind === "image"
                    ? redditImageUrls[0]
                    : redditKind === "video" || redditKind === "videogif"
                    ? redditVideoUrls[0]
                    : redditUrl
                }
                twitterTweet={tweetMain}
                twitterThread={tweetThread}
              />
            )}
          </div>
        )}

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Programar para
          </span>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <div className="mb-4 rounded-md border border-gray-800 bg-gray-950/40 p-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
            />
            <span className="text-xs font-medium text-gray-300">
              Repetir publicación
            </span>
          </label>

          {recurring && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-1">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setRecFrequency(f)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1 text-xs",
                      recFrequency === f
                        ? "border-indigo-500 bg-indigo-500/20 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
                    )}
                  >
                    {f === "daily" ? "Diario" : f === "weekly" ? "Semanal" : "Mensual"}
                  </button>
                ))}
              </div>

              {recFrequency === "weekly" && (
                <select
                  value={recDayOfWeek}
                  onChange={(e) => setRecDayOfWeek(Number(e.target.value))}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                >
                  <option value={1}>Lunes</option>
                  <option value={2}>Martes</option>
                  <option value={3}>Miércoles</option>
                  <option value={4}>Jueves</option>
                  <option value={5}>Viernes</option>
                  <option value={6}>Sábado</option>
                  <option value={0}>Domingo</option>
                </select>
              )}

              {recFrequency === "monthly" && (
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={recDayOfMonth}
                  onChange={(e) => setRecDayOfMonth(Number(e.target.value))}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Día del mes (1-28)"
                />
              )}

              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={recHour}
                  onChange={(e) => setRecHour(Number(e.target.value))}
                  className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Hora"
                />
                <span className="self-center text-xs text-gray-500">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={recMinute}
                  onChange={(e) => setRecMinute(Number(e.target.value))}
                  className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Min"
                />
                <span className="self-center text-xs text-gray-500">UTC</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={recUntil}
                  onChange={(e) => setRecUntil(e.target.value)}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Hasta..."
                />
                <input
                  type="number"
                  min={1}
                  value={recMaxCount}
                  onChange={(e) => setRecMaxCount(e.target.value)}
                  className="w-24 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Nº veces"
                />
              </div>
              <span className="block text-xs text-gray-500">
                Sin fecha ni nº de veces, la serie se repite indefinidamente.
              </span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={create.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {create.isPending ? "Programando..." : "Programar"}
          </button>
        </div>
    </Modal>
  );
}
