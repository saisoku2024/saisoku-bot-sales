import { supabase } from "../../supabase.ts";
import { send, editMessage } from "../../telegram.ts";
import { notifyAdminsOrOwners } from "../../services/order/order.helper.ts";
import { escapeHtml } from "../../helper.ts";
import type { BotContext } from "../../context.ts";

function ok() {
  return new Response("ok");
}

function formatTicketDate(date: Date): string {
  const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const dd = String(wibDate.getUTCDate()).padStart(2, "0");
  const mm = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = wibDate.getUTCFullYear();
  const hh = String(wibDate.getUTCHours()).padStart(2, "0");
  const min = String(wibDate.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatTicketDateCode(date: Date): string {
  const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wibDate.getUTCFullYear();
  const mm = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wibDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildTicketCode(ticket: any, orderId = "GENERAL"): string {
  const date = ticket?.created_at ? new Date(ticket.created_at) : new Date();
  const orderSegment = String(orderId || "GENERAL")
    .replace(/^#/, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8) || "GENERAL";
  const serial = String(ticket?.id || 0).padStart(6, "0");
  return `SID${formatTicketDateCode(date)}-${orderSegment}-${serial}`;
}

function buildTicketNotificationText(params: {
  ticket: any;
  orderId?: string;
  status: "open" | "assigned" | "resolved";
  userMessage: string;
  adminResponse?: string;
  footer: string;
}) {
  const createdAt = params.ticket?.created_at ? new Date(params.ticket.created_at) : new Date();
  const resolvedAt =
    params.status === "resolved"
      ? formatTicketDate(new Date(params.ticket?.resolved_at || new Date()))
      : "PENDING";
  const statusText =
    params.status === "resolved"
      ? "✅ [ RESOLVED ]"
      : params.status === "assigned"
      ? "🟦 [ ASSIGNED ]"
      : "⏳ [ OPEN ]";
  const ticketCode = buildTicketCode(params.ticket, params.orderId || "GENERAL");
  const orderId = params.orderId || "-";
  const response = params.adminResponse || "(Menunggu balasan admin...)";

  return `<b>[ TICKET NOTIFICATION ]</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ <b>TICKET ID</b>    : <code>${escapeHtml(ticketCode)}</code>
▶ <b>ORDER ID</b>     : <code>${escapeHtml(orderId)}</code>
▶ <b>STATUS</b>       : ${statusText}

<b>LOG AKTIVITAS</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[+] Dibuat     : ${formatTicketDate(createdAt)}
[-] Selesai    : ${resolvedAt}

<b>PESAN DARI USER</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
&quot;${escapeHtml(params.userMessage)}&quot;
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>RESPON ADMIN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${escapeHtml(response)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<i>${escapeHtml(params.footer)}</i>`;
}

export async function handleTicketMenu(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId } = ctx;

  await supabase.from("ticket_sessions").upsert({
    telegram_id: telegramId,
  });

  const text = `🎫 <b>KIRIM TIKET BANTUAN</b>

Silakan tuliskan laporan, kendala, atau pertanyaan Anda secara langsung di chat ini.

Admin kami akan segera membaca dan merespons tiket Anda.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔴 Batalkan", callback_data: "cancel_ticket_session" }],
    ],
  };

  await send(chatId, text, keyboard);
  return ok();
}

export async function handleCancelTicketSession(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, msg } = ctx;

  await supabase.from("ticket_sessions").delete().eq("telegram_id", telegramId);

  await editMessage(chatId, msg.message_id, "❌ Pembuatan tiket dibatalkan.");
  return ok();
}

export async function handleTicketInput(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, normalizedText, user } = ctx;

  const { data: session } = await supabase
    .from("ticket_sessions")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!session) {
    return ok();
  }

  await supabase.from("ticket_sessions").delete().eq("telegram_id", telegramId);

  if (!normalizedText || normalizedText.trim().length === 0) {
    await send(chatId, "❌ Pesan tiket tidak boleh kosong. Pembuatan tiket dibatalkan.");
    return ok();
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      user_id: user.id,
      telegram_id: telegramId,
      status: "open",
    })
    .select()
    .single();

  if (ticketError || !ticket) {
    console.error("CREATE TICKET ERROR:", ticketError);
    await send(chatId, "❌ Gagal membuat tiket bantuan. Silakan coba beberapa saat lagi.");
    return ok();
  }

  const { error: replyError } = await supabase
    .from("ticket_replies")
    .insert({
      ticket_id: ticket.id,
      sender_type: "user",
      message: normalizedText,
    });

  if (replyError) {
    console.error("CREATE TICKET REPLY ERROR:", replyError);
  }

  const ticketCode = buildTicketCode(ticket);
  const userText = buildTicketNotificationText({
    ticket,
    status: "open",
    userMessage: normalizedText,
    footer: "Admin telah dinotifikasi. Harap tunggu balasan selanjutnya.",
  });

  await send(chatId, userText);

  const adminUsername = user.username ? `@${escapeHtml(user.username)}` : `User ${telegramId}`;
  const adminText = `📢 <b>TIKET BANTUAN BARU</b>

Aktor: ${adminUsername}
ID: <code>${telegramId}</code>

└ Tiket ID : <code>${escapeHtml(ticketCode)}</code>
└ Masalah : <i>${escapeHtml(normalizedText)}</i>

Tanggapi tiket ini melalui Dashboard Web Admin pada menu Tickets.`;

  await notifyAdminsOrOwners(adminText);

  return ok();
}

export async function handleResolveTicketUser(ctx: BotContext, data: string): Promise<Response> {
  const { chatId, msg } = ctx;
  const ticketId = parseInt(data.replace("resolve_ticket_", "").trim());

  if (isNaN(ticketId)) {
    return ok();
  }

  const { error } = await supabase
    .from("tickets")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", ticketId);

  if (error) {
    console.error("RESOLVE TICKET ERROR:", error);
    await send(chatId, "❌ Gagal menyelesaikan tiket.");
    return ok();
  }

  await editMessage(chatId, msg.message_id, `✅ Tiket <code>#${ticketId}</code> telah berhasil diselesaikan.`);
  return ok();
}
