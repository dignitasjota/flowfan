import { cn } from "@/lib/utils";

const badgeColors: Record<string, string> = {
  free: "border-gray-600 bg-gray-700/50 text-gray-300",
  starter: "border-blue-500/50 bg-blue-500/10 text-blue-400",
  pro: "border-indigo-500/50 bg-indigo-500/10 text-indigo-400",
  business: "border-amber-500/50 bg-amber-500/10 text-amber-400",
};

export function PlanBadge({ plan }: { plan: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider",
        badgeColors[plan] ?? badgeColors.free
      )}
    >
      {plan}
    </span>
  );
}
