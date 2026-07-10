import type { BotContext } from "../../../context.ts";

import { send } from "../../../telegram.ts";

import {
  sendWrongFormat,
  broadcastToAllUsers,
} from "../admin.handler.ts";

function ok() {
  return new Response("ok");
}

export async function handleBroadcast(
  ctx: BotContext,
): Promise<Response> {
  const {
    chatId,
    args,
  } = ctx;

  const messageText = args.join(" ").trim();

  if (!messageText) {
    await sendWrongFormat(
      chatId,
      "/broadcast",
      `<code>/broadcast &lt;pesan&gt;</code>

Contoh:
<code>/broadcast Promo hari ini diskon 20% untuk semua user</code>`,
    );

    return ok();
  }

  await send(chatId, "⏳ Broadcast sedang dikirim...");

  const result = await broadcastToAllUsers(
    `📢 <b>BROADCAST ADMIN</b>

${messageText}`,
  );

  if (result.error) {
    await send(
      chatId,
      `❌ Broadcast gagal.\n<code>${result.error}</code>`,
    );

    return ok();
  }

  await send(
    chatId,
    `✅ Broadcast selesai

└ Total User : <b>${result.total}</b>
└ Berhasil : <b>${result.success}</b>
└ Gagal : <b>${result.failed}</b>`,
  );

  return ok();
}