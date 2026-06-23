import type { BotContext } from "./context.ts";

type MessageHandlers = {
  handleProductNumberInput: (ctx: BotContext) => Promise<Response>;
};

export async function routeMessage(
  ctx: BotContext,
  handlers: MessageHandlers
): Promise<Response | null> {
  const { normalizedText } = ctx;

  if (!normalizedText) return null;

  if (/^\d+$/.test(normalizedText)) {
    return await handlers.handleProductNumberInput(ctx);
  }

  return null;
}