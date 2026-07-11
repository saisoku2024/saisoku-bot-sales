import { supabase } from "../../supabase.ts";
import { send, editMessage } from "../../telegram.ts";
import { notifyAdminsOrOwners } from "../../services/order/order.helper.ts";
import { escapeHtml } from "../../helper.ts";
import type { BotContext } from "../../context.ts";

function ok() {
  return new Response("ok");
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
      [{ text: "❌ Batalkan", callback_data: "cancel_ticket_session" }],
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

  const userText = `✅ <b>TIKET BERHASIL DIKIRIM!</b>

└ Tiket ID : <code>#${ticket.id}</code>
└ Status : <b>Open</b>
└ Pesan : <i>${escapeHtml(normalizedText)}</i>

Admin telah dinotifikasi dan akan segera membalas tiket Anda.`;

  await send(chatId, userText);

  const adminUsername = user.username ? `@${escapeHtml(user.username)}` : `User ${telegramId}`;
  const adminText = `📢 <b>TIKET BANTUAN BARU</b>

Aktor: ${adminUsername}
ID: <code>${telegramId}</code>

└ Tiket ID : <code>#${ticket.id}</code>
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
