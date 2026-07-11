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
  handleQtyCustom: (ctx: BotContext, data: string) => Promise<Response>;
  handleRefreshDetail: (ctx: BotContext, data: string) => Promise<Response>;
  handleBuySaldo: (ctx: BotContext, data: string) => Promise<Response>;
  handleBuyNow: (ctx: BotContext, data: string) => Promise<Response>;
  handleListProduk: (ctx: BotContext) => Promise<Response>;
  handleListProdukPage: (ctx: BotContext, data: string) => Promise<Response>;
  handlePickProduct: (ctx: BotContext, data: string) => Promise<Response>;
  handleStockMenu: (ctx: BotContext) => Promise<Response>;
  handleUploadStock: (ctx: BotContext) => Promise<Response>;
  handleUploadStockPage: (ctx: BotContext, data: string) => Promise<Response>;
  handleSelectUploadProduct: (ctx: BotContext, data: string) => Promise<Response>;
};

export async function routeCallback(
  ctx: BotContext,
  handlers: CallbackHandlers
): Promise<Response | null> {
  const data = ctx.callback?.data;

  if (!data) return null;

  if (data === "ignore" || data === "noop") {
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
  if (data === "ticket") {
    const { handleTicketMenu } = await import("./src/handlers/ticket.handler.ts");
    return await handleTicketMenu(ctx);
  }
  if (data === "cancel_ticket_session") {
    const { handleCancelTicketSession } = await import("./src/handlers/ticket.handler.ts");
    return await handleCancelTicketSession(ctx);
  }
  if (data.startsWith("resolve_ticket_")) {
    const { handleResolveTicketUser } = await import("./src/handlers/ticket.handler.ts");
    return await handleResolveTicketUser(ctx, data);
  }

  if (data === "active_orders" || data.startsWith("active_orders_page_")) {
    const { handleActiveOrdersList } = await import("./src/handlers/active_orders.handler.ts");
    return await handleActiveOrdersList(ctx, data);
  }
  if (data === "rekap_txt") {
    const { handleExportRekapTxt } = await import("./src/handlers/active_orders.handler.ts");
    return await handleExportRekapTxt(ctx);
  }
  if (data.startsWith("view_order_detail_")) {
    const { handleViewOrderDetail } = await import("./src/handlers/active_orders.handler.ts");
    return await handleViewOrderDetail(ctx, data);
  }
  if (data.startsWith("claim_warranty_menu_")) {
    const { handleClaimWarrantyMenu } = await import("./src/handlers/active_orders.handler.ts");
    return await handleClaimWarrantyMenu(ctx, data);
  }
  if (data.startsWith("apply_warranty_claim_")) {
    const { handleApplyWarrantyClaim } = await import("./src/handlers/active_orders.handler.ts");
    return await handleApplyWarrantyClaim(ctx, data);
  }
  if (data === "cancel_warranty_session") {
    const { handleCancelWarrantySession } = await import("./src/handlers/active_orders.handler.ts");
    return await handleCancelWarrantySession(ctx);
  }
  if (data === "search_order_start") {
    const { handleSearchOrderStart } = await import("./src/handlers/active_orders.handler.ts");
    return await handleSearchOrderStart(ctx);
  }
  if (data === "calc_refund" || data.startsWith("calc_refund_page_")) {
    const { handleRefundCalculatorStart } = await import("./src/handlers/active_orders.handler.ts");
    return await handleRefundCalculatorStart(ctx, data);
  }
  if (data.startsWith("calc_refund_select_")) {
    const { handleRefundCalculatorSelectOrder } = await import("./src/handlers/active_orders.handler.ts");
    return await handleRefundCalculatorSelectOrder(ctx, data);
  }
  if (data.startsWith("calc_refund_coef_")) {
    const { handleRefundCalculatorOutput } = await import("./src/handlers/active_orders.handler.ts");
    return await handleRefundCalculatorOutput(ctx, data);
  }

  if (data.startsWith("list_produk_page_")) {
    return await handlers.handleListProdukPage(ctx, data);
  }

  if (data.startsWith("pick_product_")) {
    return await handlers.handlePickProduct(ctx, data);
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

  // Routing khusus untuk Custom Qty
  if (data.startsWith("qty_custom_")) {
    return await handlers.handleQtyCustom(ctx, data);
  }

  // Routing untuk aksi qty lainnya
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

  if (data === "stock_menu") {
    return await handlers.handleStockMenu(ctx);
  }

  if (data === "upload_stock") {
    return await handlers.handleUploadStock(ctx);
  }

  if (data.startsWith("upload_stock_page_")) {
    return await handlers.handleUploadStockPage(ctx, data);
  }

  if (data.startsWith("upload_product_")) {
    return await handlers.handleSelectUploadProduct(ctx, data);
  }

  return null;
}
