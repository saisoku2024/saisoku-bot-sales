export const config = {
  // Telegram cannot send a Supabase JWT. Each request is authenticated with
  // x-telegram-bot-api-secret-token below instead.
  verify_jwt: false,
};

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import {
  handleStartCommand,
  handleStartCallback,
} from "./src/handlers/start.handler.ts";

import { ENV } from "./env.ts";
import {
  getOrCreateUser,
  getUserRestrictedMessage,
  isUserRestricted,
} from "./user.repo.ts";

import {
  send,
  answerCallback,
} from "./telegram.ts";

import { buildBotContext } from "./context.ts";
import { routeCommand } from "./command.router.ts";
import { routeCallback } from "./callback.router.ts";
import { routeMessage } from "./message.router.ts";
import { handleClaimVoucherCommand } from "./src/handlers/voucher.handler.ts";
import { logCaughtBotError } from "./error-logger.ts";

import {
  handleCreateDepositInvoice,
  handleCancelDeposit,
  handleConfirmDeposit,
  handleApproveDeposit,
  handleRejectDeposit,
} from "./services/deposit.service.ts";

import {
  handleConfirmOrder,
  handleDeleteOrder,
  handleCancelOrder,
  handleApproveOrder,
  handleRejectOrder,
  handleBuySaldo,
  handleBuyNow,
} from "./services/order.service.ts";

import {
  handleSaldoMenu,
  handleClaimVoucherMenu,
  handleDailyAbsen,
  handleRiwayat,
  handlePopuler,
  handleMenuLain,
  handleProfile,
} from "./src/handlers/menu.handler.ts";

import {
  handleStockMenu,
  handleUploadStock,
  handleUploadStockPage,
  handleSelectUploadProduct,
  handleUploadStockFile,
} from "./src/handlers/stock.handler.ts";

import {
  handleProductNumberInput,
  handleQtyAction,
  handleQtyCustom,
  handleRefreshDetail,
  handleListProduk,
  handleListProdukPage,
  handlePickProduct,
  handleQtyCustomInput,
} from "./src/handlers/product.handler.ts";

import {
  handleManagedAdminCommand,
} from "./src/handlers/admin.handler.ts";

function ok() {
  return new Response("ok");
}

function getUpdateMeta(body: any) {
  const callback = body?.callback_query;
  const message = body?.message;
  const msg = message || callback?.message;

  return {
    update_id: body?.update_id ?? null,
    update_type: callback ? "callback_query" : message ? "message" : "unknown",
    chat_id: msg?.chat?.id ?? null,
    telegram_id: message?.from?.id || callback?.from?.id || null,
    username: message?.from?.username || callback?.from?.username || null,
    callback_data: callback?.data ? String(callback.data).slice(0, 160) : null,
    text: message?.text ? String(message.text).slice(0, 160) : null,
  };
}

// ===============================
// SERVER
// ===============================
serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const expected = ENV.TELEGRAM_WEBHOOK_SECRET;
  const incoming = req.headers.get("x-telegram-bot-api-secret-token") ?? "";

  if (incoming !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  let updateMeta: Record<string, unknown> = {};

  try {
    const contentType = req.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("application/json")) {
      return new Response("bad request", { status: 400 });
    }

    const body = await req.json();
    updateMeta = getUpdateMeta(body);

    const callback = body.callback_query;
    if (callback) {
      try {
        await answerCallback(callback.id);
      } catch (err) {
        console.error("answerCallback error:", err);
        await logCaughtBotError(err, {
          route: "telegram.answerCallback",
          actor: callback?.from?.id || null,
          metadata: getUpdateMeta(body),
        });
      }
    }

    const message = body.message;
    if (!message && !callback) {
      return ok();
    }

    const msg = message || callback.message;
    const chatId = Number(msg?.chat?.id);
    const telegramId = Number(message?.from?.id || callback?.from?.id);
    const username = message?.from?.username || callback?.from?.username || null;

    const user = await getOrCreateUser(telegramId, username);

    if (!user) {
      await send(chatId, "❌ Gagal memuat data user.");
      return ok();
    }

    if (isUserRestricted(user)) {
      if (callback || message?.text) {
        await send(chatId, getUserRestrictedMessage(user));
      }
      return ok();
    }

    const ctx = buildBotContext(body, user);
    if (!ctx) return ok();

    const commandResponse = await routeCommand(ctx, {
      handleStartCommand,
      handleClaimVoucherCommand,
      handleManagedAdminCommand,
    });
    if (commandResponse) return commandResponse;

    const callbackResponse = await routeCallback(ctx, {
      handleStartCallback,
      handleSaldoMenu,
      handleClaimVoucherMenu,
      handleDailyAbsen,
      handleRiwayat,
      handlePopuler,
      handleMenuLain,
      handleProfile,
      handleStockMenu,
      handleUploadStock,
      handleUploadStockPage,
      handleSelectUploadProduct,
      handleCreateDepositInvoice,
      
      handleCancelDeposit,
      handleConfirmDeposit,
      handleApproveDeposit,
      handleRejectDeposit,

      handleConfirmOrder,
      handleCancelOrder,
      handleApproveOrder,
      handleRejectOrder,
      handleDeleteOrder,

      handleQtyAction,
      handleQtyCustom,
      handleRefreshDetail,
      handleBuySaldo,
      handleBuyNow,

      handleListProduk,
      handleListProdukPage,
      handlePickProduct,
    });
    if (callbackResponse) return callbackResponse;

    const messageResponse = await routeMessage(ctx, {
      handleProductNumberInput,
      handleQtyCustomInput,
      handleUploadStockFile,
    });
    if (messageResponse) return messageResponse;

    return ok();
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    await logCaughtBotError(err, {
      route: "telegram.webhook",
      metadata: { request_id: req.headers.get("x-request-id"), ...updateMeta },
    });
    return ok();
  }
});
