import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// ENUMS
// ============================================================

export const platformTypeEnum = pgEnum("platform_type", [
  "instagram",
  "tinder",
  "reddit",
  "onlyfans",
  "twitter",
  "telegram",
  "snapchat",
  "other",
]);

export const subscriptionPlanEnum = pgEnum("subscription_plan", [
  "free",
  "starter",
  "pro",
  "business",
]);

export const creatorRoleEnum = pgEnum("creator_role", ["creator", "admin"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
]);

export const messageRoleEnum = pgEnum("message_role", ["fan", "creator"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "paused",
  "archived",
]);

export const funnelStageEnum = pgEnum("funnel_stage", [
  "cold",
  "curious",
  "interested",
  "hot_lead",
  "buyer",
  "vip",
]);

export const responseSpeedEnum = pgEnum("response_speed", [
  "fast",
  "medium",
  "slow",
]);

export const conversationDepthEnum = pgEnum("conversation_depth", [
  "superficial",
  "moderate",
  "deep",
]);

export const estimatedBudgetEnum = pgEnum("estimated_budget", [
  "low",
  "medium",
  "high",
  "premium",
]);

export const aiRequestTypeEnum = pgEnum("ai_request_type", [
  "suggestion",
  "analysis",
  "scoring",
  "summary",
]);

export const aiProviderEnum = pgEnum("ai_provider", [
  "anthropic",
  "openai",
  "google",
  "minimax",
  "kimi",
]);

export const aiTaskTypeEnum = pgEnum("ai_task_type", [
  "suggestion",
  "analysis",
  "summary",
  "report",
  "price_advice",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "tip",
  "ppv",
  "subscription",
  "custom",
]);

// ============================================================
// TABLES
// ============================================================

// --- Creators (tenant principal) ---
export const creators = pgTable("creators", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  emailVerificationToken: varchar("email_verification_token", { length: 255 }),
  subscriptionPlan: subscriptionPlanEnum("subscription_plan")
    .default("free")
    .notNull(),
  subscriptionStatus: subscriptionStatusEnum("subscription_status")
    .default("active")
    .notNull(),
  role: creatorRoleEnum("role").default("creator").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  currentPeriodEnd: timestamp("current_period_end"),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Platforms (personalidad por red social) ---
export const platforms = pgTable(
  "platforms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    platformType: platformTypeEnum("platform_type").notNull(),
    personalityConfig: jsonb("personality_config").default({}).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("platforms_creator_platform_idx").on(
      table.creatorId,
      table.platformType
    ),
  ]
);

// --- Contacts (los fans/usuarios) ---
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    username: varchar("username", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    platformType: platformTypeEnum("platform_type").notNull(),
    firstInteractionAt: timestamp("first_interaction_at").defaultNow().notNull(),
    lastInteractionAt: timestamp("last_interaction_at").defaultNow().notNull(),
    totalConversations: integer("total_conversations").default(1).notNull(),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").default({}),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contacts_creator_idx").on(table.creatorId),
    index("contacts_creator_platform_idx").on(
      table.creatorId,
      table.platformType
    ),
  ]
);

// --- Contact Profiles (perfil dinámico calculado) ---
export const contactProfiles = pgTable("contact_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id")
    .notNull()
    .unique()
    .references(() => contacts.id, { onDelete: "cascade" }),
  engagementLevel: integer("engagement_level").default(0).notNull(),
  responseSpeed: responseSpeedEnum("response_speed").default("medium"),
  conversationDepth: conversationDepthEnum("conversation_depth").default(
    "superficial"
  ),
  communicationStyle: jsonb("communication_style").default({}),
  paymentProbability: integer("payment_probability").default(0).notNull(),
  estimatedBudget: estimatedBudgetEnum("estimated_budget").default("low"),
  recommendedPriceRange: jsonb("recommended_price_range").default({}),
  funnelStage: funnelStageEnum("funnel_stage").default("cold").notNull(),
  scoringHistory: jsonb("scoring_history").default([]),
  behavioralSignals: jsonb("behavioral_signals").default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Conversations ---
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    platformType: platformTypeEnum("platform_type").notNull(),
    status: conversationStatusEnum("status").default("active").notNull(),
    summary: text("summary"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversations_creator_idx").on(table.creatorId),
    index("conversations_contact_idx").on(table.contactId),
  ]
);

