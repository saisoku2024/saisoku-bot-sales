import { supabase } from "./supabase.ts";
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
  const { data: ticketSession } = await supabase
    .from("ticket_sessions")
    .select("*")
    .eq("telegram_id", ctx.telegramId)
    .single();

  if (ticketSession) {
    const { handleTicketInput } = await import("./src/handlers/ticket.handler.ts");
    return await handleTicketInput(ctx);
  }

  const { data: searchSession } = await supabase
    .from("search_sessions")
    .select("*")
    .eq("telegram_id", ctx.telegramId)
    .single();

  if (searchSession) {
    const { handleSearchOrderInput } = await import("./src/handlers/active_orders.handler.ts");
    return await handleSearchOrderInput(ctx);
  }

  const { data: warrantySession } = await supabase
    .from("warranty_sessions")
    .select("*")
    .eq("telegram_id", ctx.telegramId)
    .single();

  if (warrantySession) {
    const { handleWarrantyPhotoInput, handleWarrantyDescriptionInput } = await import("./src/handlers/active_orders.handler.ts");
    if (warrantySession.step === "awaiting_photo") {
      return await handleWarrantyPhotoInput(ctx, warrantySession);
    }
    if (warrantySession.step === "awaiting_description") {
      return await handleWarrantyDescriptionInput(ctx, warrantySession);
    }
  }

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
