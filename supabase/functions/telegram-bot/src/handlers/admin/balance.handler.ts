import type { BotContext } from "../../../context.ts";

import { supabase } from "../../../supabase.ts";
import { send } from "../../../telegram.ts";
import { rupiah } from "../../../helper.ts";

import {
  sendWrongFormat,
  isOwner,
} from "../admin.handler.ts";

import { getRoleByTelegramId } from "../../../user.repo.ts";

function ok() {
  return new Response("ok");
}

export async function handleAddBalance(
  ctx: BotContext,
): Promise<Response> {
  const {
    chatId,
    telegramId,
    args,
    cmd,
  } = ctx;

  const actorRole = await getRoleByTelegramId(telegramId);

  if (!isOwner(actorRole)) {
    await send(chatId, "⛔ Hanya OWNER yang dapat menambah saldo.");
    return ok();
  }

  if (args.length < 2) {
    await sendWrongFormat(
      chatId,
      String(cmd),
      `<code>/addsaldo &lt;telegram_id&gt; &lt;nominal&gt;</code>
atau
<code>/addbalance &lt;telegram_id&gt; &lt;nominal&gt;</code>

Contoh:
<code>/addsaldo 123456789 10000</code>
<code>/addbalance 123456789 10000</code>`,
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
    `✅ Berhasil menambah saldo ${rupiah(amount)} ke ID ${targetTelegramId}.\nSaldo baru: ${rupiah(result.new_balance)}`,
  );

  try {
    await send(
      targetTelegramId,
      `🔔 Saldo kamu bertambah ${rupiah(amount)}.\nSaldo sekarang: ${rupiah(result.new_balance)}`,
    );
  } catch (err) {
    console.error("ADDSALDO notify target error:", err);
  }

  return ok();
}

export async function handleReduceBalance(
  ctx: BotContext,
): Promise<Response> {
  const {
    chatId,
    telegramId,
    args,
    cmd,
  } = ctx;

  const actorRole = await getRoleByTelegramId(telegramId);

  if (!isOwner(actorRole)) {
    await send(chatId, "⛔ Hanya OWNER yang dapat mengurangi saldo.");
    return ok();
  }

  if (args.length < 2) {
    await sendWrongFormat(
      chatId,
      String(cmd),
      `<code>${String(cmd)} &lt;telegram_id&gt; &lt;nominal&gt;</code>

Contoh:
<code>${String(cmd)} 123456789 5000</code>`,
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
    console.error("REDUCEBALANCE RPC error:", error);
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
    `✅ Berhasil mengurangi saldo ${rupiah(amount)} dari ID ${targetTelegramId}.\nSaldo baru: ${rupiah(result.new_balance)}`,
  );

  try {
    await send(
      targetTelegramId,
      `🔔 Saldo kamu dikurangi ${rupiah(amount)}.\nSaldo sekarang: ${rupiah(result.new_balance)}`,
    );
  } catch (err) {
    console.error("REDUCEBALANCE notify target error:", err);
  }

  return ok();
}