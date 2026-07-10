import { supabase } from "../../supabase.ts";
import { send } from "../../telegram.ts";
import { rupiah } from "../../helper.ts";
import {
  getRoleByTelegramId,
  isUserRestricted,
} from "../../user.repo.ts";
import { handleSetRole } from "./admin/setrole.handler.ts";
import { handleBroadcast } from "./admin/broadcast.handler.ts";
import { handleBan, handleUnban } from "./admin/ban.handler.ts";
import {
  handleAddBalance,
  handleReduceBalance,
} from "./admin/balance.handler.ts";
import type { BotContext } from "../../context.ts";

function ok() {
  return new Response("ok");
}

export function isOwner(role: string) {
  return role === "owner";
}

export function isAdminOrOwner(role: string) {
  return role === "admin" || role === "owner";
}

export async function sendWrongFormat(
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

export async function broadcastToAllUsers(text: string) {
  const { data: users, error } = await supabase
    .from("users")
    .select("telegram_id, is_banned, is_active")
    .not("telegram_id", "is", null);

  if (error) {
    console.error("broadcastToAllUsers error:", error);
    return { success: 0, failed: 0, total: 0, error: error.message };
  }

  let success = 0;
  let failed = 0;
  const recipients = (users || []).filter((u: any) => !isUserRestricted(u));

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

export async function handleManagedAdminCommand(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, args, cmd } = ctx;

  const actorRole = await getRoleByTelegramId(telegramId);

  if (cmd === "/setrole") {
    return await handleSetRole(ctx);
  }

  if (!isAdminOrOwner(actorRole)) {
    await send(chatId, "❌ Hanya admin/owner yang memiliki akses.");
    return ok();
  }

  if (cmd === "/broadcast") {
    return await handleBroadcast(ctx);
  }

  if (cmd === "/ban") {
    return await handleBan(ctx);
  }

  if (cmd === "/unban") {
    return await handleUnban(ctx);
  }

  if (cmd === "/addsaldo" || cmd === "/addbalance") {
    return await handleAddBalance(ctx);
  }

  if (cmd === "/remsaldo" || cmd === "/reducebalance") {
    return await handleReduceBalance(ctx);
  }

  return ok();
}
