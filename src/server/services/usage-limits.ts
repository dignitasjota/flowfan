import { eq, and, gte, sql, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { db as DbType } from "@/server/db";
import {
  creators,
  contacts,
  platforms,
  responseTemplates,
  aiUsageLog,
  mediaItems,
} from "@/server/db/schema";

type Db = typeof DbType;

type PlanType = "free" | "starter" | "pro" | "business";

type PlanLimits = {
  contacts: number;
  aiMessagesPerMonth: number;
  platforms: number;
  templates: number;
  reportsPerMonth: number;
  priceAdvisor: boolean;
  multiModel: boolean;
  export: "none" | "csv" | "csv_json" | "csv_json_api";
  revenue: "none" | "basic" | "full" | "full_export";
  mediaFiles: number;
  mediaStorageMB: number;
};

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    contacts: 5,
    aiMessagesPerMonth: 20,
    platforms: 1,
    templates: 3,
    reportsPerMonth: 0,
    priceAdvisor: false,
    multiModel: false,
    export: "none",
    revenue: "none",
    mediaFiles: 0,
    mediaStorageMB: 0,
  },
  starter: {
    contacts: 50,
    aiMessagesPerMonth: 200,
    platforms: 3,
    templates: 20,
    reportsPerMonth: 5,
    priceAdvisor: false,
    multiModel: false,
    export: "csv",
    revenue: "basic",
    mediaFiles: 50,
    mediaStorageMB: 100,
  },
  pro: {
    contacts: -1,
    aiMessagesPerMonth: 2000,
    platforms: -1,
    templates: -1,
    reportsPerMonth: -1,
    priceAdvisor: true,
    multiModel: true,
    export: "csv_json",
    revenue: "full",
    mediaFiles: 500,
    mediaStorageMB: 1024,
  },
  business: {
    contacts: -1,
    aiMessagesPerMonth: -1,
    platforms: -1,
    templates: -1,
    reportsPerMonth: -1,
    priceAdvisor: true,
    multiModel: true,
    export: "csv_json_api",
    revenue: "full_export",
    mediaFiles: -1,
    mediaStorageMB: -1,
  },
};

async function getCreatorPlan(db: Db, creatorId: string): Promise<PlanType> {
  const creator = await db.query.creators.findFirst({
    where: eq(creators.id, creatorId),
    columns: { subscriptionPlan: true },
  });
  return (creator?.subscriptionPlan as PlanType) ?? "free";
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function checkContactLimit(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.contacts === -1) return;

  const [result] = await db
    .select({ count: count() })
    .from(contacts)
    .where(eq(contacts.creatorId, creatorId));

  if ((result?.count ?? 0) >= limits.contacts) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.contacts} contactos en el plan ${plan}. Actualiza tu plan para añadir más.`,
    });
  }
}

export async function checkAIMessageLimit(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.aiMessagesPerMonth === -1) return;

  const monthStart = startOfMonth();
  const [result] = await db
    .select({ count: count() })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.creatorId, creatorId),
        gte(aiUsageLog.createdAt, monthStart)
      )
    );

  if ((result?.count ?? 0) >= limits.aiMessagesPerMonth) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.aiMessagesPerMonth} mensajes IA/mes en el plan ${plan}. Actualiza tu plan para más mensajes.`,
    });
  }
}

export async function checkPlatformLimit(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.platforms === -1) return;

  const [result] = await db
    .select({ count: count() })
    .from(platforms)
    .where(and(eq(platforms.creatorId, creatorId), eq(platforms.isActive, true)));

  if ((result?.count ?? 0) >= limits.platforms) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.platforms} plataformas en el plan ${plan}. Actualiza tu plan para más plataformas.`,
    });
  }
}

export async function checkTemplateLimit(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.templates === -1) return;

  const [result] = await db
    .select({ count: count() })
    .from(responseTemplates)
    .where(eq(responseTemplates.creatorId, creatorId));

  if ((result?.count ?? 0) >= limits.templates) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.templates} templates en el plan ${plan}. Actualiza tu plan para más templates.`,
    });
  }
}

