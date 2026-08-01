import { ENV } from "../env.ts";
import { supabase } from "../supabase.ts";
import { send, sendPhoto, editCaption } from "../telegram.ts";
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

  const dateKey = getJakartaDateKey().replace(/-/g, "");
  const todayStart = `${getJakartaDateKey()}T00:00:00.000Z`;

  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart);

  const seqNumber = (count || 0) + 1;
  const displayCode = generateTrxCode("SSID", seqNumber);
  const shortSeq = `#${String(seqNumber).padStart(6, "0")}`;

  const summaryText = `✅ <b>PEMBELIAN BERHASIL!</b>

<b>Informasi Pembelian</b>
└ Kode Order : <code>${escapeHtml(displayCode)}</code> (${shortSeq})
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
    product.tos_description || product.description
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

  const vpayApiKey = ENV.VPAY_API_KEY;
  let paymentRefId: string | null = null;
  let finalQrImage = ENV.QRIS_IMAGE_URL;
  let finalAmountPay = finalAmount;
  let finalUniqueCode = uniqueCode;

  if (vpayApiKey && subtotalAfterDiscount >= 1000) {
    try {
      const response = await fetch("https://vitopediapay.com/api/pg/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${vpayApiKey}`
        },
        body: JSON.stringify({
          amount: subtotalAfterDiscount,
          ref_id: trxCode
        })
      });
      const result = await response.json();
      if (result.success && result.data) {
        paymentRefId = result.data.id;
        finalQrImage = result.data.qr_image;
        finalAmountPay = Number(result.data.total);
        finalUniqueCode = Number(result.data.unique_code);
      } else {
        console.error("VPay API error response:", result);
      }
    } catch (err) {
      console.error("VPay API connection error:", err);
    }
  }

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
      unique_code: finalUniqueCode,
      final_amount: finalAmountPay,
      status: "waiting_payment",
      payment_method: paymentRefId ? "qris_dynamic" : "manual",
      payment_reference_id: paymentRefId
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
└ Kode Unik : ${finalUniqueCode}
└ Tagihan Final : <b>${rupiah(finalAmountPay)}</b>

