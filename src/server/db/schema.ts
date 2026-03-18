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

export const mediaTypeEnum = pgEnum("media_type", [
  "image",
  "video",
  "gif",
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
    platformUserId: varchar("platform_user_id", { length: 255 }),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("contacts_creator_idx").on(table.creatorId),
    index("contacts_creator_platform_idx").on(
      table.creatorId,
      table.platformType
    ),
    index("contacts_platform_user_idx").on(
      table.creatorId,
      table.platformType,
      table.platformUserId
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
    externalMessageId: varchar("external_message_id", { length: 255 }),
    source: varchar("source", { length: 20 }).default("manual"),
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

// --- Telegram Bot Configs ---

export const telegramBotConfigs = pgTable("telegram_bot_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id")
    .notNull()
    .unique()
    .references(() => creators.id, { onDelete: "cascade" }),
  botToken: text("bot_token").notNull(),
  botUsername: varchar("bot_username", { length: 255 }),
  botId: varchar("bot_id", { length: 100 }),
  webhookSecret: varchar("webhook_secret", { length: 255 }).notNull().unique(),
  webhookUrl: text("webhook_url"),
  status: varchar("status", { length: 20 }).default("disconnected").notNull(),
  autoReplyEnabled: boolean("auto_reply_enabled").default(false).notNull(),
  autoReplyDelaySec: integer("auto_reply_delay_sec").default(0).notNull(),
  welcomeMessage: text("welcome_message"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

// --- Media Categories ---
export const mediaCategories = pgTable(
  "media_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 7 }).default("#6366f1"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("media_categories_creator_idx").on(table.creatorId),
    uniqueIndex("media_categories_creator_name_idx").on(table.creatorId, table.name),
  ]
);

// --- Media Items (vault) ---
export const mediaItems = pgTable(
  "media_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 500 }).notNull(),
    originalName: varchar("original_name", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    mediaType: mediaTypeEnum("media_type").notNull(),
    fileSize: integer("file_size").notNull(), // bytes
    storagePath: text("storage_path").notNull(),
    thumbnailPath: text("thumbnail_path"),
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"), // segundos, solo video
    tags: text("tags").array().default([]),
    categoryId: uuid("category_id").references(() => mediaCategories.id, {
      onDelete: "set null",
    }),
    isArchived: boolean("is_archived").default(false).notNull(),
    sendCount: integer("send_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("media_items_creator_idx").on(table.creatorId),
    index("media_items_creator_category_idx").on(table.creatorId, table.categoryId),
    index("media_items_creator_type_idx").on(table.creatorId, table.mediaType),
  ]
);

// --- Media Sends (tracking de envios a contactos) ---
export const mediaSends = pgTable(
  "media_sends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mediaItemId: uuid("media_item_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    index("media_sends_media_idx").on(table.mediaItemId),
    index("media_sends_contact_idx").on(table.contactId),
    uniqueIndex("media_sends_media_contact_idx").on(table.mediaItemId, table.contactId),
  ]
);

// --- Workflows ---

export const workflowTriggerTypeEnum = pgEnum("workflow_trigger_type", [
  "no_response_timeout",
  "funnel_stage_change",
  "sentiment_change",
  "keyword_detected",
  "new_contact",
]);

export const workflowActionTypeEnum = pgEnum("workflow_action_type", [
  "send_message",
  "send_template",
  "create_notification",
  "change_tags",
]);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    triggerType: workflowTriggerTypeEnum("trigger_type").notNull(),
    triggerConfig: jsonb("trigger_config").default({}).notNull(),
    conditions: jsonb("conditions").default([]).notNull(),
    actionType: workflowActionTypeEnum("action_type").notNull(),
    actionConfig: jsonb("action_config").default({}).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    cooldownMinutes: integer("cooldown_minutes").default(60).notNull(),
    executionCount: integer("execution_count").default(0).notNull(),
    lastExecutedAt: timestamp("last_executed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflows_creator_idx").on(table.creatorId),
    index("workflows_creator_active_idx").on(table.creatorId, table.isActive),
  ]
);

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    triggerData: jsonb("trigger_data").default({}).notNull(),
    actionResult: jsonb("action_result").default({}).notNull(),
    status: varchar("status", { length: 20 }).notNull(), // success, failed, skipped
    errorMessage: text("error_message"),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_executions_workflow_idx").on(table.workflowId),
    index("workflow_executions_creator_idx").on(table.creatorId, table.executedAt),
    index("workflow_executions_contact_idx").on(table.contactId),
  ]
);

