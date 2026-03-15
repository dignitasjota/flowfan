import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/conversations");

  return (
    <div className="flex h-screen bg-gray-950">
      <AdminSidebar user={session.user} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Admin header bar */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-red-900/40 bg-red-950/20 px-6 lg:hidden">
          <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
            Admin
          </span>
          <span className="text-xs text-red-400">Panel de administración</span>
        </div>
        <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">{children}</main>
      </div>
    </div>
  );
}
