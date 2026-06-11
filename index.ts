export const config = {
  verify_jwt: false,
};

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { ENV } from "./env.ts";
import { supabase } from "./supabase.ts";
import {
  getOrCreateUser,
  getRoleByTelegramId,
  getUserIdByTelegramId,
} from "./user.repo.ts";
import {
  send,
  sendPhoto,
  editMessage,
  answerCallback,
  sendLongMessage,
} from "./telegram.ts";

import {
  rupiah,
  escapeHtml,
  normalizeVoucherCode,
} from "./helper.ts";

import { buildBotContext, type BotContext } from "./context.ts";
import { routeCommand } from "./command.router.ts";
import { routeCallback } from "./callback.router.ts";
import { routeMessage } from "./message.router.ts";
import {
  claimVoucherByCode,
  handleVoucherList,
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

function ok() {
  return new Response("ok");
}

// ===============================
// HELPERS YANG MASIH DIPAKAI DI INDEX
// ===============================
async function getProductDetailForBot(productId: string, userId: string) {
  const { data, error } = await supabase.rpc("get_product_detail_for_bot", {
    p_product_id: productId,
    p_user_id: userId,
  });

  if (error) {
    console.error("getProductDetailForBot RPC error:", error);
    return null;
  }

  return data?.[0] ?? null;
}

function isOwner(role: string) {
  return role === "owner";
}

function isAdminOrOwner(role: string) {
  return role === "admin" || role === "owner";
}



async function sendWrongFormat(
  chatId: number,
  command: string,
  usage: string
) {
  await send(
    chatId,
    `❌ <b>Salah format command</b>

Command: <code>${command}</code>

Cara input yang benar:
${usage}`
  );
}

async function broadcastToAllUsers(text: string) {
  const { data: users, error } = await supabase
    .from("users")
    .select("telegram_id, is_banned")
    .not("telegram_id", "is", null);

  if (error) {
    console.error("broadcastToAllUsers error:", error);
    return { success: 0, failed: 0, total: 0, error: error.message };
  }

  let success = 0;
  let failed = 0;
  const recipients = (users || []).filter((u: any) => !u.is_banned);

  for (const u of recipients) {
    try {
      if (!u.telegram_id) continue;
      await send(Number(u.telegram_id), text);
      success++;
    } catch (err) {
      console.error("broadcast send error:", err);
      failed++;
    }
  }

  return {
    success,
    failed,
    total: recipients.length,
    error: null,
  };
}

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

  if (
    ["/addvoucher", "/delvoucher", "/nonaktifvoucher", "/aktifvoucher"].includes(
      String(cmd)
    )
  ) {
    if (!isOwner(actorRole)) {
      await send(chatId, "❌ Hanya OWNER yang bisa mengelola voucher.");
      return ok();
    }

    if (cmd === "/addvoucher") {
      if (args.length < 3) {
        await sendWrongFormat(
          chatId,
          "/addvoucher",
          `<code>/addvoucher &lt;kode&gt; &lt;nominal&gt; &lt;quota&gt;</code>

Contoh:
<code>/addvoucher SAISOKU100 10000 50</code>`
        );
        return ok();
      }

      const code = normalizeVoucherCode(args[0]);
      const rewardAmount = Number(args[1]);
      const quota = Number(args[2]);

      if (!code || rewardAmount <= 0 || quota <= 0) {
        await send(chatId, "❌ Kode, nominal, atau quota tidak valid.");
        return ok();
      }

      const { data: existingVoucher, error: existingVoucherError } = await supabase
        .from("vouchers")
        .select("id")
        .eq("code", code)
        .maybeSingle();

      if (existingVoucherError) {
        console.error("ADDVOUCHER existingVoucherError:", existingVoucherError);
      }

      if (existingVoucher) {
        await send(chatId, `❌ Voucher <b>${code}</b> sudah ada.`);
        return ok();
      }

      const { error: insertVoucherError } = await supabase
        .from("vouchers")
        .insert({
          code,
          reward_type: "balance",
          reward_amount: rewardAmount,
          quota,
          used_count: 0,
          is_active: true,
        });

      if (insertVoucherError) {
        console.error("ADDVOUCHER insertVoucherError:", insertVoucherError);
        await send(
          chatId,
          `❌ Gagal membuat voucher.\n<code>${insertVoucherError.message}</code>`
        );
        return ok();
      }

      await send(
        chatId,
        `✅ Voucher berhasil dibuat

└ Kode : <code>${code}</code>
└ Nominal : <b>${rupiah(rewardAmount)}</b>
└ Quota : <b>${quota}</b>
└ Status : <b>aktif</b>
└ Creator : <b>OWNER</b>`
      );

      return ok();
    }

    if (cmd === "/delvoucher") {
      if (args.length < 1) {
        await sendWrongFormat(
          chatId,
          "/delvoucher",
          `<code>/delvoucher &lt;kode&gt;</code>

Contoh:
<code>/delvoucher SAISOKU100</code>`
        );
        return ok();
      }

      const code = normalizeVoucherCode(args[0]);

      const { data: voucher, error: voucherError } = await supabase
        .from("vouchers")
        .select("id, code")
        .eq("code", code)
        .maybeSingle();

      if (voucherError) {
        console.error("DELVOUCHER voucherError:", voucherError);
      }

      if (!voucher) {
        await send(chatId, "❌ Voucher tidak ditemukan.");
        return ok();
      }

      const { error: deleteVoucherError } = await supabase
        .from("vouchers")
        .delete()
        .eq("id", voucher.id);

      if (deleteVoucherError) {
        console.error("DELVOUCHER deleteVoucherError:", deleteVoucherError);
        await send(
          chatId,
          `❌ Gagal menghapus voucher.\n<code>${deleteVoucherError.message}</code>`
        );
        return ok();
      }

      await send(chatId, `✅ Voucher <code>${code}</code> berhasil dihapus.`);
      return ok();
    }

    if (cmd === "/nonaktifvoucher") {
      if (args.length < 1) {
        await sendWrongFormat(
          chatId,
          "/nonaktifvoucher",
          `<code>/nonaktifvoucher &lt;kode&gt;</code>

Contoh:
<code>/nonaktifvoucher SAISOKU100</code>`
        );
        return ok();
      }

      const code = normalizeVoucherCode(args[0]);

      const { data: voucher, error: voucherError } = await supabase
        .from("vouchers")
        .select("id, code")
        .eq("code", code)
        .maybeSingle();

      if (voucherError) {
        console.error("NONAKTIFVOUCHER voucherError:", voucherError);
      }

      if (!voucher) {
        await send(chatId, "❌ Voucher tidak ditemukan.");
        return ok();
      }

      const { error: updateVoucherError } = await supabase
        .from("vouchers")
        .update({ is_active: false })
        .eq("id", voucher.id);

      if (updateVoucherError) {
        console.error("NONAKTIFVOUCHER updateVoucherError:", updateVoucherError);
        await send(
          chatId,
          `❌ Gagal menonaktifkan voucher.\n<code>${updateVoucherError.message}</code>`
        );
        return ok();
      }

      await send(chatId, `✅ Voucher <code>${code}</code> berhasil dinonaktifkan.`);
      return ok();
    }

    if (cmd === "/aktifvoucher") {
      if (args.length < 1) {
        await sendWrongFormat(
          chatId,
          "/aktifvoucher",
          `<code>/aktifvoucher &lt;kode&gt;</code>

Contoh:
<code>/aktifvoucher SAISOKU100</code>`
        );
        return ok();
      }

      const code = normalizeVoucherCode(args[0]);

      const { data: voucher, error: voucherError } = await supabase
        .from("vouchers")
        .select("id, code")
        .eq("code", code)
        .maybeSingle();

      if (voucherError) {
        console.error("AKTIFVOUCHER voucherError:", voucherError);
      }

      if (!voucher) {
        await send(chatId, "❌ Voucher tidak ditemukan.");
        return ok();
      }

      const { error: updateVoucherError } = await supabase
        .from("vouchers")
        .update({ is_active: true })
        .eq("id", voucher.id);

      if (updateVoucherError) {
        console.error("AKTIFVOUCHER updateVoucherError:", updateVoucherError);
        await send(
          chatId,
          `❌ Gagal mengaktifkan voucher.\n<code>${updateVoucherError.message}</code>`
        );
        return ok();
      }

      await send(chatId, `✅ Voucher <code>${code}</code> berhasil diaktifkan.`);
      return ok();
    }
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

if (cmd === "/voucherlist") {
  await handleVoucherList(chatId);
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

async function handleSaldoMenu(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const { data: freshUser, error } = await supabase
    .from("users")
    .select("balance, role")
    .eq("telegram_id", telegramId)
    .single();

  if (error) {
    console.error("SALDO MENU error:", error);
  }

  const saldoText = `💰 <b>MENU SALDO</b>

└ Saldo Kamu : <b>${rupiah(freshUser?.balance || 0)}</b>
└ Role : <b>${freshUser?.role || "reguler"}</b>

Silakan pilih menu saldo atau nominal deposit.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🎟 Klaim Voucher", callback_data: "claim_voucher" }],
      [
        { text: "10.000", callback_data: "invoice_10000" },
        { text: "20.000", callback_data: "invoice_20000" },
      ],
      [
        { text: "50.000", callback_data: "invoice_50000" },
        { text: "100.000", callback_data: "invoice_100000" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "start" }],
    ],
  };

  await send(chatId, saldoText, keyboard);
  return ok();
}

async function handleClaimVoucherMenu(ctx: BotContext): Promise<Response> {
  const { chatId } = ctx;

  await send(
    chatId,
    `🎟 <b>KLAIM VOUCHER</b>

Gunakan command berikut:
<code>/claimvoucher SAISOKU100</code>

Semua role bisa klaim voucher selama:
- voucher aktif
- quota masih ada
- belum pernah klaim voucher yang sama`
  );

  return ok();
}

async function handleDailyAbsen(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const reward = 100;

  const { data, error } = await supabase.rpc("claim_daily_checkin", {
    p_telegram_id: telegramId,
    p_reward: reward,
  });

  if (error) {
    console.error("DAILY ABSEN RPC error:", error);
    await send(chatId, "❌ Gagal memproses absen.");
    return ok();
  }

  const result = data?.[0];

  if (!result?.success) {
    await send(chatId, `⛔ ${result?.message || "Absen gagal."}`);
    return ok();
  }

  await send(
    chatId,
    `✅ <b>ABSEN BERHASIL</b>\n\nKamu dapat bonus ${rupiah(reward)}\nSaldo sekarang: <b>${rupiah(result.new_balance)}</b>`
  );

  return ok();
}

async function handleRiwayat(ctx: BotContext): Promise<Response> {
  const { chatId, user } = ctx;

  const { data: trx, error } = await supabase
    .from("transactions")
    .select("id, product_id, price, status, purchased_at")
    .eq("user_id", user.id)
    .order("purchased_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("RIWAYAT ERROR:", error);
    await send(chatId, "❌ Gagal mengambil riwayat transaksi.");
    return ok();
  }

  if (!trx || trx.length === 0) {
    await send(chatId, "📂 Belum ada riwayat transaksi.");
    return ok();
  }

  const productIds = [...new Set(trx.map((t: any) => t.product_id).filter(Boolean))];

  let productMap: Record<string, string> = {};
  if (productIds.length > 0) {
    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);

    if (productError) {
      console.error("RIWAYAT productError:", productError);
    }

    for (const p of products || []) {
      productMap[String((p as any).id)] = (p as any).name;
    }
  }

  let textRiwayat = `📂 <b>RIWAYAT TRANSAKSI</b>\n`;

  trx.forEach((item: any, i: number) => {
    textRiwayat += `

${i + 1}. ${productMap[String(item.product_id)] || "Produk"}
└ Harga : ${rupiah(item.price)}
└ Status : ${item.status}
└ Waktu : ${item.purchased_at || "-"}
`;
  });

  await sendLongMessage(chatId, textRiwayat, {
    inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "menu_lain" }]],
  });

  return ok();
}

async function handlePopuler(ctx: BotContext): Promise<Response> {
  const { chatId } = ctx;

  const { data: trx, error } = await supabase
    .from("transactions")
    .select("product_id")
    .eq("status", "paid");

  if (error) {
    console.error("POPULER transactions error:", error);
    await send(chatId, "❌ Gagal mengambil produk populer.");
    return ok();
  }

  if (!trx || trx.length === 0) {
    await send(chatId, "⭐ Belum ada data produk populer.");
    return ok();
  }

  const counts: Record<string, number> = {};
  for (const row of trx) {
    const pid = String((row as any).product_id || "");
    if (!pid) continue;
    counts[pid] = (counts[pid] || 0) + 1;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topIds = sorted.map(([pid]) => pid);

  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id, name")
    .in("id", topIds);

  if (productError) {
    console.error("POPULER product error:", productError);
  }

  const mapName: Record<string, string> = {};
  for (const p of products || []) {
    mapName[String((p as any).id)] = (p as any).name;
  }

  let textPopuler = `⭐ <b>PRODUK POPULER</b>\n`;

  sorted.forEach(([pid, total], idx) => {
    textPopuler += `

${idx + 1}. ${mapName[pid] || "Produk"}
└ Terjual : ${total} pcs`;
  });

  await sendLongMessage(chatId, textPopuler, {
    inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "menu_lain" }]],
  });

  return ok();
}

async function handleMenuLain(ctx: BotContext): Promise<Response> {
  const { chatId } = ctx;

  const menuText = `⚙ <b>MENU LAIN</b>

Pilih menu tambahan yang tersedia.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "📂 Riwayat Transaksi", callback_data: "riwayat" }],
      [{ text: "⭐ Produk Populer", callback_data: "populer" }],
      [{ text: "⬅️ Kembali", callback_data: "start" }],
    ],
  };

  await send(chatId, menuText, keyboard);
  return ok();
}

