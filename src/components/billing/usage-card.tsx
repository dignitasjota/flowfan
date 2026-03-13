import { cn } from "@/lib/utils";

type Props = {
  label: string;
  used: number;
  limit: number;
  icon: React.ReactNode;
};

export function UsageCard({ label, used, limit, icon }: Props) {
  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : limit > 0 ? (used / limit) * 100 : 0;
  const isHigh = percentage > 80;
  const isExceeded = percentage >= 100;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-gray-400">
          {icon}
        </div>
        <span className="text-sm font-medium text-gray-300">{label}</span>
      </div>

      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-2xl font-bold text-white">{used}</span>
        <span className="text-sm text-gray-400">
          / {isUnlimited ? "ilimitado" : limit}
        </span>
      </div>

      {!isUnlimited && (
        <div className="h-2 overflow-hidden rounded-full bg-gray-800">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isExceeded
                ? "bg-red-500"
                : isHigh
                  ? "bg-amber-500"
                  : "bg-indigo-500"
            )}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
