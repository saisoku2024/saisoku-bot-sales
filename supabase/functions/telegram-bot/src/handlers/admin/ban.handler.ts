import type { BotContext } from "../../../context.ts";

import { supabase } from "../../../supabase.ts";
import { send } from "../../../telegram.ts";
import { isUserRestricted } from "../../../user.repo.ts";

import {
  sendWrongFormat,
} from "../admin.handler.ts";

function ok() {
  return new Response("ok");
}

export async function handleBan(
  ctx: BotContext,
): Promise<Response> {

  const {
    chatId,
    telegramId,
    args,
  } = ctx;

  if (args.length < 1) {
    await sendWrongFormat(
      chatId,
      "/ban",
      `<code>/ban &lt;telegram_id&gt;</code>

Contoh:
<code>/ban 123456789</code>`,
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
    .select("id, role, is_banned, is_active")
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

  if (isUserRestricted(targetUser)) {
    await send(chatId, "⚠️ User tersebut sudah dalam status banned.");
    return ok();
  }

  const { error: banError } = await supabase
    .from("users")
    .update({
      is_banned: true,
      is_active: false,
    })
    .eq("telegram_id", targetTelegramId);

  if (banError) {
    console.error("BAN banError:", banError);
    await send(chatId, "❌ Gagal memban user.");
    return ok();
  }

  await send(
    chatId,
    `✅ User ${targetTelegramId} berhasil diban.`,
  );

  try {
    await send(
      targetTelegramId,
      "⛔ Akun kamu telah diban oleh admin. Hubungi admin jika merasa ini kesalahan.",
    );
  } catch (err) {
    console.error("BAN notify target error:", err);
  }

  return ok();
}

export async function handleUnban(
  ctx: BotContext,
): Promise<Response> {

  const {
    chatId,
    args,
  } = ctx;

  if (args.length < 1) {
    await sendWrongFormat(
      chatId,
      "/unban",
      `<code>/unban &lt;telegram_id&gt;</code>

Contoh:
<code>/unban 123456789</code>`,
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
    .select("id, is_banned, is_active")
    .eq("telegram_id", targetTelegramId)
    .single();

  if (targetUserError) {
    console.error("UNBAN targetUserError:", targetUserError);
  }

  if (!targetUser) {
    await send(chatId, "❌ User target tidak ditemukan.");
    return ok();
  }

  if (!isUserRestricted(targetUser)) {
    await send(chatId, "⚠️ User tersebut tidak dalam status banned.");
    return ok();
  }

  const { error: unbanError } = await supabase
    .from("users")
    .update({
      is_banned: false,
      is_active: true,
    })
    .eq("telegram_id", targetTelegramId);

  if (unbanError) {
    console.error("UNBAN unbanError:", unbanError);
    await send(chatId, "❌ Gagal membuka ban user.");
    return ok();
  }

  await send(
    chatId,
    `✅ User ${targetTelegramId} berhasil di-unban.`,
  );

  try {
    await send(
      targetTelegramId,
      "✅ Akun kamu sudah di-unban. Sekarang kamu bisa menggunakan bot lagi.",
    );
  } catch (err) {
    console.error("UNBAN notify target error:", err);
  }

  return ok();
}