async function handleProductNumberInput(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, normalizedText, user } = ctx;

  const pIdx = parseInt(String(normalizedText)) - 1;

  const { data: visibleProducts, error: visibleProductsError } = await supabase.rpc(
    "get_products_with_stock",
    {
      p_page: 1,
      p_limit: 1000,
    }
  );

  if (visibleProductsError) {
    console.error("DETAIL PRODUK visibleProductsError:", visibleProductsError);
    await send(chatId, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!visibleProducts || !visibleProducts[pIdx]) {
    await send(chatId, "❌ Nomor produk tidak valid.");
    return ok();
  }

  const productId = visibleProducts[pIdx].id;
  const userId = await getUserIdByTelegramId(telegramId);

  if (!userId) {
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  const product = await getProductDetailForBot(productId, userId);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan atau sedang nonaktif.");
    return ok();
  }

  const qty = 1;
  const stockNum = Number(product.stock_count || 0);
  const safeQty = stockNum > 0 ? Math.min(qty, stockNum) : 1;
  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * safeQty;

  const detailText = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || user.role}
• Sisa Stok : ${stockNum}
• Desk : ${product.description || "-"}
╰──────────────

╭──────────────
• Jumlah : ${safeQty}
• Harga : ${rupiah(unitPrice)}
• Total Harga : ${rupiah(totalPrice)}
╰──────────────
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `qty_minus_${product.product_id}_${safeQty}_${stockNum}` },
        { text: "✏️", callback_data: `qty_reset_${product.product_id}_${safeQty}_${stockNum}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${safeQty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${safeQty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${safeQty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${safeQty}` },
      ],
      [{ text: "⬅️ Kembali", callback_data: "list_produk" }],
    ],
  };

  await send(chatId, detailText, keyboard);
  return ok();
}

