import { ENV } from "../env.ts";
import { supabase } from "../supabase.ts";
import { send, sendPhoto } from "../telegram.ts";
import {
  rupiah,
  escapeHtml,
  formatMultiline,
  generateTrxCode,
  generateUniqueCode,
  getJakartaDateKey,
} from "../helper.ts";
import {
  getRoleByTelegramId,
  getUserIdByTelegramId,
  getUserRestrictedMessage,
  isUserRestricted,
} from "../user.repo.ts";
import type { BotContext } from "../context.ts";

import {
  ok,
  isAdminOrOwner,
  getProductDetailForBot,
  getUserActiveOrder,
  notifyAdminsOrOwners,
  sendPurchaseResult,
  getLatestSoldAccountsForUserProduct,
  getSoldAccountsByOrderId,
} from "./order/order.helper.ts";

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

export async function handleBuyNow(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const partsCb = data.split("_");
  // data format: buy_now_{pId}_{qty} or checkout_{pId}_{qty}_{useDeposit}
  const isCheckoutToggle = partsCb[0] === "checkout";
  const pId = isCheckoutToggle ? partsCb[1] : partsCb[2];
  const qty = Math.max(1, Number((isCheckoutToggle ? partsCb[2] : partsCb[3]) || 1));
  const explicitUseDeposit = isCheckoutToggle ? Number(partsCb[3]) : null;

  if (!pId || !qty || qty <= 0) {
    await send(chatId, "❌ Data order tidak valid.");
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

  const { data: u, error: userDataError } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (userDataError || !u) {
    console.error("BUY NOW userDataError:", userDataError);
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  if (isUserRestricted(u)) {
    await send(chatId, getUserRestrictedMessage(u));
    return ok();
  }

  const existingActiveOrder = await getUserActiveOrder(telegramId);

  if (existingActiveOrder) {
    await send(
      chatId,
      `⚠️ Kamu masih punya order aktif.

└ Order ID : <code>${escapeHtml(existingActiveOrder.id)}</code>
└ Status : <b>${escapeHtml(existingActiveOrder.status)}</b>

Selesaikan atau batalkan order lama dulu sebelum membuat order baru.`
    );
    return ok();
  }

  const { data: availableItems, error: stockError } = await supabase
    .from("product_accounts")
    .select("id")
    .eq("product_id", pId)
    .eq("status", "available")
    .order("id", { ascending: true })
    .limit(qty);

  if (stockError) {
    console.error("BUY NOW stockError:", stockError);
    await send(chatId, "❌ Gagal memeriksa stok.");
    return ok();
  }

  if (!availableItems || availableItems.length < qty) {
    await send(
      chatId,
      `❌ Stok tidak cukup. Hanya tersedia ${availableItems?.length || 0} item.`
    );
    return ok();
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * qty;

  const { data: loyaltyData } = await supabase.rpc(
    "get_user_loyalty_summary",
    {
      p_telegram_id: telegramId,
    },
  );

  const loyalty = loyaltyData?.[0];
  const promoActive = Boolean(product.is_promo_active) && Number(product.promo_price || 0) > 0;

  const loyaltyDiscount = Number(
    promoActive ? 0 : loyalty?.discount_amount || 0,
  );

  const userBalance = Number(u.balance || 0);
  // Default useDeposit to 1 (active) if balance >= 3000 unless explicitly toggled
  const isUseDepositActive = explicitUseDeposit !== null ? explicitUseDeposit === 1 : userBalance >= 3000;

  let depositDeduction = 0;
  if (isUseDepositActive && userBalance >= 3000) {
    depositDeduction = Math.min(userBalance, 10000);
  }

  const subtotalAfterDiscount = Math.max(
    0,
    totalPrice - loyaltyDiscount - depositDeduction,
  );

  const checkoutText = `🛒 <b>KONFIRMASI CHECKOUT</b>

<b>Rincian Order</b>
└ Produk : ${escapeHtml(product.product_name)}
└ Kode : ${escapeHtml(product.product_code || "-")}
└ Role Harga : ${escapeHtml(product.user_role || u.role)}
└ Jumlah : ${qty}
└ Harga Satuan : ${rupiah(unitPrice)}
└ Total Produk : ${rupiah(totalPrice)}
${loyaltyDiscount > 0 ? `└ Diskon Loyalty : -${rupiah(loyaltyDiscount)}\n` : ""}${userBalance >= 3000 ? `└ Potongan Saldo : ${depositDeduction > 0 ? `-${rupiah(depositDeduction)} (Saldo ${rupiah(userBalance)})` : "Rp 0 (NONAKTIF)"}\n` : "└ Potongan Saldo : Saldo < Rp 3.000 (Tdk bisa digunakan)\n"}└ Sisa Tagihan QRIS : <b>${rupiah(subtotalAfterDiscount)}</b>

<i>Gunakan tombol di bawah untuk mengatur potongan saldo atau klaim voucher sebelum menerbitkan QRIS.</i>`;

  const keyboard = {
    inline_keyboard: [
      userBalance >= 3000
        ? [
            {
              text: isUseDepositActive ? "💳 Potong Saldo: [ AKTIF ]" : "💳 Potong Saldo: [ NONAKTIF ]",
              callback_data: `checkout_${pId}_${qty}_${isUseDepositActive ? 0 : 1}`,
            },
          ]
        : [],
      [
        {
          text: "🎟️ Klaim / Input Voucher",
          callback_data: "claim_voucher",
        },
      ],
      [
        {
          text: "📲 Terbitkan QRIS & Bayar",
          callback_data: `create_qris_${pId}_${qty}_${isUseDepositActive ? 1 : 0}`,
        },
      ],
      [{ text: "⬅️ Batal / Kembali", callback_data: "list_produk" }],
    ].filter((row) => row.length > 0),
  };

  if (ctx.callback?.message?.message_id) {
    const { editMessage } = await import("../telegram.ts");
    await editMessage(chatId, ctx.callback.message.message_id, checkoutText, keyboard);
  } else {
    await send(chatId, checkoutText, keyboard);
  }

  return ok();
}

export async function handleCreateQris(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const partsCb = data.split("_");
  // create_qris_{pId}_{qty}_{useDeposit}
  const pId = partsCb[2];
  const qty = Math.max(1, Number(partsCb[3] || 1));
  const isUseDepositActive = Number(partsCb[4] || 0) === 1;

  if (!pId || !qty || qty <= 0) {
    await send(chatId, "❌ Data order tidak valid.");
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

  const { data: u, error: userDataError } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (userDataError || !u) {
    await send(chatId, "❌ User tidak ditemukan.");
    return ok();
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * qty;

  const { data: loyaltyData } = await supabase.rpc(
    "get_user_loyalty_summary",
    {
      p_telegram_id: telegramId,
    },
  );

  const loyalty = loyaltyData?.[0];
  const promoActive = Boolean(product.is_promo_active) && Number(product.promo_price || 0) > 0;
  const loyaltyDiscount = Number(promoActive ? 0 : loyalty?.discount_amount || 0);

  const userBalance = Number(u.balance || 0);
  let depositDeduction = 0;
  if (isUseDepositActive && userBalance >= 3000) {
    depositDeduction = Math.min(userBalance, 10000);
  }

  const subtotalAfterDiscount = Math.max(
    0,
    totalPrice - loyaltyDiscount - depositDeduction,
  );

  const uniqueCode = generateUniqueCode();
  const finalAmount = subtotalAfterDiscount + uniqueCode;

  if (unitPrice <= 0) {
    await send(chatId, "❌ Harga produk tidak valid.");
    return ok();
  }

  // Calculate daily order sequence
  const dateKey = getJakartaDateKey().replace(/-/g, "");
  const todayStart = `${getJakartaDateKey()}T00:00:00.000Z`;

  const { count } = await supabase
    .from("pending_orders")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart);

  const seqNumber = (count || 0) + 1;
  const trxCode = generateTrxCode("SSID", seqNumber);
  const shortSeq = `#${String(seqNumber).padStart(6, "0")}`;

  const { data: order, error: orderInsertError } = await supabase
    .from("pending_orders")
    .insert({
      user_id: u.id,
      telegram_id: telegramId,
      product_id: pId,
      qty,
      unit_price: unitPrice,
      total_price: totalPrice,
      loyalty_discount: loyaltyDiscount,
      subtotal_after_discount: subtotalAfterDiscount,
      unique_code: uniqueCode,
      final_amount: finalAmount,
      status: "waiting_payment",
      payment_method: "manual",
    })
    .select()
    .single();

  if (orderInsertError || !order) {
    console.error("CREATE QRIS orderInsertError:", orderInsertError);
    await send(chatId, "❌ Gagal membuat order.");
    return ok();
  }

  const displayCode = generateTrxCode("SSID", seqNumber);

  const invoiceText = `💳 <b>PEMBAYARAN BUY NOW (QRIS)</b>

<b>Informasi Order</b>
└ Kode Order : <code>${escapeHtml(displayCode)}</code> (${shortSeq})
└ Produk : ${escapeHtml(product.product_name)}
└ Kode : ${escapeHtml(product.product_code || "-")}
└ Role Harga : ${escapeHtml(product.user_role || u.role)}
└ Jumlah : ${qty}
└ Harga Satuan : ${rupiah(unitPrice)}
└ Total Produk : ${rupiah(totalPrice)}
${loyaltyDiscount > 0 ? `└ Diskon Loyalty : ${rupiah(loyaltyDiscount)}\n` : ""}${depositDeduction > 0 ? `└ Potongan Saldo : ${rupiah(depositDeduction)} (Saldo ${rupiah(userBalance)})\n` : ""}└ Subtotal : ${rupiah(subtotalAfterDiscount)}
└ Kode Unik : ${uniqueCode}
└ Tagihan Final : <b>${rupiah(finalAmount)}</b>

Silakan lakukan pembayaran via QRIS.
Setelah bayar, klik tombol <b>Sudah Bayar</b>.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "✅ Sudah Bayar", callback_data: `confirm_order_${order.id}` }],
      [{ text: "❌ Batal", callback_data: `cancel_order_${order.id}` }],
    ],
  };

  await sendPhoto(chatId, ENV.QRIS_IMAGE_URL, invoiceText, keyboard);
  return ok();
}

export async function handleConfirmOrder(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId, username } = ctx;
  const orderId = data.replace("confirm_order_", "").trim();

  if (!orderId) {
    await send(chatId, "❌ Order ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "confirm_order_atomic",
    {
      p_order_id: orderId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("CONFIRM ORDER RPC error:", rpcError);
    await send(chatId, "❌ Gagal konfirmasi order.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal konfirmasi order."}`);
    return ok();
  }

  const { data: order, error: orderError } = await supabase
    .from("pending_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError) {
    console.error("CONFIRM ORDER get order error:", orderError);
  }

  if (!order) {
    await send(chatId, "❌ Order tidak ditemukan setelah konfirmasi.");
    return ok();
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("name, product_code")
    .eq("id", order.product_id)
    .single();

  if (productError) {
    console.error("CONFIRM ORDER productError:", productError);
  }

  const displayCode = order?.trx_code || order.id;

  await send(
    chatId,
    `⏳ Konfirmasi pembayaran order dikirim ke owner.

└ Kode Order : <code>${escapeHtml(displayCode)}</code>
└ Status : <b>${escapeHtml(result.out_status || "pending")}</b>`
  );

  const ownerText = `📢 <b>ORDER PAYMENT REQUEST</b>

User: ${username ? `@${escapeHtml(username)}` : "-"}
ID: <code>${telegramId}</code>

└ Kode Order : <code>${escapeHtml(displayCode)}</code>
└ Produk : ${escapeHtml(product?.name || "Produk")}
└ Kode : ${escapeHtml(product?.product_code || "-")}
└ Qty : ${order.qty}
└ Harga Satuan : ${rupiah(order.unit_price)}
└ Total Produk : ${rupiah(order.total_price)}
└ Kode Unik : ${order.unique_code || 0}
└ Tagihan Final : <b>${rupiah(order.final_amount || order.total_price)}</b>

Silakan approve, tolak, atau hapus order ini.`;

  const ownerKb = {
    inline_keyboard: [
      [
        {
          text: "✅ Approve Order",
          callback_data: `approve_order_${order.id}`,
        },
      ],
      [
        {
          text: "❌ Tolak Order",
          callback_data: `reject_order_${order.id}`,
        },
      ],
      [
        {
          text: "🗑 Hapus Order",
          callback_data: `delete_order_${order.id}`,
        },
      ],
    ],
  };

  await notifyAdminsOrOwners(ownerText, ownerKb);
  return ok();
}

export async function handleDeleteOrder(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const role = await getRoleByTelegramId(Number(telegramId));

  if (!isAdminOrOwner(role)) {
    await send(chatId, "❌ Akses ditolak. Hanya admin/owner.");
    return ok();
  }

  const orderId = data.replace("delete_order_", "").trim();

  if (!orderId) {
    await send(chatId, "❌ Order ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "delete_order_atomic",
    {
      p_order_id: orderId,
      p_actor_telegram_id: telegramId,
      p_reason: "Deleted by admin/owner from Telegram bot",
    }
  );

  if (rpcError) {
    console.error("DELETE ORDER RPC error:", rpcError);
    await send(chatId, "❌ Gagal menghapus order.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal menghapus order."}`);
    return ok();
  }

  await send(
    chatId,
    `🗑 Order <code>${escapeHtml(orderId)}</code> berhasil dihapus.`
  );

  try {
    await send(
      Number(result.out_telegram_id),
      `🗑 Order kamu dengan ID <code>${escapeHtml(
        orderId
      )}</code> telah dihapus oleh admin/owner.`
    );
  } catch (err) {
    console.error("DELETE ORDER notify target error:", err);
  }

  return ok();
}

export async function handleCancelOrder(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const orderId = data.replace("cancel_order_", "").trim();

  if (!orderId) {
    await send(chatId, "❌ Order ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "cancel_order_atomic",
    {
      p_order_id: orderId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("CANCEL ORDER RPC error:", rpcError);
    await send(chatId, "❌ Gagal membatalkan order.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal membatalkan order."}`);
    return ok();
  }

  await send(chatId, "❌ Order berhasil dibatalkan.");
  return ok();
}

export async function handleApproveOrder(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const role = await getRoleByTelegramId(Number(telegramId));

  if (!isAdminOrOwner(role)) {
    await send(chatId, "❌ Akses ditolak. Hanya admin/owner.");
    return ok();
  }

  const orderId = data.replace("approve_order_", "").trim();

  if (!orderId) {
    await send(chatId, "❌ Order ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "approve_pending_order",
    {
      p_order_id: orderId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("APPROVE ORDER RPC error:", rpcError);
    await send(chatId, "❌ Gagal approve order.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    const isStockError =
      (result?.message || "").toLowerCase().includes("stok") ||
      (result?.message || "").toLowerCase().includes("stock") ||
      (result?.message || "").toLowerCase().includes("habis");

    if (isStockError) {
      await send(
        chatId,
        `❌ <b>Stok Habis, Gagal Approve!</b>\n\nStok produk ini saat ini 0. Silakan isi stok terlebih dahulu untuk produk ini, lalu klik <b>Approve Order</b> kembali.`
      );

      const { data: pendingOrd } = await supabase
        .from("pending_orders")
        .select("telegram_id")
        .eq("id", orderId)
        .single();

      if (pendingOrd?.telegram_id) {
        await send(
          Number(pendingOrd.telegram_id),
          `✅ <b>Pembayaran Anda telah dikonfirmasi oleh Admin!</b>\n\n⚠️ <b>Status: Menunggu Restock Stok (Pending Delivery)</b>\nSaat ini stok akun sedang habis. Akun Anda akan otomatis dikirimkan setelah Admin melakukan restock. Mohon tunggu sejenak 🙏`
        );
      }
      return ok();
    }

    await send(chatId, `❌ ${result?.message || "Approve order gagal."}`);
    return ok();
  }

  const { data: order, error: orderError } = await supabase
    .from("pending_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError) {
    console.error("APPROVE ORDER get approved order error:", orderError);
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", result.product_id)
    .single();

  if (productError) {
    console.error("APPROVE ORDER get product error:", productError);
  }

  const { data: buyer, error: buyerError } = await supabase
    .from("users")
    .select("*")
    .eq("id", result.user_id)
    .single();

  if (buyerError) {
    console.error("APPROVE ORDER get buyer error:", buyerError);
  }

  const soldAccounts = await getSoldAccountsByOrderId(orderId);

  const items = soldAccounts.map((row: any) => ({
    email: row.account_snapshot?.email ?? "-",
    password: row.account_snapshot?.password ?? "-",
    pin: row.account_snapshot?.pin ?? "-",
    profile: row.account_snapshot?.profile ?? "-",
  }));

  const displayCode = order?.trx_code || orderId;

  const summaryText = `✅ <b>PEMBELIAN BERHASIL!</b>

<b>Informasi Pembelian</b>
└ Kode Order : <code>${escapeHtml(displayCode)}</code>
└ Produk : ${escapeHtml(product?.name || "Produk")}
└ Kode : ${escapeHtml(product?.product_code || "-")}
└ Role Harga : ${escapeHtml(buyer?.role || "-")}
└ Jumlah : ${Number(result.qty || 0)}
└ Harga Satuan : ${rupiah(Number(result.unit_price || 0))}
└ Total Produk : ${rupiah(Number(result.total_price || 0))}
└ Kode Unik : ${order?.unique_code || 0}
└ Tagihan Final : ${rupiah(Number(order?.final_amount || result.total_price || 0))}
└ Metode : ${escapeHtml(order?.payment_method || "manual")}`;

  try {
    await sendPurchaseResult(
      Number(order?.telegram_id),
      summaryText,
      items,
      product?.name || "Produk",
      product?.tos_description
    );
  } catch (err) {
    console.error("APPROVE ORDER sendPurchaseResult error:", err);
  }

  await send(chatId, `✅ Order ${escapeHtml(displayCode)} berhasil di-approve.`);
  return ok();
}

export async function handleRejectOrder(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const role = await getRoleByTelegramId(Number(telegramId));

  if (!isAdminOrOwner(role)) {
    await send(chatId, "❌ Akses ditolak. Hanya admin/owner.");
    return ok();
  }

  const orderId = data.replace("reject_order_", "").trim();

  if (!orderId) {
    await send(chatId, "❌ Order ID tidak valid.");
    return ok();
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "reject_order_atomic",
    {
      p_order_id: orderId,
      p_actor_telegram_id: telegramId,
    }
  );

  if (rpcError) {
    console.error("REJECT ORDER RPC error:", rpcError);
    await send(chatId, "❌ Gagal menolak order.");
    return ok();
  }

  const result = rpcData?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Gagal menolak order."}`);
    return ok();
  }

  await send(chatId, `❌ Order ${escapeHtml(orderId)} berhasil ditolak.`);

  try {
    await send(
      Number(result.out_telegram_id),
      `❌ Order kamu dengan ID <code>${escapeHtml(
        orderId
      )}</code> ditolak admin. Jika sudah transfer, hubungi admin.`
    );
  } catch (err) {
    console.error("REJECT ORDER notify target error:", err);
  }

  return ok();
}
