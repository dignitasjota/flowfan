"use client";

import { cn } from "@/lib/utils";

type Platform = "reddit" | "twitter" | "instagram";

type Props = {
  platform: Platform;
  title?: string;
  content?: string;
  redditSubreddit?: string;
  redditKind?: "self" | "link" | "image";
  redditUrl?: string;
  twitterTweet?: string;
  twitterThread?: string[];
  authorHandle?: string;
};

const PLATFORM_LABEL: Record<Platform, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  instagram: "Instagram",
};

export function PostPreview({
  platform,
  title,
  content,
  redditSubreddit,
  redditKind = "self",
  redditUrl,
  twitterTweet,
  twitterThread,
  authorHandle = "@yourhandle",
}: Props) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/30 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>Vista previa · {PLATFORM_LABEL[platform]}</span>
        <span className="text-[10px] uppercase tracking-wider">aproximada</span>
      </div>

      {platform === "reddit" && (
        <RedditPreview
          subreddit={redditSubreddit || "subreddit"}
          title={title || "(sin título)"}
          content={content}
          kind={redditKind}
          url={redditUrl}
          author={authorHandle}
        />
      )}

      {platform === "twitter" && (
        <TwitterPreview
          tweet={twitterTweet || content?.split("\n\n")[0] || ""}
          thread={
            twitterThread && twitterThread.length > 0
              ? twitterThread
              : (content?.split("\n\n").slice(1) ?? [])
          }
          handle={authorHandle}
        />
      )}

      {platform === "instagram" && (
        <InstagramPreview content={content || ""} handle={authorHandle} />
      )}
    </div>
  );
}

function RedditPreview({
  subreddit,
  title,
  content,
  kind,
  url,
  author,
}: {
  subreddit: string;
  title: string;
  content?: string;
  kind: "self" | "link" | "image";
  url?: string;
  author: string;
}) {
  return (
    <div className="rounded-md border border-orange-500/20 bg-[#1a1a1b] p-3 font-sans text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
        <span className="text-orange-400">r/{subreddit}</span>
        <span>•</span>
        <span>publicado por u/{author.replace(/^@/, "")}</span>
      </div>
      <h4 className="text-base font-semibold text-white">{title}</h4>
      {kind === "self" && content && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">
          {content.slice(0, 600)}
          {content.length > 600 && "..."}
        </p>
      )}
      {kind === "link" && url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block truncate text-xs text-blue-400 hover:underline"
        >
          🔗 {url}
        </a>
      )}
      {kind === "image" && url && (
        <div className="mt-2 overflow-hidden rounded-md bg-gray-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="preview"
            className="max-h-72 w-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="mt-3 flex gap-3 text-xs text-gray-500">
        <span>↑ 0</span>
        <span>💬 0 comments</span>
        <span>↗ Share</span>
      </div>
    </div>
  );
}

function TwitterPreview({
  tweet,
  thread,
  handle,
}: {
  tweet: string;
  thread: string[];
  handle: string;
}) {
  const tweets = [tweet, ...thread].filter((t) => t.trim().length > 0);
  if (tweets.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        Escribe el tweet principal para ver la vista previa.
      </p>
    );
  }
  return (
    <div className="space-y-0">
      {tweets.map((t, i) => (
        <div
          key={i}
          className={cn(
            "border-b border-gray-800 px-3 py-3 text-sm",
            i === tweets.length - 1 && "border-b-0"
          )}
        >
          <div className="flex gap-2">
            <div className="h-8 w-8 flex-shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
            <div className="flex-1">
              <div className="flex items-center gap-1 text-xs">
                <span className="font-semibold text-white">Your name</span>
                <span className="text-gray-500">{handle}</span>
                {tweets.length > 1 && (
                  <span className="ml-auto text-[10px] text-gray-600">
                    {i + 1}/{tweets.length}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-100">{t}</p>
              <div className="mt-2 flex gap-4 text-xs text-gray-500">
                <span>💬</span>
                <span>🔁</span>
                <span>♥</span>
                <span>{t.length}/270</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InstagramPreview({
  content,
  handle,
}: {
  content: string;
  handle: string;
}) {
  // Hashtags al final del caption
  const lines = content.split("\n");
  return (
    <div className="rounded-md border border-pink-500/20 bg-black p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600" />
        <span className="font-semibold text-white">{handle.replace(/^@/, "")}</span>
      </div>
      <div className="mb-2 aspect-square w-full rounded-md bg-gray-900 flex items-center justify-center text-gray-700">
        <span className="text-xs">[ media ]</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-gray-200">
        <span className="font-semibold">{handle.replace(/^@/, "")}</span>{" "}
        {lines.join("\n").slice(0, 1500)}
        {content.length > 1500 && "..."}
      </p>
    </div>
  );
}
