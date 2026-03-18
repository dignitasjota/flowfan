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
});

export type AppRouter = typeof appRouter;
