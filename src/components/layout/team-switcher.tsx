"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function TeamSwitcher() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: teams } = trpc.team.getMyTeams.useQuery(undefined, {
    retry: false,
  });

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!teams || teams.length === 0) return null;

  const activeCreatorId = (session as any)?.activeCreatorId ?? null;

  const activeName = activeCreatorId
    ? teams.find((t) => t.creatorId === activeCreatorId)?.creatorName ??
      "Equipo"
    : "Mi cuenta";

  const handleSelect = async (creatorId: string | null) => {
    setIsOpen(false);
    await update({ activeCreatorId: creatorId });
    router.refresh();
  };

  return (
    <div ref={dropdownRef} className="relative px-3 pb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-800/50 px-3 py-2 text-sm text-white hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2 truncate">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-indigo-600 text-[10px] font-bold text-white">
            {activeName.charAt(0).toUpperCase()}
          </span>
          <span className="truncate">{activeName}</span>
        </div>
        <svg
          className={cn(
            "h-4 w-4 shrink-0 text-gray-400 transition-transform",
            isOpen && "rotate-180"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
          <button
            onClick={() => handleSelect(null)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
              activeCreatorId === null
                ? "bg-indigo-600/20 text-indigo-400"
                : "text-gray-300 hover:bg-gray-700 hover:text-white"
            )}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-600 text-[10px] font-bold text-white">
              M
            </span>
            Mi cuenta
          </button>

          <div className="my-1 border-t border-gray-700" />

          {teams.map((team) => (
            <button
              key={team.creatorId}
              onClick={() => handleSelect(team.creatorId)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                activeCreatorId === team.creatorId
                  ? "bg-indigo-600/20 text-indigo-400"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-indigo-600 text-[10px] font-bold text-white">
                {team.creatorName.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">{team.creatorName}</p>
                <p className="truncate text-xs text-gray-500">{team.role}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
