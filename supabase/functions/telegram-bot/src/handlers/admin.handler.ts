import { supabase } from "../../supabase.ts";
import { send } from "../../telegram.ts";
import { rupiah } from "../../helper.ts";
import { getRoleByTelegramId } from "../../user.repo.ts";

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