import { supabase } from "../../supabase.ts";

import {
  send,
  sendLongMessage,
} from "../../telegram.ts";

import {
  rupiah,
} from "../../helper.ts";

import type { BotContext } from "../../context.ts";

import { renderUserDashboard } from "./profile.handler.ts";

function ok(body = "OK", status = 200) {
  return new Response(body, { status });
}

export async function handleSaldoMenu(
  ctx: BotContext,
): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const { data: freshUser, error } = await supabase
    .from("users")
    .select("balance, role")
    .eq("telegram_id", telegramId)
    .single();

  if (error) {
    console.error("SALDO MENU error:", error);
  }

  const saldoText = `💰 <b>MENU SALDO</b>

└ Saldo Kamu : <b>${rupiah(freshUser?.balance || 0)}</b>
└ Role : <b>${freshUser?.role || "reguler"}</b>

Silakan pilih menu saldo atau nominal deposit.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🎟 Klaim Voucher", callback_data: "claim_voucher" }],
      [
        { text: "10.000", callback_data: "invoice_10000" },
        { text: "20.000", callback_data: "invoice_20000" },
      ],
      [
        { text: "50.000", callback_data: "invoice_50000" },
        { text: "100.000", callback_data: "invoice_100000" },
      ],
      [{ text: "⬅️ Kembali", callback_data: "start" }],
    ],
  };

  await send(chatId, saldoText, keyboard);
  return ok();
}

export async function handleClaimVoucherMenu(
  ctx: BotContext,
): Promise<Response> {
  const { chatId } = ctx;

  await send(
    chatId,
    `🎟 <b>KLAIM VOUCHER</b>

Gunakan command berikut:
<code>/claimvoucher SAISOKU100</code>

Semua role bisa klaim voucher selama:
- voucher aktif
- quota masih ada
- belum pernah klaim voucher yang sama`,
  );

  return ok();
}

export async function handleDailyAbsen(
  ctx: BotContext,
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const reward = 100;

  const { data, error } = await supabase.rpc("claim_daily_checkin", {
    p_telegram_id: telegramId,
    p_reward: reward,
  });

  if (error) {
    console.error("DAILY ABSEN RPC error:", error);
    await send(chatId, "❌ Gagal memproses absen.");
    return ok();
  }

  const result = data?.[0];

  if (!result?.success) {
    await send(chatId, `⛔ ${result?.message || "Absen gagal."}`);
    return ok();
  }

  await send(
    chatId,
    `✅ <b>ABSEN BERHASIL</b>

Kamu dapat bonus ${rupiah(reward)}
Saldo sekarang: <b>${rupiah(result.new_balance)}</b>`,
  );

  return ok();
}

export async function handleRiwayat(
  ctx: BotContext,
): Promise<Response> {
  const { chatId, user } = ctx;

  const { data: trx, error } = await supabase
    .from("transactions")
    .select("id, product_id, price, status, purchased_at")
    .eq("user_id", user.id)
    .order("purchased_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("RIWAYAT ERROR:", error);
    await send(chatId, "❌ Gagal mengambil riwayat transaksi.");
    return ok();
  }

  if (!trx || trx.length === 0) {
    await send(chatId, "📂 Belum ada riwayat transaksi.");
    return ok();
  }

  const productIds = [
    ...new Set(trx.map((t: any) => t.product_id).filter(Boolean)),
  ];

  let productMap: Record<string, string> = {};

  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id,name")
      .in("id", productIds);

    for (const p of products || []) {
      productMap[String((p as any).id)] = (p as any).name;
    }
  }

  let textRiwayat = `📂 <b>RIWAYAT TRANSAKSI</b>\n`;

  trx.forEach((item: any, i: number) => {
    textRiwayat += `

${i + 1}. ${productMap[String(item.product_id)] || "Produk"}
└ Harga : ${rupiah(item.price)}
└ Status : ${item.status}
└ Waktu : ${item.purchased_at || "-"}`;
  });

  await sendLongMessage(chatId, textRiwayat, {
    inline_keyboard: [
      [{ text: "⬅️ Kembali", callback_data: "menu_lain" }],
    ],
  });

  return ok();
}

export async function handlePopuler(
  ctx: BotContext,
): Promise<Response> {
  const { chatId } = ctx;

  const { data: trx, error } = await supabase
    .from("transactions")
    .select("product_id")
    .eq("status", "paid");

  if (error) {
    console.error("POPULER ERROR:", error);
    await send(chatId, "❌ Gagal mengambil produk populer.");
    return ok();
  }

  if (!trx?.length) {
    await send(chatId, "⭐ Belum ada data produk populer.");
    return ok();
  }

  const counts: Record<string, number> = {};

  for (const row of trx) {
    const pid = String((row as any).product_id || "");
    if (!pid) continue;

    counts[pid] = (counts[pid] || 0) + 1;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const ids = sorted.map(([id]) => id);

  const { data: products } = await supabase
    .from("products")
    .select("id,name")
    .in("id", ids);

  const mapName: Record<string, string> = {};

  for (const p of products || []) {
    mapName[String((p as any).id)] = (p as any).name;
  }

  let text = `⭐ <b>PRODUK POPULER</b>\n`;

  sorted.forEach(([pid, total], idx) => {
    text += `

${idx + 1}. ${mapName[pid] || "Produk"}
└ Terjual : ${total} pcs`;
  });

  await sendLongMessage(chatId, text, {
    inline_keyboard: [
      [{ text: "⬅️ Kembali", callback_data: "menu_lain" }],
    ],
  });

  return ok();
}
export async function handleProfile(
  ctx: BotContext,
): Promise<Response> {
  const { chatId } = ctx;

  const text = await renderUserDashboard(ctx);

  await send(chatId, text, {
    inline_keyboard: [
      [{ text: "⬅️ Kembali", callback_data: "menu_lain" }],
    ],
  });

  return ok();
}

export async function handleMenuLain(
  ctx: BotContext,
): Promise<Response> {
  const { chatId } = ctx;

  const keyboard = {
  inline_keyboard: [
    [{ text: "👤 Profil", callback_data: "profil" }],
    [{ text: "📂 Riwayat Transaksi", callback_data: "riwayat" }],
    [{ text: "⭐ Produk Populer", callback_data: "populer" }],
    [{ text: "⬅️ Kembali", callback_data: "start" }],
  ],
};

  await send(
    chatId,
    `⚙ <b>MENU LAIN</b>

Pilih menu tambahan yang tersedia.`,
    keyboard,
  );

  return ok();
}