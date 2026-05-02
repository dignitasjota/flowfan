"use client";

type Viewer = {
  userId: string;
  userName: string;
};

export function ActiveViewers({
  viewers,
  currentUserId,
}: {
  viewers: Viewer[];
  currentUserId?: string;
}) {
  const others = viewers.filter((v) => v.userId !== currentUserId);
  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {others.slice(0, 3).map((viewer) => (
          <div
            key={viewer.userId}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-medium text-white ring-2 ring-gray-900"
            title={viewer.userName}
          >
            {viewer.userName.charAt(0).toUpperCase()}
          </div>
        ))}
        {others.length > 3 && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-[10px] font-medium text-gray-300 ring-2 ring-gray-900">
            +{others.length - 3}
          </div>
        )}
      </div>
      <span className="text-xs text-gray-500">
        {others.length === 1 ? "viendo" : "viendo"}
      </span>
    </div>
  );
}