Silakan lakukan pembayaran via QRIS.
${paymentRefId ? "Setelah bayar, klik tombol <b>Cek Status Pembayaran</b>." : "Setelah bayar, klik tombol <b>Sudah Bayar</b>."}`;

  const keyboard = {
    inline_keyboard: paymentRefId
      ? [
          [{ text: "🔄 Cek Status Pembayaran", callback_data: `check_pay_pg_${order.id}` }],
          [{ text: "❌ Batal", callback_data: `cancel_order_${order.id}` }],
        ]
      : [
          [{ text: "✅ Sudah Bayar", callback_data: `confirm_order_${order.id}` }],
          [{ text: "❌ Batal", callback_data: `cancel_order_${order.id}` }],
        ],
  };

  await sendPhoto(chatId, finalQrImage, invoiceText, keyboard);
  return ok();
}

export async function handleCheckPaymentPg(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId } = ctx;
  const orderId = data.replace("check_pay_pg_", "").trim();

  if (!orderId) {
    await send(chatId, "❌ Order ID tidak valid.");
    return ok();
  }

  const { data: order, error } = await supabase
    .from("pending_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    await send(chatId, "❌ Detail order tidak ditemukan.");
    return ok();
  }

  if (order.status !== "waiting_payment") {
    await send(chatId, `ℹ️ Order ini sudah diproses (Status: ${order.status}).`);
    return ok();
  }

  const paymentRef = order.payment_reference_id;
  if (!paymentRef) {
    await send(chatId, "❌ Referensi pembayaran gateway tidak ditemukan.");
    return ok();
  }

  const vpayApiKey = ENV.VPAY_API_KEY;
  if (!vpayApiKey) {
    await send(chatId, "❌ Sistem VPay sedang tidak dikonfigurasi.");
    return ok();
  }

  try {
    const checkRes = await fetch(`https://vitopediapay.com/api/pg/check/${paymentRef}`, {
      headers: {
        "Authorization": `Bearer ${vpayApiKey}`
      }
    });
    const checkData = await checkRes.json();

    if (!checkData.success || !checkData.data) {
      await send(chatId, "❌ Gagal memverifikasi status ke Payment Gateway.");
      return ok();
    }

    const pgStatus = checkData.data.status; // pending, paid, expired

    if (pgStatus === "paid") {
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "approve_pending_order",
        {
          p_order_id: orderId,
          p_actor_telegram_id: 72246533, // Auto approve using owner ID
        }
      );

      if (rpcError || !rpcData?.success) {
        console.error("Auto-approve error:", rpcError || rpcData?.message);
        await send(
          chatId,
          `❌ Pembayaran sukses terverifikasi, tetapi gagal merilis stok: ${rpcData?.message || "Error database"}. Silakan hubungi admin.`
        );
        return ok();
      }

      const trxId = rpcData.transaction_id;
      const { data: trx } = await supabase
        .from("transactions")
        .select("id, trx_code, product_accounts(email, password, profile, pin)")
        .eq("id", trxId)
        .maybeSingle();

      const paRaw = trx?.product_accounts;
      const pa = Array.isArray(paRaw) ? paRaw[0] : paRaw;
      let items: any[] = [];
      if (pa && pa.email) {
        await supabase
          .from("sold_accounts")
          .update({
            account_snapshot: {
              email: pa.email,
              password: pa.password,
              profile: pa.profile,
              pin: pa.pin,
              sold_at: new Date().toISOString(),
            },
          })
          .eq("transaction_id", trxId);

        items = [{
          email: pa.email,
          password: pa.password,
          profile: pa.profile,
          pin: pa.pin,
        }];
      }

      const { data: product } = await supabase
        .from("products")
        .select("name, product_code, tos_description, description")
        .eq("id", order.product_id)
        .single();

      const { getFriendlyShortId } = await import("../src/handlers/active_orders.handler.ts");
      const shortSeq = getFriendlyShortId(trx?.trx_code || orderId);

      const summaryText = `🎉 <b>PEMBAYARAN QRIS DISETUJUI OTOMATIS!</b>
  
<b>Informasi Pembelian</b>
└ Kode Order : <code>${escapeHtml(trx?.trx_code || orderId)}</code> (${shortSeq})
└ Produk : ${escapeHtml(product?.name || "Produk")}
└ Kode : ${escapeHtml(product?.product_code || "-")}
└ Jumlah : ${Number(order.qty || 1)}
└ Total : ${rupiah(Number(order.subtotal_after_discount || 0))}
└ Metode : QRIS Dinamis`;

      await sendPurchaseResult(
        chatId,
        summaryText,
        items,
        product?.name || "Produk",
        product?.tos_description || product?.description
      );

      const adminText = `🔔 <b>ORDER QRIS OTOMATIS BERHASIL!</b>
  
└ Order ID : <code>${orderId}</code>
└ Kode Order : <code>${trx?.trx_code}</code>
└ Pelanggan : <code>${chatId}</code>
└ Produk : ${product?.name}
└ Jumlah : ${order.qty}
└ Total Tagihan : ${rupiah(order.final_amount)}`;
      await send(72246533, adminText);
      return ok();
    } else if (pgStatus === "expired") {
      await supabase
        .from("pending_orders")
        .update({ status: "cancelled" })
        .eq("id", orderId);

      await send(chatId, "⚠️ <b>Waktu Pembayaran Habis!</b>\n\nTagihan QRIS ini sudah kedaluwarsa (expired). Silakan buat pesanan baru.");
      return ok();
    } else {
      await send(
        chatId,
        "⚠️ <b>Pembayaran Belum Diterima</b>\n\nKami belum mendeteksi pembayaran Anda. Harap scan QRIS di atas dan transfer sesuai nominal pas (termasuk kode unik) sebelum menekan tombol cek status kembali."
      );
      return ok();
    }
  } catch (err) {
    console.error("handleCheckPaymentPg error:", err);
    await send(chatId, "❌ Terjadi kesalahan saat memeriksa status pembayaran.");
    return ok();
  }
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
    .select("name, product_code, tos_description, description")
    .eq("id", order.product_id)
    .single();

  if (productError) {
    console.error("CONFIRM ORDER productError:", productError);
  }

  if (result.out_status === "paid" || (result.transaction_id && result.out_status !== "pending")) {
    const dateKey = getJakartaDateKey().replace(/-/g, "");
    const todayStart = `${getJakartaDateKey()}T00:00:00.000Z`;

    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart);

    const seqNumber = Math.max(1, count || 1);
    const formattedTrxCode = `SSID-${dateKey}-${String(seqNumber).padStart(6, "0")}`;

    if (result.transaction_id) {
      await supabase
        .from("transactions")
        .update({ trx_code: formattedTrxCode })
        .eq("id", result.transaction_id);
    }

    const { data: trxWithAcc } = await supabase
      .from("transactions")
      .select("account_id, product_accounts(email, password, profile, pin)")
      .eq("id", result.transaction_id)
      .maybeSingle();

    let items: any[] = [];
    const paRaw = trxWithAcc?.product_accounts;
    const pa = Array.isArray(paRaw) ? paRaw[0] : paRaw;
    if (pa && pa.email) {
      await supabase
        .from("sold_accounts")
        .update({
          account_snapshot: {
            email: pa.email,
            password: pa.password,
            profile: pa.profile,
            pin: pa.pin,
            sold_at: new Date().toISOString(),
          },
        })
        .eq("transaction_id", result.transaction_id);

      items = [{
        email: pa.email,
        password: pa.password,
        profile: pa.profile,
        pin: pa.pin,
      }];
    } else {
      let soldAccounts = await getSoldAccountsByOrderId(result.transaction_id || "");
      if (!soldAccounts || soldAccounts.length === 0) {
        soldAccounts = await getSoldAccountsByOrderId(orderId);
      }
      items = soldAccounts.map((row: any) => ({
        email: row.account_snapshot?.email ?? pa?.email ?? "-",
        password: row.account_snapshot?.password ?? pa?.password ?? "-",
        pin: row.account_snapshot?.pin ?? pa?.pin ?? "-",
        profile: row.account_snapshot?.profile ?? pa?.profile ?? "-",
      }));
    }

    const { getFriendlyShortId } = await import("../src/handlers/active_orders.handler.ts");
    const displayCode = formattedTrxCode || order?.trx_code || `SSID-${orderId.slice(0, 8).toUpperCase()}`;
    const shortSeq = getFriendlyShortId(formattedTrxCode || order || orderId);

    const summaryText = `✅ <b>PEMBELIAN BERHASIL!</b>

<b>Informasi Pembelian</b>
└ Kode Order : <code>${escapeHtml(displayCode)}</code> (${shortSeq})
└ Produk : ${escapeHtml(product?.name || "Produk")}
└ Kode : ${escapeHtml(product?.product_code || "-")}
└ Jumlah : ${Number(order.qty || 1)}
└ Harga Satuan : ${rupiah(Number(order.unit_price || 0))}
└ Total : ${rupiah(Number(order.total_price || 0))}
└ Metode : Saldo`;

    await sendPurchaseResult(
      chatId,
      summaryText,
      items,
      product?.name || "Produk",
      product?.tos_description || product?.description
    );

    const msgId = ctx.callback?.message?.message_id;
    if (msgId) {
      try {
        const originalCaption = ctx.callback?.message?.caption || "";
        const updatedCaption = `${originalCaption}\n\n✅ <b>Lunas (Pembayaran Berhasil)</b>`;
        await editCaption(chatId, msgId, updatedCaption, null);
      } catch (err) {
        console.error("Failed to edit paid caption:", err);
      }
    }
    return ok();
  }

  const displayCode = order?.trx_code || order.id;

  const msgId = ctx.callback?.message?.message_id;
  if (msgId) {
    try {
      const originalCaption = ctx.callback?.message?.caption || "";
      const updatedCaption = `${originalCaption}\n\n⏳ <b>Menunggu Konfirmasi Admin</b>`;
      await editCaption(chatId, msgId, updatedCaption, null);
    } catch (err) {
      console.error("Failed to edit pending caption:", err);
    }
  }

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

  const msgId = ctx.callback?.message?.message_id;
  if (msgId) {
    try {
      const originalCaption = ctx.callback?.message?.caption || "";
      const updatedCaption = `${originalCaption}\n\n❌ <b>Pemesanan Dibatalkan</b>`;
      await editCaption(chatId, msgId, updatedCaption, null);
    } catch (err) {
      console.error("Failed to edit cancel caption:", err);
    }
  }

  return ok();
}