// --- Messages ---
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    aiSuggestion: text("ai_suggestion"),
    aiSuggestionUsed: boolean("ai_suggestion_used"),
    sentiment: jsonb("sentiment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_idx").on(
      table.conversationId,
      table.createdAt
    ),
  ]
);

// --- Notes ---
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("notes_creator_contact_idx").on(table.creatorId, table.contactId),
  ]
);

// --- AI Config (configuración de proveedor IA por creador) ---
export const aiConfigs = pgTable("ai_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id")
    .notNull()
    .unique()
    .references(() => creators.id, { onDelete: "cascade" }),
  provider: aiProviderEnum("provider").default("anthropic").notNull(),
  model: varchar("model", { length: 100 }).notNull().default("claude-sonnet-4-6-20250514"),
  apiKey: text("api_key").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- AI Usage Log ---
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    requestType: aiRequestTypeEnum("request_type").notNull(),
    tokensUsed: integer("tokens_used").notNull(),
    modelUsed: varchar("model_used", { length: 100 }).notNull(),
    responseTimeMs: integer("response_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("ai_usage_creator_idx").on(table.creatorId)]
);

// --- Response Templates ---
export const responseTemplates = pgTable(
  "response_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    content: text("content").notNull(),
    category: varchar("category", { length: 100 }),
    platformType: platformTypeEnum("platform_type"),
    variables: text("variables").array().default([]),
    usageCount: integer("usage_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("templates_creator_idx").on(table.creatorId),
  ]
);

// --- AI Model Assignments (multi-model per task) ---
export const aiModelAssignments = pgTable(
  "ai_model_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    taskType: aiTaskTypeEnum("task_type").notNull(),
    provider: aiProviderEnum("provider").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    apiKey: text("api_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("model_assignments_creator_task_idx").on(
      table.creatorId,
      table.taskType
    ),
  ]
);

// --- Password Reset Tokens ---
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Notifications ---
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    type: varchar("type", { length: 50 }).notNull(), // "payment_probability_spike", "funnel_advance", etc.
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    data: jsonb("data").default({}),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notifications_creator_idx").on(table.creatorId),
    index("notifications_creator_unread_idx").on(
      table.creatorId,
      table.isRead
    ),
  ]
);

// --- Admin Audit Log ---
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    targetCreatorId: uuid("target_creator_id").references(() => creators.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 100 }).notNull(),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_admin_idx").on(table.adminId),
    index("audit_log_target_idx").on(table.targetCreatorId),
    index("audit_log_action_idx").on(table.action),
  ]
);

