import { createTRPCRouter } from "./trpc";
import { contactsRouter } from "./routers/contacts";
import { conversationsRouter } from "./routers/conversations";
import { messagesRouter } from "./routers/messages";
import { platformsRouter } from "./routers/platforms";
import { aiRouter } from "./routers/ai";
import { aiConfigRouter } from "./routers/ai-config";

export const appRouter = createTRPCRouter({
  contacts: contactsRouter,
  conversations: conversationsRouter,
  messages: messagesRouter,
  platforms: platformsRouter,
  ai: aiRouter,
  aiConfig: aiConfigRouter,
});

export type AppRouter = typeof appRouter;
