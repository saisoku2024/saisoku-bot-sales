import { ENV } from "../../env.ts";
import { supabase } from "../../supabase.ts";
import { send, sendPhoto } from "../../telegram.ts";

import {
  rupiah,
  escapeHtml,
  generateUniqueCode,
} from "../../helper.ts";

import {
  getUserIdByTelegramId,
} from "../../user.repo.ts";

import type { BotContext } from "../../context.ts";

import {
  ok,
  getProductDetailForBot,
  getUserActiveOrder,
  sendPurchaseResult,
  getLatestSoldAccountsForUserProduct,
} from "./order.helper.ts";

export async function handleBuySaldo(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const partsCb = data.split("_");
  const pId = partsCb[2];
  const qty = Math.max(1, Number(partsCb[3] || 1));

  if (!pId || !qty || qty <= 0) {
    await send(chatId, "❌ Data pembelian tidak valid.");
    return ok();
  }

  const userId = await getUserIdByTelegramId(telegramId);

  if (!userId) {
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  const product = await getProductDetailForBot(pId, userId);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan atau sedang nonaktif.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "buy_product_with_balance",
    {
      p_telegram_id: telegramId,
      p_product_id: pId,
      p_qty: qty,
    }
  );

  if (rpcError) {
    console.error("BUY SALDO RPC error:", rpcError);
    await send(chatId, "❌ Gagal memproses pembelian.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Pembelian gagal."}`);
    return ok();
  }

  const soldAccounts = await getLatestSoldAccountsForUserProduct(
    String(result.user_id),
    pId,
    qty
  );

  const items = soldAccounts.map((row: any) => ({
    email: row.account_snapshot?.email ?? "-",
    password: row.account_snapshot?.password ?? "-",
    pin: row.account_snapshot?.pin ?? "-",
    profile: row.account_snapshot?.profile ?? "-",
  }));

  const summaryText = `✅ <b>PEMBELIAN BERHASIL!</b>

<b>Informasi Pembelian</b>
└ Produk : ${escapeHtml(product.product_name)}
└ Kode : ${escapeHtml(product.product_code || "-")}
└ Role Harga : ${escapeHtml(product.user_role || "-")}
└ Jumlah : ${qty}
└ Harga Satuan : ${rupiah(Number(result.unit_price || 0))}
└ Total : ${rupiah(Number(result.total_price || 0))}
└ Metode : Saldo
└ Sisa Saldo : ${rupiah(Number(result.new_balance || 0))}`;

  await sendPurchaseResult(
    chatId,
    summaryText,
    items,
    product.product_name,
    product.tos_description
  );

  return ok();
}