export async function handleApproveOrder(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const role = await getRoleByTelegramId(Number(telegramId));

  if (!isAdminOrOwner(role, telegramId)) {
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

  // Format and update custom order code on transaction record
  const dateKey = getJakartaDateKey().replace(/-/g, "");
  const todayStart = `${getJakartaDateKey()}T00:00:00.000Z`;

  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart);

  const seqNumber = Math.max(1, count || 1);
  const formattedTrxCode = generateTrxCode("SSID", seqNumber);

  if (result.transaction_id) {
    await supabase
      .from("transactions")
      .update({ trx_code: formattedTrxCode })
      .eq("id", result.transaction_id);
  }

  const targetProductId = result.out_product_id || result.product_id || order?.product_id;
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", targetProductId)
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

  let soldAccounts = await getSoldAccountsByOrderId(result.transaction_id || "");
  if (!soldAccounts || soldAccounts.length === 0) {
    soldAccounts = await getSoldAccountsByOrderId(orderId);
  }

  const items = soldAccounts.map((row: any) => ({
    email: row.account_snapshot?.email ?? "-",
    password: row.account_snapshot?.password ?? "-",
    pin: row.account_snapshot?.pin ?? "-",
    profile: row.account_snapshot?.profile ?? "-",
  }));

  const { getFriendlyShortId } = await import("../src/handlers/active_orders.handler.ts");
  const displayCode = formattedTrxCode || order?.trx_code || `SSID-${orderId.slice(0, 8).toUpperCase()}`;
  const shortSeq = getFriendlyShortId(formattedTrxCode || order || orderId);

  const summaryText = `✅ <b>PEMBELIAN BERHASIL!</b>

<b>Informasi Pembelian</b>
└ Kode Order : <code>${escapeHtml(displayCode)}</code> (${shortSeq})
└ Produk : ${escapeHtml(product?.name || "Produk")}
└ Kode : ${escapeHtml(product?.product_code || "-")}
└ Role Harga : ${escapeHtml(buyer?.role || "-")}
└ Jumlah : ${Number(result.qty || 0)}
└ Harga Satuan : ${rupiah(Number(result.unit_price || 0))}
└ Total Produk : ${rupiah(Number(result.total_price || 0))}
└ Kode Unik : ${order?.unique_code || 0}
└ Tagihan Final : ${rupiah(Number(order?.final_amount || result.total_price || 0))}
└ Metode : ${escapeHtml(order?.payment_method || "manual")}`;

  const buyerTelegramId = Number(order?.telegram_id || result?.out_telegram_id || buyer?.telegram_id || 0);

  if (buyerTelegramId > 0) {
    try {
      await sendPurchaseResult(
        buyerTelegramId,
        summaryText,
        items,
        product?.name || "Produk",
        product?.tos_description || product?.description
      );
    } catch (err) {
      console.error("APPROVE ORDER sendPurchaseResult error:", err);
    }
  }

  const approveMsgText = `✅ <b>ORDER APPROVED!</b>\n\n└ Kode Order : <code>${escapeHtml(displayCode)}</code> (${shortSeq})\n└ Produk : ${escapeHtml(product?.name || "Produk")}\n└ Status : <b>LUNAS & DIKIRIM KE PEMBELI</b>`;

  if (ctx.msg?.message_id || ctx.callback?.message?.message_id) {
    const { editMessage } = await import("../telegram.ts");
    const msgId = ctx.callback?.message?.message_id || ctx.msg?.message_id;
    await editMessage(chatId, msgId, approveMsgText);
  } else {
    await send(chatId, approveMsgText);
  }
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
