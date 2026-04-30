import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, managerProcedure } from "../trpc";
import { importJobs, contacts } from "@/server/db/schema";
import { importQueue } from "@/server/queues";
import { checkBulkContactLimit } from "@/server/services/usage-limits";

const PLATFORM_TYPES = [
  "instagram",
  "tinder",
  "reddit",
  "onlyfans",
  "twitter",
  "telegram",
  "snapchat",
  "other",
] as const;

const CONTACT_FIELDS = ["username", "displayName", "platformType", "tags", "platformUserId"] as const;

// Simple CSV parser that handles quoted fields
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]!);
  const rows = lines.slice(1).map(parseLine);

  return { headers, rows };
}

// Auto-detect column mapping from common names
function autoDetectMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const nameMap: Record<string, string> = {
    username: "username",
    user: "username",
    usuario: "username",
    nombre_usuario: "username",
    handle: "username",
    displayname: "displayName",
    display_name: "displayName",
    nombre: "displayName",
    name: "displayName",
    platform: "platformType",
    platformtype: "platformType",
    platform_type: "platformType",
    plataforma: "platformType",
    tags: "tags",
    etiquetas: "tags",
    platformuserid: "platformUserId",
    platform_user_id: "platformUserId",
  };

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/\s+/g, "_");
    mapping[header] = nameMap[normalized] ?? null;
  }

  return mapping;
}

export const importRouter = createTRPCRouter({
  upload: managerProcedure
    .input(
      z.object({
        csvContent: z.string().min(1, "CSV vacio"),
        fileName: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { headers, rows } = parseCSV(input.csvContent);

      if (headers.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El CSV no tiene headers." });
      }

      if (rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El CSV no tiene filas de datos." });
      }

      if (rows.length > 10000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maximo 10,000 filas por importacion.",
        });
      }

      const autoMapping = autoDetectMapping(headers);

      const [job] = await ctx.db
        .insert(importJobs)
        .values({
          creatorId: ctx.creatorId,
          fileName: input.fileName,
          totalRows: rows.length,
          columnMapping: autoMapping,
          rawData: { headers, rows },
        })
        .returning();

      return {
        jobId: job!.id,
        headers,
        previewRows: rows.slice(0, 5),
        totalRows: rows.length,
        autoMapping,
      };
    }),

  setMapping: managerProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        mapping: z.record(z.string(), z.string().nullable()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.importJobs.findFirst({
        where: and(eq(importJobs.id, input.jobId), eq(importJobs.creatorId, ctx.creatorId)),
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job no encontrado." });
      }

      if (job.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El job ya no esta pendiente." });
      }

      // Validate required mappings
      const mappedFields = Object.values(input.mapping).filter(Boolean);
      if (!mappedFields.includes("username")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debes mapear al menos la columna 'username'.",
        });
      }
      if (!mappedFields.includes("platformType")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debes mapear al menos la columna 'platformType'.",
        });
      }

      await ctx.db
        .update(importJobs)
        .set({ columnMapping: input.mapping })
        .where(eq(importJobs.id, input.jobId));

      return { success: true };
    }),

  preview: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.query.importJobs.findFirst({
        where: and(eq(importJobs.id, input.jobId), eq(importJobs.creatorId, ctx.creatorId)),
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job no encontrado." });
      }

      const rawData = job.rawData as { headers: string[]; rows: string[][] };
      const mapping = job.columnMapping as Record<string, string | null>;

      // Map rows to contact fields
      const mappedRows = rawData.rows.slice(0, 20).map((row) => {
        const mapped: Record<string, string> = {};
        rawData.headers.forEach((header, i) => {
          const field = mapping[header];
          if (field && row[i]) {
            mapped[field] = row[i]!;
          }
        });
        return mapped;
      });

      // Check for duplicates
      const existingContacts = await ctx.db.query.contacts.findMany({
        where: eq(contacts.creatorId, ctx.creatorId),
        columns: { username: true, platformType: true },
      });

      const existingSet = new Set(
        existingContacts.map((c) => `${c.username.toLowerCase()}:${c.platformType}`)
      );

      let duplicateCount = 0;
      let newCount = 0;

      const allMapped = rawData.rows.map((row) => {
        const mapped: Record<string, string> = {};
        rawData.headers.forEach((header, i) => {
          const field = mapping[header];
          if (field && row[i]) {
            mapped[field] = row[i]!;
          }
        });
        return mapped;
      });

      for (const row of allMapped) {
        const key = `${(row.username ?? "").toLowerCase()}:${row.platformType ?? ""}`;
        if (existingSet.has(key)) {
          duplicateCount++;
        } else {
          newCount++;
        }
      }

      return {
        rows: mappedRows,
        duplicateCount,
        newCount,
        totalRows: rawData.rows.length,
      };
    }),

  confirm: managerProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        skipDuplicates: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.importJobs.findFirst({
        where: and(eq(importJobs.id, input.jobId), eq(importJobs.creatorId, ctx.creatorId)),
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job no encontrado." });
      }

      if (job.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El job ya no esta pendiente." });
      }

      // Check plan limits
      const rawData = job.rawData as { headers: string[]; rows: string[][] };
      await checkBulkContactLimit(ctx.db, ctx.creatorId, rawData.rows.length);

      // Update job and enqueue
      await ctx.db
        .update(importJobs)
        .set({ status: "processing", skipDuplicates: input.skipDuplicates })
        .where(eq(importJobs.id, input.jobId));

      await importQueue.add("import-contacts", {
        importJobId: input.jobId,
        creatorId: ctx.creatorId,
      });

      return { jobId: input.jobId, estimatedRows: rawData.rows.length };
    }),

  getStatus: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.query.importJobs.findFirst({
        where: and(eq(importJobs.id, input.jobId), eq(importJobs.creatorId, ctx.creatorId)),
        columns: {
          id: true,
          status: true,
          totalRows: true,
          processedRows: true,
          createdCount: true,
          skippedCount: true,
          errorCount: true,
          duplicateCount: true,
          errors: true,
          completedAt: true,
        },
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job no encontrado." });
      }

      return job;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.importJobs.findMany({
      where: eq(importJobs.creatorId, ctx.creatorId),
      orderBy: [desc(importJobs.createdAt)],
      limit: 20,
      columns: {
        id: true,
        fileName: true,
        status: true,
        totalRows: true,
        createdCount: true,
        errorCount: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }),

  cancel: managerProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.importJobs.findFirst({
        where: and(eq(importJobs.id, input.jobId), eq(importJobs.creatorId, ctx.creatorId)),
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job no encontrado." });
      }

      if (job.status !== "pending" && job.status !== "processing") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden cancelar jobs pendientes o en proceso." });
      }

      await ctx.db
        .update(importJobs)
        .set({ status: "cancelled" })
        .where(eq(importJobs.id, input.jobId));

      return { success: true };
    }),
});
