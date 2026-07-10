import type { BotContext } from "./context.ts";

type MessageHandlers = {
  handleProductNumberInput: (ctx: BotContext) => Promise<Response>;
  handleQtyCustomInput: (ctx: BotContext) => Promise<Response>; // Tambahkan ini
  handleUploadStockFile: (ctx: BotContext) => Promise<Response>;
};

export async function routeMessage(
  ctx: BotContext,
  handlers: MessageHandlers
): Promise<Response | null> {

  if (ctx.document) {
    return await handlers.handleUploadStockFile(ctx);
  }

  const { normalizedText } = ctx;

  if (!normalizedText) return null;

  // Prioritas 1: Jika user sedang input angka untuk Custom Qty
  if (/^\d+$/.test(normalizedText)) {
    // Kita panggil handleQtyCustomInput. 
    // Jika di dalam fungsi tersebut ternyata session tidak ditemukan, 
    // ia akan otomatis melakukan fallback ke handleProductNumberInput.
    return await handlers.handleQtyCustomInput(ctx);
  }

  return null;
}