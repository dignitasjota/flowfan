import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("telegram-service");

const TELEGRAM_API = "https://api.telegram.org/bot";

type TelegramResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  date: number;
  text?: string;
  photo?: { file_id: string; file_unique_id: string; width: number; height: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
  caption?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type { TelegramUser, TelegramMessage, TelegramUpdate };

// ---------------------------------------------------------------------------
// Low-level API helpers
// ---------------------------------------------------------------------------

async function telegramRequest<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramResponse<T>> {
  const url = `${TELEGRAM_API}${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as TelegramResponse<T>;

  if (!data.ok) {
    log.error({ method, error: data.description, code: data.error_code }, "Telegram API error");
    throw new Error(`Telegram API error: ${data.description ?? "Unknown error"}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a bot token by calling getMe.
 */
export async function validateBotToken(token: string): Promise<TelegramUser> {
  const res = await telegramRequest<TelegramUser>(token, "getMe");
  return res.result!;
}

/**
 * Set a webhook for a bot.
 */
export async function setWebhook(
  token: string,
  url: string,
  secretToken: string
): Promise<void> {
  await telegramRequest(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message"],
    max_connections: 40,
  });
  log.info({ url }, "Webhook set successfully");
}

/**
 * Remove a webhook.
 */
export async function deleteWebhook(token: string): Promise<void> {
  await telegramRequest(token, "deleteWebhook", { drop_pending_updates: true });
  log.info("Webhook deleted");
}

/**
 * Send a text message to a chat.
 */
export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  options?: { parseMode?: "HTML" | "Markdown" | "MarkdownV2"; replyToMessageId?: number }
): Promise<TelegramMessage> {
  const res = await telegramRequest<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode,
    reply_to_message_id: options?.replyToMessageId,
  });
  return res.result!;
}

/**
 * Get info about the current webhook.
 */
export async function getWebhookInfo(token: string): Promise<{
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}> {
  const res = await telegramRequest<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }>(token, "getWebhookInfo");
  return res.result!;
}
