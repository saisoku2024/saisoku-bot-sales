import type { BotContext } from "../../../context.ts";

import { getRoleByTelegramId } from "../../../user.repo.ts";
import { supabase } from "../../../supabase.ts";
import { send } from "../../../telegram.ts";

import {
  sendWrongFormat,
  isOwner,
} from "../admin.handler.ts";

function ok() {
  return new Response("ok");
}

export async function handleSetRole(
  ctx: BotContext,
): Promise<Response> {

  const {
    chatId,
    telegramId,
    args,
  } = ctx;

  const actorRole = await getRoleByTelegramId(
    telegramId,
  );

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
<code>reguler</code>, <code>reseller</code>, <code>admin</code>, <code>owner</code>`,
    );

    return ok();
  }

  const targetTelegramId = Number(args[0]);
  const newRole = String(args[1] || "").toLowerCase();

  const allowedRoles = [
    "reguler",
    "reseller",
    "admin",
    "owner",
  ];

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

  const { data: targetUser } = await supabase
    .from("users")
    .select("telegram_id")
    .eq("telegram_id", targetTelegramId)
    .single();

  if (!targetUser) {
    await send(chatId, "❌ User target tidak ditemukan.");
    return ok();
  }

  await supabase
    .from("users")
    .update({
      role: newRole,
    })
    .eq("telegram_id", targetTelegramId);

  await send(
    chatId,
    `✅ Role user ${targetTelegramId} berhasil diubah menjadi <b>${newRole}</b>.`
  );

  try {
    await send(
      targetTelegramId,
      `🔔 Role akun kamu telah diubah menjadi <b>${newRole}</b>.`
    );
  } catch {}

  return ok();
}