async function handleQtyAction(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId, user, msg } = ctx;

  const parts = data.split("_");
  const action = parts[1];
  const productId = parts[2];
  let qty = Number(parts[3] || 1);
  const stockFromCallback = Number(parts[4] || 0);

  if (!qty || qty < 1) qty = 1;

  const userId = await getUserIdByTelegramId(telegramId);

  if (!userId) {
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  const product = await getProductDetailForBot(productId, userId);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan.");
    return ok();
  }

  const stockNum = Number(product.stock_count ?? stockFromCallback ?? 0);
  const beforeQty = qty;

  if (action === "plus") {
    if (stockNum > 0 && qty < stockNum) {
      qty++;
    }
  }

  if (action === "minus" && qty > 1) {
    qty--;
  }

  if (action === "reset") {
    qty = 1;
  }

  if (stockNum > 0 && qty > stockNum) {
    qty = stockNum;
  }

  if (qty < 1) qty = 1;

  if (qty === beforeQty && action !== "reset") {
    return ok();
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * qty;

  const textDetail = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || user.role}
• Sisa Stok : ${stockNum}
• Desk : ${product.description || "-"}
╰──────────────

╭──────────────
• Jumlah : ${qty}
• Harga : ${rupiah(unitPrice)}
• Total Harga : ${rupiah(totalPrice)}
╰──────────────
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `qty_minus_${product.product_id}_${qty}_${stockNum}` },
        { text: "✏️", callback_data: `qty_reset_${product.product_id}_${qty}_${stockNum}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${qty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${qty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${qty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${qty}` },
      ],
      [{ text: "⬅️ Kembali", callback_data: "list_produk" }],
    ],
  };

  await editMessage(chatId, msg.message_id, textDetail, keyboard);
  return ok();
}