// --- SEO Config (singleton, id = "global") ---
export const seoConfig = pgTable("seo_config", {
  id: varchar("id", { length: 50 }).primaryKey().default("global"),
  siteTitle: varchar("site_title", { length: 255 }).notNull().default("FanFlow - CRM con IA para Creadores de Contenido"),
  siteDescription: text("site_description").notNull().default("Gestiona conversaciones con fans usando inteligencia artificial. Scoring automatico, sugerencias de respuesta, analisis de sentimiento y mas. Empieza gratis."),
  keywords: text("keywords").default("CRM creadores, gestion fans, IA conversacional, OnlyFans CRM, asistente IA"),
  canonicalUrl: varchar("canonical_url", { length: 255 }).default("https://flowfan.app"),
  ogTitle: varchar("og_title", { length: 255 }),
  ogDescription: text("og_description"),
  ogImageUrl: text("og_image_url"),
  twitterTitle: varchar("twitter_title", { length: 255 }),
  twitterDescription: text("twitter_description"),
  twitterImageUrl: text("twitter_image_url"),
  faviconUrl: text("favicon_url"),
  robotsIndex: boolean("robots_index").default(true).notNull(),
  robotsFollow: boolean("robots_follow").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Fan Transactions (revenue tracking) ---
export const fanTransactions = pgTable(
  "fan_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: transactionTypeEnum("type").notNull(),
    amount: integer("amount").notNull(), // centimos EUR (1500 = 15.00€)
    description: text("description"),
    transactionDate: timestamp("transaction_date").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("fan_transactions_creator_idx").on(table.creatorId),
    index("fan_transactions_contact_idx").on(table.contactId),
    index("fan_transactions_creator_contact_idx").on(table.creatorId, table.contactId),
    index("fan_transactions_date_idx").on(table.creatorId, table.transactionDate),
  ]
);

// ============================================================
// RELATIONS
// ============================================================

export const creatorsRelations = relations(creators, ({ one, many }) => ({
  platforms: many(platforms),
  contacts: many(contacts),
  conversations: many(conversations),
  notes: many(notes),
  aiUsageLog: many(aiUsageLog),
  aiConfig: one(aiConfigs),
  notifications: many(notifications),
  responseTemplates: many(responseTemplates),
  aiModelAssignments: many(aiModelAssignments),
  adminAuditLogs: many(adminAuditLog),
  fanTransactions: many(fanTransactions),
}));

export const platformsRelations = relations(platforms, ({ one }) => ({
  creator: one(creators, {
    fields: [platforms.creatorId],
    references: [creators.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  creator: one(creators, {
    fields: [contacts.creatorId],
    references: [creators.id],
  }),
  profile: one(contactProfiles),
  conversations: many(conversations),
  notes: many(notes),
  fanTransactions: many(fanTransactions),
}));

export const contactProfilesRelations = relations(
  contactProfiles,
  ({ one }) => ({
    contact: one(contacts, {
      fields: [contactProfiles.contactId],
      references: [contacts.id],
    }),
  })
);

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    creator: one(creators, {
      fields: [conversations.creatorId],
      references: [creators.id],
    }),
    contact: one(contacts, {
      fields: [conversations.contactId],
      references: [contacts.id],
    }),
    messages: many(messages),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  creator: one(creators, {
    fields: [notes.creatorId],
    references: [creators.id],
  }),
  contact: one(contacts, {
    fields: [notes.contactId],
    references: [contacts.id],
  }),
}));

export const aiConfigsRelations = relations(aiConfigs, ({ one }) => ({
  creator: one(creators, {
    fields: [aiConfigs.creatorId],
    references: [creators.id],
  }),
}));

export const aiUsageLogRelations = relations(aiUsageLog, ({ one }) => ({
  creator: one(creators, {
    fields: [aiUsageLog.creatorId],
    references: [creators.id],
  }),
}));

export const responseTemplatesRelations = relations(responseTemplates, ({ one }) => ({
  creator: one(creators, {
    fields: [responseTemplates.creatorId],
    references: [creators.id],
  }),
}));

export const aiModelAssignmentsRelations = relations(aiModelAssignments, ({ one }) => ({
  creator: one(creators, {
    fields: [aiModelAssignments.creatorId],
    references: [creators.id],
  }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, () => ({}));

export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({
  admin: one(creators, {
    fields: [adminAuditLog.adminId],
    references: [creators.id],
  }),
  targetCreator: one(creators, {
    fields: [adminAuditLog.targetCreatorId],
    references: [creators.id],
    relationName: "auditTarget",
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  creator: one(creators, {
    fields: [notifications.creatorId],
    references: [creators.id],
  }),
  contact: one(contacts, {
    fields: [notifications.contactId],
    references: [contacts.id],
  }),
}));

export const fanTransactionsRelations = relations(fanTransactions, ({ one }) => ({
  creator: one(creators, {
    fields: [fanTransactions.creatorId],
    references: [creators.id],
  }),
  contact: one(contacts, {
    fields: [fanTransactions.contactId],
    references: [contacts.id],
  }),
}));
