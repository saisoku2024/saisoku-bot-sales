import { ENV } from "../env.ts";
import { supabase } from "../supabase.ts";
import { send, sendPhoto, editCaption } from "../telegram.ts";
import { rupiah, escapeHtml, generateUniqueCode } from "../helper.ts";
import {
  getRoleByTelegramId,
  getUserByTelegramId,
  getUserRestrictedMessage,
  isUserRestricted,
} from "../user.repo.ts";
import type { BotContext } from "../context.ts";

function isAdminOrOwner(role: string) {
  return role === "admin" || role === "owner";
}

async function getUserActiveDepositRequest(
  telegramId: number,
  excludeDepositId?: string
) {
  let query = supabase
    .from("deposit_requests")
    .select("id, status, created_at")
    .eq("telegram_id", telegramId)
    .in("status", ["waiting_payment", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (excludeDepositId) {
    query = query.neq("id", excludeDepositId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("getUserActiveDepositRequest error:", error);
    return null;
  }

  return data ?? null;
}

async function notifyAdminsOrOwners(text: string, kb?: any) {
  const recipients = new Set<number>();

  if (ENV.OWNER_TELEGRAM_ID > 0) {
    recipients.add(Number(ENV.OWNER_TELEGRAM_ID));
  }

  const { data: rows, error } = await supabase
    .from("users")
    .select("telegram_id, is_banned, is_active")
    .in("role", ["admin", "owner"]);

  if (error) {
    console.error("notifyAdminsOrOwners query error:", error);
  }

  for (const row of rows || []) {
    if (isUserRestricted(row)) continue;

    if (row.telegram_id) {
      recipients.add(Number(row.telegram_id));
    }
  }

  if (recipients.size === 0) {
    console.error("notifyAdminsOrOwners: no recipients found");
    return;
  }

  for (const recipientId of recipients) {
    try {
      await send(recipientId, text, kb);
    } catch (err) {
      console.error("notifyAdminsOrOwners send error:", {
        recipientId,
        err,
      });
    }
  }
}

function ok() {
  return new Response("ok");
}

export async function handleCreateDepositInvoice(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const denom = parseInt(data.replace("invoice_", ""));

  if (!denom || denom <= 0) {
    await send(chatId, "❌ Nominal deposit tidak valid.");
    return ok();
  }

  const freshUser = await getUserByTelegramId(telegramId);

  if (!freshUser) {
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  if (isUserRestricted(freshUser)) {
    await send(chatId, getUserRestrictedMessage(freshUser));
    return ok();
  }

  const existingDeposit = await getUserActiveDepositRequest(telegramId);

  if (existingDeposit) {
    await send(
      chatId,
      `⚠️ Kamu masih punya deposit aktif.

└ Deposit ID : <code>${escapeHtml(existingDeposit.id)}</code>
└ Status : <b>${escapeHtml(existingDeposit.status)}</b>

Selesaikan dulu deposit sebelumnya sebelum membuat deposit baru.`
    );
    return ok();
  }

  const kodeUnik = generateUniqueCode();
  const totalBayar = denom + kodeUnik;

  const { data: depositRequest, error: depositInsertError } = await supabase
    .from("deposit_requests")
    .insert({
      user_id: freshUser.id,
      telegram_id: telegramId,
      amount: denom,
      unique_code: kodeUnik,
      final_amount: totalBayar,
      status: "waiting_payment",
      payment_method: "manual",
    })
    .select()
    .single();

  if (depositInsertError || !depositRequest) {
    console.error("CREATE DEPOSIT REQUEST error:", depositInsertError);
    await send(chatId, "❌ Gagal membuat invoice deposit.");
    return ok();
  }

  const invoiceText = `💎 <b>INVOICE DEPOSIT</b>

└ Deposit ID : <code>${escapeHtml(depositRequest.id)}</code>
└ Nominal : <b>${rupiah(denom)}</b>
└ Kode Unik : <b>${kodeUnik}</b>
└ Total Bayar : <b>${rupiah(totalBayar)}</b>

Silakan scan QRIS di atas.
Setelah bayar, klik tombol <b>Konfirmasi Bayar</b>.`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "✅ Konfirmasi Bayar",
          callback_data: `confirm_deposit_${depositRequest.id}`,
        },
      ],
      [{ text: "🔴 Batal", callback_data: `cancel_deposit_${depositRequest.id}` }],
    ],
  };

  await sendPhoto(chatId, ENV.QRIS_IMAGE_URL, invoiceText, keyboard);
  return ok();
}

