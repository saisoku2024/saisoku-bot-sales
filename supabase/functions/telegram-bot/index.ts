export const config = {
  verify_jwt: false,
};

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { ENV } from "./env.ts";
import { supabase } from "./supabase.ts";
import {
  getOrCreateUser,
  getRoleByTelegramId,
} from "./user.repo.ts";

import {
  send,
  sendPhoto,
  answerCallback,
} from "./telegram.ts";

import {
  rupiah,
  escapeHtml,
} from "./helper.ts";

import { buildBotContext, type BotContext } from "./context.ts";
import { routeCommand } from "./command.router.ts";
import { routeCallback } from "./callback.router.ts";
import { routeMessage } from "./message.router.ts";
import {
  claimVoucherByCode,
} from "./services/voucher.service.ts";

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
  handleProductNumberInput,
  handleQtyAction,
  handleRefreshDetail,
  handleListProduk,
  handleListProdukPage,
} from "./src/handlers/product.handler.ts";

import {
  isOwner,
  isAdminOrOwner,
  sendWrongFormat,
  broadcastToAllUsers,
} from "./src/handlers/admin.handler.ts";

function ok() {
  return new Response("ok");
}

// ===============================
// HELPERS YANG MASIH DIPAKAI DI INDEX
// ===============================



// ===============================
// HANDLERS
// ===============================
async function renderStartMenu(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, username, user, message } = ctx;
  const START_IMAGE_URL = ENV.START_IMAGE_URL;

  const { data: dashboardRows, error: dashboardError } = await supabase.rpc(
    "get_user_dashboard_summary",
    {
      p_telegram_id: telegramId,
    }
  );

  if (dashboardError) {
    console.error("START dashboardError:", dashboardError);
  }

  const dashboard = dashboardRows?.[0];
  const currentUser = dashboard || user;

  const fullName =
    [message?.from?.first_name, message?.from?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || (username ? `@${username}` : `User ${telegramId}`);

  const textMessage = `Halo ${escapeHtml(fullName)} 👋
Selamat datang di SAISOKU.ID

<b>User Info</b>
└ ID : <code>${telegramId}</code>
└ Username : ${username ? `@${escapeHtml(username)}` : "-"}
└ Role : <b>${escapeHtml(currentUser.role || "reguler")}</b>
└ Saldo : ${rupiah(Number(currentUser.balance || 0))}
└ Total Beli : ${Number(dashboard?.total_buy || 0)} pcs
└ Total Transaksi : ${rupiah(Number(dashboard?.total_spent || 0))}

<b>Bot Info</b>
└ Terjual : ${Number(dashboard?.total_terjual || 0)} pcs
└ Total Transaksi : ${rupiah(Number(dashboard?.total_revenue || 0))}
└ Total Pengguna : ${Number(dashboard?.total_users || 0)}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "🛒 List Produk", callback_data: "list_produk" },
        { text: "💰 Saldo", callback_data: "saldo" },
      ],
      [
        { text: "🎮 Mini Games", callback_data: "daily_absen" },
        { text: "⚙ Menu Lain", callback_data: "menu_lain" },
      ],
    ],
  };

  try {
    await sendPhoto(chatId, START_IMAGE_URL, textMessage, keyboard);
  } catch (err) {
    console.error("START sendPhoto error:", err);
    await send(chatId, textMessage, keyboard);
  }

  return ok();
}

async function handleStartCommand(ctx: BotContext): Promise<Response> {
  return await renderStartMenu(ctx);
}

async function handleStartCallback(ctx: BotContext): Promise<Response> {
  return await renderStartMenu(ctx);
}

async function handleClaimVoucherCommand(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, args } = ctx;

  if (args.length < 1) {
    await sendWrongFormat(
      chatId,
      "/claimvoucher",
      `<code>/claimvoucher &lt;kode&gt;</code>

Contoh:
<code>/claimvoucher SAISOKU100</code>`
    );
    return ok();
  }

  await claimVoucherByCode(chatId, telegramId, args[0]);
  return ok();
}

async function handleManagedAdminCommand(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, args, cmd } = ctx;

  const actorRole = await getRoleByTelegramId(telegramId);

  if (cmd === "/setrole") {
    if (!isOwner(actorRole)) {
      await send(chatId, "❌ Hanya OWNER yang bisa mengubah role.");
      return ok();
    }

    if (args.length < 2) {
      await sendWrongFormat(
        chatId,
        "/setrole",
        `<code>/setrole &lt;telegram_id&gt; &lt;role&gt;</code>

Contoh:
<code>/setrole 123456789 admin</code>

Role tersedia:
<code>reguler</code>, <code>reseller</code>, <code>admin</code>, <code>owner</code>`
      );
      return ok();
    }

    const targetTelegramId = Number(args[0]);
    const newRole = String(args[1] || "").toLowerCase();
    const allowedRoles = ["reguler", "reseller", "admin", "owner"];

    if (!targetTelegramId) {
      await send(chatId, "❌ Telegram ID tidak valid.");
      return ok();
    }

    if (!allowedRoles.includes(newRole)) {
      await send(
        chatId,
        `❌ Role tidak valid.\nRole tersedia: ${allowedRoles.join(", ")}`
      );
      return ok();
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from("users")
      .select("id, telegram_id, username, role")
      .eq("telegram_id", targetTelegramId)
      .single();

    if (targetUserError) {
      console.error("SETROLE target user error:", targetUserError);
    }

    if (!targetUser) {
      await send(chatId, "❌ User target tidak ditemukan.");
      return ok();
    }

    const { error: updateRoleError } = await supabase
      .from("users")
      .update({ role: newRole })
      .eq("telegram_id", targetTelegramId);

    if (updateRoleError) {
      console.error("SETROLE update error:", updateRoleError);
      await send(chatId, "❌ Gagal mengubah role user.");
      return ok();
    }

    await send(
      chatId,
      `✅ Role user ${targetTelegramId} berhasil diubah menjadi <b>${newRole}</b>.`
    );

    try {
      await send(
        targetTelegramId,
        `🔔 Role akun kamu telah diubah menjadi <b>${newRole}</b>.`
      );
    } catch (err) {
      console.error("SETROLE notify target error:", err);
    }

    return ok();
  }

  if (!isAdminOrOwner(actorRole)) {
    await send(chatId, "❌ Hanya admin/owner yang memiliki akses.");
    return ok();
  }

  if (cmd === "/broadcast") {
    const messageText = args.join(" ").trim();

    if (!messageText) {
      await sendWrongFormat(
        chatId,
        "/broadcast",
        `<code>/broadcast &lt;pesan&gt;</code>

Contoh:
<code>/broadcast Promo hari ini diskon 20% untuk semua user</code>`
      );
      return ok();
    }

    await send(chatId, "⏳ Broadcast sedang dikirim...");

    const result = await broadcastToAllUsers(
      `📢 <b>BROADCAST ADMIN</b>

${messageText}`
    );

    if (result.error) {
      await send(chatId, `❌ Broadcast gagal.\n<code>${result.error}</code>`);
      return ok();
    }

    await send(
      chatId,
      `✅ Broadcast selesai

└ Total User : <b>${result.total}</b>
└ Berhasil : <b>${result.success}</b>
└ Gagal : <b>${result.failed}</b>`
    );

    return ok();
  }

  if (cmd === "/ban") {
    if (args.length < 1) {
      await sendWrongFormat(
        chatId,
        "/ban",
        `<code>/ban &lt;telegram_id&gt;</code>

Contoh:
<code>/ban 123456789</code>`
      );
      return ok();
    }

    const targetTelegramId = Number(args[0]);

    if (!targetTelegramId) {
      await send(chatId, "❌ Telegram ID tidak valid.");
      return ok();
    }

    if (targetTelegramId === telegramId) {
      await send(chatId, "❌ Kamu tidak bisa ban akun sendiri.");
      return ok();
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from("users")
      .select("id, role, is_banned")
      .eq("telegram_id", targetTelegramId)
      .single();

    if (targetUserError) {
      console.error("BAN targetUserError:", targetUserError);
    }

    if (!targetUser) {
      await send(chatId, "❌ User target tidak ditemukan.");
      return ok();
    }

    if (targetUser.role === "owner") {
      await send(chatId, "❌ Owner tidak bisa diban.");
      return ok();
    }

    if (targetUser.is_banned) {
      await send(chatId, "⚠️ User tersebut sudah dalam status banned.");
      return ok();
    }

    const { error: banError } = await supabase
      .from("users")
      .update({ is_banned: true })
      .eq("telegram_id", targetTelegramId);

    if (banError) {
      console.error("BAN banError:", banError);
      await send(chatId, "❌ Gagal memban user.");
      return ok();
    }

    await send(chatId, `✅ User ${targetTelegramId} berhasil diban.`);

    try {
      await send(
        targetTelegramId,
        "⛔ Akun kamu telah diban oleh admin. Hubungi admin jika merasa ini kesalahan."
      );
    } catch (err) {
      console.error("BAN notify target error:", err);
    }

    return ok();
  }

  if (cmd === "/unban") {
    if (args.length < 1) {
      await sendWrongFormat(
        chatId,
        "/unban",
        `<code>/unban &lt;telegram_id&gt;</code>

Contoh:
<code>/unban 123456789</code>`
      );
      return ok();
    }

    const targetTelegramId = Number(args[0]);

    if (!targetTelegramId) {
      await send(chatId, "❌ Telegram ID tidak valid.");
      return ok();
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from("users")
      .select("id, is_banned")
      .eq("telegram_id", targetTelegramId)
      .single();

    if (targetUserError) {
      console.error("UNBAN targetUserError:", targetUserError);
    }

    if (!targetUser) {
      await send(chatId, "❌ User target tidak ditemukan.");
      return ok();
    }

    if (!targetUser.is_banned) {
      await send(chatId, "⚠️ User tersebut tidak dalam status banned.");
      return ok();
    }

    const { error: unbanError } = await supabase
      .from("users")
      .update({ is_banned: false })
      .eq("telegram_id", targetTelegramId);

    if (unbanError) {
      console.error("UNBAN unbanError:", unbanError);
      await send(chatId, "❌ Gagal membuka ban user.");
      return ok();
    }

    await send(chatId, `✅ User ${targetTelegramId} berhasil di-unban.`);

    try {
      await send(
        targetTelegramId,
        "✅ Akun kamu sudah di-unban. Sekarang kamu bisa menggunakan bot lagi."
      );
    } catch (err) {
      console.error("UNBAN notify target error:", err);
    }

    return ok();
  }

  if (cmd === "/addsaldo" || cmd === "/addbalance") {
  if (args.length < 2) {
    await sendWrongFormat(
      chatId,
      String(cmd),
      `<code>/addsaldo &lt;telegram_id&gt; &lt;nominal&gt;</code>
atau
<code>/addbalance &lt;telegram_id&gt; &lt;nominal&gt;</code>

Contoh:
<code>/addsaldo 123456789 10000</code>
<code>/addbalance 123456789 10000</code>`
    );
    return ok();
  }

  const targetTelegramId = Number(args[0]);
  const amount = Number(args[1]);

  if (!targetTelegramId || !amount || amount <= 0) {
    await send(chatId, "❌ Telegram ID atau nominal tidak valid.");
    return ok();
  }

  const { data, error } = await supabase.rpc("admin_add_balance", {
    p_actor_telegram_id: telegramId,
    p_target_telegram_id: targetTelegramId,
    p_amount: amount,
  });

  if (error) {
    console.error("ADDSALDO RPC error:", error);
    await send(chatId, "❌ Gagal menambah saldo.");
    return ok();
  }

  const result = data?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal menambah saldo."}`);
    return ok();
  }

  await send(
    chatId,
    `✅ Berhasil menambah saldo ${rupiah(amount)} ke ID ${targetTelegramId}.\nSaldo baru: ${rupiah(result.new_balance)}`
  );

  try {
    await send(
      targetTelegramId,
      `🔔 Saldo kamu bertambah ${rupiah(amount)}.\nSaldo sekarang: ${rupiah(result.new_balance)}`
    );
  } catch (err) {
    console.error("ADDSALDO notify target error:", err);
  }

  return ok();
}

    if (cmd === "/kurangsaldo") {
    if (args.length < 2) {
      await sendWrongFormat(
        chatId,
        "/kurangsaldo",
        `<code>/kurangsaldo &lt;telegram_id&gt; &lt;nominal&gt;</code>

Contoh:
<code>/kurangsaldo 123456789 5000</code>`
      );
      return ok();
    }

    const targetTelegramId = Number(args[0]);
    const amount = Number(args[1]);

    if (!targetTelegramId || !amount || amount <= 0) {
      await send(chatId, "❌ Telegram ID atau nominal tidak valid.");
      return ok();
    }

    const { data, error } = await supabase.rpc("admin_reduce_balance", {
      p_actor_telegram_id: telegramId,
      p_target_telegram_id: targetTelegramId,
      p_amount: amount,
    });

    if (error) {
      console.error("KURANGSALDO RPC error:", error);
      await send(chatId, "❌ Gagal mengurangi saldo.");
      return ok();
    }

    const result = data?.[0];

    if (!result?.success) {
      await send(chatId, `❌ ${result?.message || "Gagal mengurangi saldo."}`);
      return ok();
    }

    await send(
      chatId,
      `✅ Berhasil mengurangi saldo ${rupiah(amount)} dari ID ${targetTelegramId}.\nSaldo baru: ${rupiah(result.new_balance)}`
    );

    try {
      await send(
        targetTelegramId,
        `🔔 Saldo kamu dikurangi ${rupiah(amount)}.\nSaldo sekarang: ${rupiah(result.new_balance)}`
      );
    } catch (err) {
      console.error("KURANGSALDO notify target error:", err);
    }

    return ok();
  }

  return ok();
}

// ===============================
// SERVER
// ===============================
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const expected = ENV.TELEGRAM_WEBHOOK_SECRET ?? "";
  const incoming = req.headers.get("x-telegram-bot-api-secret-token") ?? "";

  if (!expected || incoming !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response("bad request", { status: 400 });
    }

    const body = await req.json();

    const callback = body.callback_query;
    if (callback) {
      try {
        await answerCallback(callback.id);
      } catch (err) {
        console.error("answerCallback error:", err);
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

    if (user.is_banned) {
      if (callback || message?.text) {
        await send(
          chatId,
          "⛔ Akun kamu sedang dibanned. Hubungi admin jika merasa ini kesalahan."
        );
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
      handleRefreshDetail,
      handleBuySaldo,
      handleBuyNow,
      handleListProduk,
      handleListProdukPage,
      handleProfile,
    });
    if (callbackResponse) return callbackResponse;

    const messageResponse = await routeMessage(ctx, {
      handleProductNumberInput,
    });
    if (messageResponse) return messageResponse;

    return ok();
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    return ok();
  }
});