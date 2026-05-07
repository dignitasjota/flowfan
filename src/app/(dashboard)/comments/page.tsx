"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PostsList } from "@/components/comments/posts-list";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";

export default function CommentsPage() {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      <div
        className={cn(
          "w-full border-r border-gray-800 lg:block lg:w-80",
          selectedPostId ? "hidden lg:block" : "block"
        )}
      >
        <PostsList
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
        />
      </div>

      <div className={cn("flex-1", selectedPostId ? "block" : "hidden lg:block")}>
        {selectedPostId ? (
          <CommentThreadPanel postId={selectedPostId} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-2 text-5xl">💬</div>
              <h2 className="text-lg font-semibold text-white">
                Bandeja de comentarios públicos
              </h2>
              <p className="mt-1 max-w-md text-sm text-gray-400">
                Selecciona un post de la izquierda para ver y responder a sus
                comentarios. La IA te ayuda a redactar respuestas calibradas
                para conversaciones públicas.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