export async function handleCancelDeposit(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const depositId = data.replace("cancel_deposit_", "").trim();

  if (!depositId) {
    await send(chatId, "❌ Deposit ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "cancel_deposit_atomic",
    {
      p_deposit_id: depositId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("CANCEL DEPOSIT RPC error:", rpcError);
    await send(chatId, "❌ Gagal membatalkan deposit.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal membatalkan deposit."}`);
    return ok();
  }

  await send(chatId, "❌ Deposit berhasil dibatalkan.");
  return ok();
}

export async function handleConfirmDeposit(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId, username, msg } = ctx;
  const depositId = data.replace("confirm_deposit_", "").trim();

  if (!depositId) {
    await send(chatId, "❌ Deposit ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "confirm_deposit_atomic",
    {
      p_deposit_id: depositId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("CONFIRM DEPOSIT RPC error:", rpcError);
    await send(chatId, "❌ Gagal mengirim konfirmasi deposit.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal konfirmasi deposit."}`);
    return ok();
  }

  const { data: updatedDeposit, error: depositError } = await supabase
    .from("deposit_requests")
    .select("*")
    .eq("id", depositId)
    .single();

  if (depositError || !updatedDeposit) {
    console.error("CONFIRM DEPOSIT reload error:", depositError);
    await send(chatId, "⚠️ Deposit sudah dikonfirmasi, tapi gagal memuat ulang data.");
    return ok();
  }

  const editOk = await editCaption(
    chatId,
    msg.message_id,
    `💎 <b>INVOICE DEPOSIT</b>

└ Deposit ID : <code>${escapeHtml(updatedDeposit.id)}</code>
└ Nominal : <b>${rupiah(updatedDeposit.amount)}</b>
└ Kode Unik : <b>${updatedDeposit.unique_code}</b>
└ Total Bayar : <b>${rupiah(updatedDeposit.final_amount)}</b>

✅ <b>Konfirmasi pembayaran sudah dikirim</b>
Silakan tunggu admin/owner melakukan pengecekan.`,
    {
      inline_keyboard: [
        [{ text: "✅ Sudah Dikonfirmasi", callback_data: "ignore" }],
        [{ text: "⌛ Menunggu Review Admin", callback_data: "ignore" }],
      ],
    }
  );

  if (!editOk) {
    console.error("CONFIRM DEPOSIT edit caption failed:", { depositId });
  }

  await send(chatId, "⏳ Konfirmasi deposit terkirim! Owner sedang mengecek.");

  const ownerText = `📢 <b>DEP-REQ</b>

User: ${username ? `@${escapeHtml(username)}` : "-"}
ID: <code>${telegramId}</code>

└ Deposit ID : <code>${escapeHtml(updatedDeposit.id)}</code>
└ Nominal : <b>${rupiah(updatedDeposit.amount)}</b>
└ Kode Unik : <b>${updatedDeposit.unique_code}</b>
└ Tagihan : <b>${rupiah(updatedDeposit.final_amount)}</b>

Silakan approve atau tolak deposit ini.`;

  const ownerKb = {
    inline_keyboard: [
      [
        {
          text: "✅ Approve Deposit",
          callback_data: `approve_deposit_${updatedDeposit.id}`,
        },
      ],
      [
        {
          text: "❌ Tolak Deposit",
          callback_data: `reject_deposit_${updatedDeposit.id}`,
        },
      ],
    ],
  };

  await notifyAdminsOrOwners(ownerText, ownerKb);
  return ok();
}

export async function handleApproveDeposit(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const role = await getRoleByTelegramId(Number(telegramId));

  if (!isAdminOrOwner(role)) {
    await send(chatId, "❌ Akses ditolak. Hanya admin/owner.");
    return ok();
  }

  const depositId = data.replace("approve_deposit_", "").trim();

  if (!depositId) {
    await send(chatId, "❌ Deposit ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "approve_deposit_atomic",
    {
      p_deposit_id: depositId,
      p_actor_telegram_id: telegramId,
      p_idempotency_key: `approve_deposit:${depositId}`,
    }
  );

  if (rpcError) {
    console.error("APPROVE DEPOSIT RPC error:", rpcError);
    await send(chatId, "❌ Gagal approve deposit.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Approve deposit gagal."}`);
    return ok();
  }

  await send(
    chatId,
    `✅ Deposit berhasil di-approve.

└ Deposit ID : <code>${escapeHtml(String(result.out_deposit_id))}</code>
└ Nominal : <b>${rupiah(Number(result.out_amount || 0))}</b>
└ User ID : <code>${result.out_telegram_id}</code>`
  );

  try {
    await send(
      Number(result.out_telegram_id),
      `🔔 Deposit berhasil!

└ Deposit ID : <code>${escapeHtml(String(result.out_deposit_id))}</code>
└ Nominal : <b>${rupiah(Number(result.out_amount || 0))}</b>
└ Saldo sekarang : <b>${rupiah(Number(result.out_new_balance || 0))}</b>`
    );
  } catch (err) {
    console.error("APPROVE DEPOSIT notify target error:", err);
  }

  return ok();
}

export async function handleRejectDeposit(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const role = await getRoleByTelegramId(Number(telegramId));

  if (!isAdminOrOwner(role)) {
    await send(chatId, "❌ Akses ditolak. Hanya admin/owner.");
    return ok();
  }

  const depositId = data.replace("reject_deposit_", "").trim();

  if (!depositId) {
    await send(chatId, "❌ Deposit ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "reject_deposit_atomic",
    {
      p_deposit_id: depositId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("REJECT DEPOSIT RPC error:", rpcError);
    await send(chatId, "❌ Gagal menolak deposit.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal menolak deposit."}`);
    return ok();
  }

  await send(
    chatId,
    `❌ Deposit berhasil ditolak.

└ Deposit ID : <code>${escapeHtml(String(result.out_deposit_id))}</code>`
  );

  try {
    await send(
      Number(result.out_telegram_id),
      `❌ Deposit kamu ditolak admin.

└ Deposit ID : <code>${escapeHtml(String(result.out_deposit_id))}</code>`
    );
  } catch (err) {
    console.error("REJECT DEPOSIT notify target error:", err);
  }

  return ok();
}