// --- Segments ---

export const segmentTypeEnum = pgEnum("segment_type", [
  "dynamic",
  "static",
  "mixed",
]);

export const segmentMembershipEnum = pgEnum("segment_membership", [
  "included",
  "excluded",
]);

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: segmentTypeEnum("type").notNull(),
    filters: jsonb("filters").default([]).notNull(),
    color: varchar("color", { length: 7 }).default("#6366f1"),
    icon: varchar("icon", { length: 10 }),
    isPredefined: boolean("is_predefined").default(false).notNull(),
    predefinedKey: varchar("predefined_key", { length: 50 }),
    contactCount: integer("contact_count").default(0).notNull(),
    countUpdatedAt: timestamp("count_updated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("segments_creator_idx").on(table.creatorId),
  ]
);

export const segmentMembers = pgTable(
  "segment_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    membershipType: segmentMembershipEnum("membership_type").default("included").notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    index("segment_members_segment_idx").on(table.segmentId),
    index("segment_members_contact_idx").on(table.contactId),
    uniqueIndex("segment_members_unique_idx").on(table.segmentId, table.contactId),
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
  mediaItems: many(mediaItems),
  mediaCategories: many(mediaCategories),
  workflows: many(workflows),
  workflowExecutions: many(workflowExecutions),
  segments: many(segments),
  telegramBotConfig: one(telegramBotConfigs),
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

export const mediaCategoriesRelations = relations(mediaCategories, ({ one, many }) => ({
  creator: one(creators, {
    fields: [mediaCategories.creatorId],
    references: [creators.id],
  }),
  items: many(mediaItems),
}));

export const mediaItemsRelations = relations(mediaItems, ({ one, many }) => ({
  creator: one(creators, {
    fields: [mediaItems.creatorId],
    references: [creators.id],
  }),
  category: one(mediaCategories, {
    fields: [mediaItems.categoryId],
    references: [mediaCategories.id],
  }),
  sends: many(mediaSends),
}));

export const mediaSendsRelations = relations(mediaSends, ({ one }) => ({
  mediaItem: one(mediaItems, {
    fields: [mediaSends.mediaItemId],
    references: [mediaItems.id],
  }),
  contact: one(contacts, {
    fields: [mediaSends.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [mediaSends.conversationId],
    references: [conversations.id],
  }),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  creator: one(creators, {
    fields: [workflows.creatorId],
    references: [creators.id],
  }),
  executions: many(workflowExecutions),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowExecutions.workflowId],
    references: [workflows.id],
  }),
  creator: one(creators, {
    fields: [workflowExecutions.creatorId],
    references: [creators.id],
  }),
  contact: one(contacts, {
    fields: [workflowExecutions.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [workflowExecutions.conversationId],
    references: [conversations.id],
  }),
}));

export const segmentsRelations = relations(segments, ({ one, many }) => ({
  creator: one(creators, {
    fields: [segments.creatorId],
    references: [creators.id],
  }),
  members: many(segmentMembers),
}));

export const segmentMembersRelations = relations(segmentMembers, ({ one }) => ({
  segment: one(segments, {
    fields: [segmentMembers.segmentId],
    references: [segments.id],
  }),
  contact: one(contacts, {
    fields: [segmentMembers.contactId],
    references: [contacts.id],
  }),
}));

export const telegramBotConfigsRelations = relations(telegramBotConfigs, ({ one }) => ({
  creator: one(creators, {
    fields: [telegramBotConfigs.creatorId],
    references: [creators.id],
  }),
}));
