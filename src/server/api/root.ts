import { createTRPCRouter } from "./trpc";
import { contactsRouter } from "./routers/contacts";
import { conversationsRouter } from "./routers/conversations";
import { messagesRouter } from "./routers/messages";
import { platformsRouter } from "./routers/platforms";
import { aiRouter } from "./routers/ai";
import { aiConfigRouter } from "./routers/ai-config";
import { intelligenceRouter } from "./routers/intelligence";
import { templatesRouter } from "./routers/templates";
import { billingRouter } from "./routers/billing";
import { accountRouter } from "./routers/account";
import { adminRouter } from "./routers/admin";
import { revenueRouter } from "./routers/revenue";
import { mediaRouter } from "./routers/media";
import { workflowsRouter } from "./routers/workflows";
import { segmentsRouter } from "./routers/segments";
import { telegramRouter } from "./routers/telegram";
import { broadcastsRouter } from "./routers/broadcasts";
import { teamRouter } from "./routers/team";
import { scheduledMessagesRouter } from "./routers/scheduled-messages";
import { conversationModesRouter } from "./routers/conversation-modes";
import { searchRouter } from "./routers/search";
import { importRouter } from "./routers/import";
import { autoResponseRouter } from "./routers/auto-response";
import { sequencesRouter } from "./routers/sequences";
import { scoringConfigRouter } from "./routers/scoring-config";
import { apiKeysRouter } from "./routers/api-keys";
import { webhooksOutgoingRouter } from "./routers/webhooks-outgoing";
import { auditLogRouter } from "./routers/audit-log";
import { presenceRouter } from "./routers/presence";
import { abExperimentsRouter } from "./routers/ab-experiments";
import { contentGapsRouter } from "./routers/content-gaps";
import { socialCommentsRouter } from "./routers/social-comments";
import { schedulerRouter } from "./routers/scheduler";
import { blogToSocialRouter } from "./routers/blog-to-social";

export const appRouter = createTRPCRouter({
  contacts: contactsRouter,
  conversations: conversationsRouter,
  messages: messagesRouter,
  platforms: platformsRouter,
  ai: aiRouter,
  aiConfig: aiConfigRouter,
  intelligence: intelligenceRouter,
  templates: templatesRouter,
  billing: billingRouter,
  account: accountRouter,
  admin: adminRouter,
  revenue: revenueRouter,
  media: mediaRouter,
  workflows: workflowsRouter,
  segments: segmentsRouter,
  telegram: telegramRouter,
  broadcasts: broadcastsRouter,
  team: teamRouter,
  scheduledMessages: scheduledMessagesRouter,
  conversationModes: conversationModesRouter,
  search: searchRouter,
  import: importRouter,
  autoResponse: autoResponseRouter,
  sequences: sequencesRouter,
  scoringConfig: scoringConfigRouter,
  apiKeys: apiKeysRouter,
  webhooksOutgoing: webhooksOutgoingRouter,
  auditLog: auditLogRouter,
  presence: presenceRouter,
  abExperiments: abExperimentsRouter,
  contentGaps: contentGapsRouter,
  socialComments: socialCommentsRouter,
  scheduler: schedulerRouter,
  blogToSocial: blogToSocialRouter,
});

export type AppRouter = typeof appRouter;
