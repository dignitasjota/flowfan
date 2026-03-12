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
  subscriptionPlan: subscriptionPlanEnum("subscription_plan")
    .default("free")
    .notNull(),
  subscriptionStatus: subscriptionStatusEnum("subscription_status")
    .default("active")
    .notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
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
