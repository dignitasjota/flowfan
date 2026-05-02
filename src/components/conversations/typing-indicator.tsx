"use client";

export function TypingIndicator({ userNames }: { userNames: string[] }) {
  if (userNames.length === 0) return null;

  const text =
    userNames.length === 1
      ? `${userNames[0]} está escribiendo`
      : userNames.length === 2
        ? `${userNames[0]} y ${userNames[1]} están escribiendo`
        : `${userNames[0]} y ${userNames.length - 1} más están escribiendo`;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-gray-400">
      <span className="flex gap-0.5">
        <span className="animate-bounce h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: "0ms" }} />
        <span className="animate-bounce h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: "150ms" }} />
        <span className="animate-bounce h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: "300ms" }} />
      </span>
      <span>{text}</span>
    </div>
  );
}
