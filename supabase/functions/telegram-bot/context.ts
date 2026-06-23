import { parseCommand } from "./helper.ts";

export type BotContext = {
  body: any;
  message: any | null;
  callback: any | null;
  msg: any;

  document: any | null; // Tambahan properti document

  chatId: number;
  telegramId: number;
  username: string | null;
  text: string | null;
  normalizedText: string | null;
  cmd: string | null;
  args: string[];
  user: any;
};

export function buildBotContext(body: any, user: any): BotContext | null {
  const message = body.message ?? null;
  const callback = body.callback_query ?? null;

  if (!message && !callback) return null;

  const msg = message || callback.message;
  const chatId = Number(msg?.chat?.id);
  const telegramId = Number(message?.from?.id || callback?.from?.id);
  const username = message?.from?.username || callback?.from?.username || null;

  const text = message?.text ?? null;
  const document = message?.document ?? null; // Ekstraksi document dari message

  const parsed = parseCommand(text);

  return {
    body,
    message,
    callback,
    msg,

    document, // Return properti document

    chatId,
    telegramId,
    username,
    text,
    normalizedText: parsed.text,
    cmd: parsed.cmd,
    args: parsed.args,
    user,
  };
}