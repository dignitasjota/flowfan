import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { authOptions } from "@/server/auth";
import { db } from "@/server/db";
import { creators } from "@/server/db/schema";
import { Sidebar } from "@/components/layout/sidebar";
import { UpgradeModalProvider } from "@/components/billing/upgrade-modal";
import { PastDueBanner } from "./past-due-banner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const creator = await db.query.creators.findFirst({
    where: eq(creators.id, session.user.id),
    columns: {
      onboardingCompleted: true,
      subscriptionStatus: true,
    },
  });

  const isPastDue = creator?.subscriptionStatus === "past_due";

  return (
    <UpgradeModalProvider>
      <div className="flex h-screen bg-gray-950">
        <Sidebar user={session.user} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {isPastDue && <PastDueBanner />}
          <main className="flex-1 overflow-hidden pt-14 lg:pt-0">
            {children}
          </main>
        </div>
      </div>
    </UpgradeModalProvider>
  );
}