async function handleRefreshDetail(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId, user, msg } = ctx;

  const parts = data.split("_");
  const productId = parts[2];
  let qty = Number(parts[3] || 1);

  if (!qty || qty < 1) qty = 1;

  const userId = await getUserIdByTelegramId(telegramId);

  if (!userId) {
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  const product = await getProductDetailForBot(productId, userId);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan.");
    return ok();
  }

  const stockNum = Number(product.stock_count || 0);

  if (stockNum > 0 && qty > stockNum) {
    qty = stockNum;
  }

  if (qty < 1) {
    qty = 1;
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * qty;

  const textDetail = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || user.role}
• Sisa Stok : ${stockNum}
• Desk : ${product.description || "-"}
╰──────────────

╭──────────────
• Jumlah : ${qty}
• Harga : ${rupiah(unitPrice)}
• Total Harga : ${rupiah(totalPrice)}
╰──────────────
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `qty_minus_${product.product_id}_${qty}_${stockNum}` },
        { text: "✏️", callback_data: `qty_reset_${product.product_id}_${qty}_${stockNum}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${qty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${qty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${qty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${qty}` },
      ],
      [{ text: "⬅️ Kembali", callback_data: "list_produk" }],
    ],
  };

  await editMessage(chatId, msg.message_id, textDetail, keyboard);
  return ok();
}

