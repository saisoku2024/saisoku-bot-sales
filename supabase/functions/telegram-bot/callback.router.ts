import type { BotContext } from "./context.ts";

type CallbackHandlers = {
  handleStartCallback: (ctx: BotContext) => Promise<Response>;
  handleSaldoMenu: (ctx: BotContext) => Promise<Response>;
  handleClaimVoucherMenu: (ctx: BotContext) => Promise<Response>;
  handleDailyAbsen: (ctx: BotContext) => Promise<Response>;
  handleRiwayat: (ctx: BotContext) => Promise<Response>;
  handlePopuler: (ctx: BotContext) => Promise<Response>;
  handleMenuLain: (ctx: BotContext) => Promise<Response>;
  handleProfile: (ctx: BotContext) => Promise<Response>;
  handleCreateDepositInvoice: (ctx: BotContext, data: string) => Promise<Response>;
  handleCancelDeposit: (ctx: BotContext, data: string) => Promise<Response>;
  handleConfirmDeposit: (ctx: BotContext, data: string) => Promise<Response>;
  handleApproveDeposit: (ctx: BotContext, data: string) => Promise<Response>;
  handleRejectDeposit: (ctx: BotContext, data: string) => Promise<Response>;
  handleConfirmOrder: (ctx: BotContext, data: string) => Promise<Response>;
  handleCancelOrder: (ctx: BotContext, data: string) => Promise<Response>;
  handleApproveOrder: (ctx: BotContext, data: string) => Promise<Response>;
  handleRejectOrder: (ctx: BotContext, data: string) => Promise<Response>;
  handleDeleteOrder: (ctx: BotContext, data: string) => Promise<Response>;
  handleQtyAction: (ctx: BotContext, data: string) => Promise<Response>;
  handleRefreshDetail: (ctx: BotContext, data: string) => Promise<Response>;
  handleBuySaldo: (ctx: BotContext, data: string) => Promise<Response>;
  handleBuyNow: (ctx: BotContext, data: string) => Promise<Response>;
  handleListProduk: (ctx: BotContext) => Promise<Response>;
  handleListProdukPage: (ctx: BotContext, data: string) => Promise<Response>;
};

export async function routeCallback(
  ctx: BotContext,
  handlers: CallbackHandlers
): Promise<Response | null> {
  const data = ctx.callback?.data;

  if (!data) return null;

  if (data === "ignore") {
    return new Response("ok");
  }

  if (data === "start") return await handlers.handleStartCallback(ctx);
  if (data === "saldo") return await handlers.handleSaldoMenu(ctx);
  if (data === "claim_voucher") return await handlers.handleClaimVoucherMenu(ctx);
  if (data === "daily_absen") return await handlers.handleDailyAbsen(ctx);
  if (data === "riwayat") return await handlers.handleRiwayat(ctx);
  if (data === "populer") return await handlers.handlePopuler(ctx);
  if (data === "menu_lain") return await handlers.handleMenuLain(ctx);
  if (data === "profil") return await handlers.handleProfile(ctx);
  if (data === "list_produk") return await handlers.handleListProduk(ctx);

  if (data.startsWith("list_produk_page_")) {
    return await handlers.handleListProdukPage(ctx, data);
  }

  if (data.startsWith("invoice_")) {
    return await handlers.handleCreateDepositInvoice(ctx, data);
  }

  if (data.startsWith("cancel_deposit_")) {
    return await handlers.handleCancelDeposit(ctx, data);
  }

  if (data.startsWith("confirm_deposit_")) {
    return await handlers.handleConfirmDeposit(ctx, data);
  }

  if (data.startsWith("approve_deposit_")) {
    return await handlers.handleApproveDeposit(ctx, data);
  }

  if (data.startsWith("reject_deposit_")) {
    return await handlers.handleRejectDeposit(ctx, data);
  }

  if (data.startsWith("confirm_order_")) {
    return await handlers.handleConfirmOrder(ctx, data);
  }

  if (data.startsWith("cancel_order_")) {
    return await handlers.handleCancelOrder(ctx, data);
  }

  if (data.startsWith("approve_order_")) {
    return await handlers.handleApproveOrder(ctx, data);
  }

  if (data.startsWith("reject_order_")) {
    return await handlers.handleRejectOrder(ctx, data);
  }

  if (data.startsWith("delete_order_")) {
    return await handlers.handleDeleteOrder(ctx, data);
  }

  if (data.startsWith("qty_")) {
    return await handlers.handleQtyAction(ctx, data);
  }

  if (data.startsWith("refresh_detail_")) {
    return await handlers.handleRefreshDetail(ctx, data);
  }

  if (data.startsWith("buy_saldo_")) {
    return await handlers.handleBuySaldo(ctx, data);
  }

  if (data.startsWith("buy_now_")) {
    return await handlers.handleBuyNow(ctx, data);
  }

  return null;
}