export async function checkReportLimit(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.reportsPerMonth === -1) return;

  if (limits.reportsPerMonth === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Los reportes IA no están disponibles en el plan ${plan}. Actualiza tu plan para acceder a esta función.`,
    });
  }

  const monthStart = startOfMonth();
  const [result] = await db
    .select({ count: count() })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.creatorId, creatorId),
        eq(aiUsageLog.requestType, "analysis"),
        gte(aiUsageLog.createdAt, monthStart)
      )
    );

  if ((result?.count ?? 0) >= limits.reportsPerMonth) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.reportsPerMonth} reportes/mes en el plan ${plan}. Actualiza tu plan para más reportes.`,
    });
  }
}

export async function checkFeatureAccess(
  db: Db,
  creatorId: string,
  feature: "priceAdvisor" | "multiModel"
) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];

  if (!limits[feature]) {
    const featureNames: Record<string, string> = {
      priceAdvisor: "Price Advisor",
      multiModel: "Multi-modelo IA",
    };
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${featureNames[feature]} no está disponible en el plan ${plan}. Actualiza a Pro o superior para acceder.`,
    });
  }
}

export async function checkMediaFileLimit(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.mediaFiles === -1) return;

  if (limits.mediaFiles === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `El Media Vault no está disponible en el plan ${plan}. Actualiza tu plan para subir archivos.`,
    });
  }

  const [result] = await db
    .select({ count: count() })
    .from(mediaItems)
    .where(eq(mediaItems.creatorId, creatorId));

  if ((result?.count ?? 0) >= limits.mediaFiles) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.mediaFiles} archivos en el plan ${plan}. Actualiza tu plan para más archivos.`,
    });
  }
}

export async function checkMediaStorageLimit(db: Db, creatorId: string, newFileSizeBytes: number) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  if (limits.mediaStorageMB === -1) return;

  const [result] = await db
    .select({ total: sql<number>`coalesce(sum(${mediaItems.fileSize}), 0)` })
    .from(mediaItems)
    .where(eq(mediaItems.creatorId, creatorId));

  const currentBytes = result?.total ?? 0;
  const limitBytes = limits.mediaStorageMB * 1024 * 1024;

  if (currentBytes + newFileSizeBytes > limitBytes) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Has alcanzado el límite de ${limits.mediaStorageMB}MB de almacenamiento en el plan ${plan}. Actualiza tu plan para más espacio.`,
    });
  }
}

const revenueLevels = { none: 0, basic: 1, full: 2, full_export: 3 } as const;

export async function checkRevenueAccess(
  db: Db,
  creatorId: string,
  requiredLevel: "basic" | "full" | "full_export" = "basic"
) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  const currentLevel = revenueLevels[limits.revenue];
  const needed = revenueLevels[requiredLevel];

  if (currentLevel < needed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `El tracking de revenue no está disponible en el plan ${plan}. Actualiza tu plan para acceder.`,
    });
  }
}

export async function getUsageSummary(db: Db, creatorId: string) {
  const plan = await getCreatorPlan(db, creatorId);
  const limits = PLAN_LIMITS[plan];
  const monthStart = startOfMonth();

  const [contactCount] = await db
    .select({ count: count() })
    .from(contacts)
    .where(eq(contacts.creatorId, creatorId));

  const [aiMessageCount] = await db
    .select({ count: count() })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.creatorId, creatorId),
        gte(aiUsageLog.createdAt, monthStart)
      )
    );

  const [platformCount] = await db
    .select({ count: count() })
    .from(platforms)
    .where(and(eq(platforms.creatorId, creatorId), eq(platforms.isActive, true)));

  const [templateCount] = await db
    .select({ count: count() })
    .from(responseTemplates)
    .where(eq(responseTemplates.creatorId, creatorId));

  const [reportCount] = await db
    .select({ count: count() })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.creatorId, creatorId),
        eq(aiUsageLog.requestType, "analysis"),
        gte(aiUsageLog.createdAt, monthStart)
      )
    );

  return {
    plan,
    limits,
    usage: {
      contacts: { used: contactCount?.count ?? 0, limit: limits.contacts },
      aiMessages: { used: aiMessageCount?.count ?? 0, limit: limits.aiMessagesPerMonth },
      platforms: { used: platformCount?.count ?? 0, limit: limits.platforms },
      templates: { used: templateCount?.count ?? 0, limit: limits.templates },
      reports: { used: reportCount?.count ?? 0, limit: limits.reportsPerMonth },
    },
  };
}
