import { send } from "../../telegram.ts";
import type { BotContext } from "../../context.ts";

function ok() {
  return new Response("ok");
}

export async function handleStockMenu(
  ctx: BotContext
): Promise<Response> {
  const { chatId } = ctx;

  await send(
    chatId,
    "📦 <b>STOCK MANAGEMENT</b>\n\nPilih menu yang tersedia.",
    {
      inline_keyboard: [
        [
          {
            text: "📤 Upload Stock",
            callback_data: "upload_stock",
          },
        ],
        [
          {
            text: "📊 Stock Summary",
            callback_data: "stock_summary",
          },
        ],
      ],
    }
  );

  return ok();
}