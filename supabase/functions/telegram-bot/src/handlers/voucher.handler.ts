import type { BotContext } from "../../context.ts";
import { claimVoucherByCode } from "../../services/voucher.service.ts";
import { sendWrongFormat } from "./admin.handler.ts";

function ok() {
  return new Response("ok");
}

export async function handleClaimVoucherCommand(
  ctx: BotContext,
): Promise<Response> {
  const { chatId, telegramId, args } = ctx;

  if (args.length < 1) {
    await sendWrongFormat(
      chatId,
      "/claimvoucher",
      `<code>/claimvoucher &lt;kode&gt;</code>

Contoh:
<code>/claimvoucher SAISOKU100</code>`,
    );

    return ok();
  }

  await claimVoucherByCode(
    chatId,
    telegramId,
    args[0],
  );

  return ok();
}