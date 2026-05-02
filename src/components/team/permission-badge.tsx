"use client";

export function PermissionBadge({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${color ?? "#6b7280"}20`,
        color: color ?? "#6b7280",
        border: `1px solid ${color ?? "#6b7280"}40`,
      }}
    >
      {name}
    </span>
  );
}
