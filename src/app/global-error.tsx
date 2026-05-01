"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <h2 className="mb-4 text-xl font-bold">Algo salió mal</h2>
          <button
            onClick={() => reset()}
            className="rounded bg-indigo-600 px-4 py-2 text-sm hover:bg-indigo-700"
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  );
}