async function handleListProduk(ctx: BotContext): Promise<Response> {
  const { chatId } = ctx;
  const ITEMS_PER_PAGE = 10;
  const page = 1;

  const { data: products, error } = await supabase.rpc(
    "get_products_with_stock",
    {
      p_page: page,
      p_limit: ITEMS_PER_PAGE,
    }
  );

  if (error) {
    console.error("LIST PRODUK RPC error:", error);
    await send(chatId, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!products || products.length === 0) {
    await send(chatId, "📭 Tidak ada produk dengan stok tersedia.");
    return ok();
  }

  const totalCount = Number(products[0]?.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const startIndex = (page - 1) * ITEMS_PER_PAGE;

  let textProduk = `<b>LIST PRODUCT</b>\n\n`;

  products.forEach((p: any, i: number) => {
    const nomor = startIndex + i + 1;
    textProduk += `[${nomor}]. ${escapeHtml(p.name)} ( ${Number(
      p.stock || 0
    )} )\n`;
  });

  textProduk += `\n📄 Halaman ${page}/${totalPages}`;

  const navRow: any[] = [];
  if (page > 1) {
    navRow.push({
      text: "⬅️ Sebelumnya",
      callback_data: `list_produk_page_${page - 1}`,
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "➡️ Selanjutnya",
      callback_data: `list_produk_page_${page + 1}`,
    });
  }

  const keyboard = {
    inline_keyboard: [
      ...(navRow.length ? [navRow] : []),
      [{ text: "🏠 Home", callback_data: "start" }],
    ],
  };

  await send(chatId, textProduk, keyboard);
  return ok();
}

async function handleListProdukPage(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, msg } = ctx;
  const ITEMS_PER_PAGE = 10;
  const page = Number(data.replace("list_produk_page_", "")) || 1;

  const { data: products, error } = await supabase.rpc(
    "get_products_with_stock",
    {
      p_page: page,
      p_limit: ITEMS_PER_PAGE,
    }
  );

  if (error) {
    console.error("LIST PRODUK PAGING RPC error:", error);
    await send(chatId, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!products || products.length === 0) {
    await editMessage(chatId, msg.message_id, "📭 Tidak ada produk dengan stok tersedia.", {
      inline_keyboard: [[{ text: "🏠 Home", callback_data: "start" }]],
    });
    return ok();
  }

  const totalCount = Number(products[0]?.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const startIndex = (page - 1) * ITEMS_PER_PAGE;

  let textProduk = `<b>LIST PRODUCT</b>\n\n`;

  products.forEach((p: any, i: number) => {
    const nomor = startIndex + i + 1;
    textProduk += `[${nomor}]. ${escapeHtml(p.name)} ( ${Number(
      p.stock || 0
    )} )\n`;
  });

  textProduk += `\n📄 Halaman ${page}/${totalPages}`;

  const navRow: any[] = [];
  if (page > 1) {
    navRow.push({
      text: "⬅️ Sebelumnya",
      callback_data: `list_produk_page_${page - 1}`,
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "➡️ Selanjutnya",
      callback_data: `list_produk_page_${page + 1}`,
    });
  }

  const keyboard = {
    inline_keyboard: [
      ...(navRow.length ? [navRow] : []),
      [{ text: "🏠 Home", callback_data: "start" }],
    ],
  };

  await editMessage(chatId, msg.message_id, textProduk, keyboard);
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