import { ENV } from "../env.ts";
import { supabase } from "../supabase.ts";
import { send, sendPhoto, sendLongMessage } from "../telegram.ts";
import {
  rupiah,
  escapeHtml,
  formatMultiline,
  generateTrxCode,
  generateUniqueCode,
} from "../helper.ts";
import { getRoleByTelegramId, getUserIdByTelegramId } from "../user.repo.ts";
import type { BotContext } from "../context.ts";

function ok() {
  return new Response("ok");
}

function isAdminOrOwner(role: string) {
  return role === "admin" || role === "owner";
}

async function getProductDetailForBot(productId: string, userId: string) {
  const { data, error } = await supabase.rpc("get_product_detail_for_bot", {
    p_product_id: productId,
    p_user_id: userId,
  });

  if (error) {
    console.error("getProductDetailForBot RPC error:", error);
    return null;
  }

  return data?.[0] ?? null;
}

async function getUserActiveOrder(
  telegramId: number,
  excludeOrderId?: string
) {
  let query = supabase
    .from("pending_orders")
    .select("id, status, created_at")
    .eq("telegram_id", telegramId)
    .is("deleted_at", null)
    .in("status", ["waiting_payment", "pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (excludeOrderId) {
    query = query.neq("id", excludeOrderId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("getUserActiveOrder error:", error);
    return null;
  }

  return data ?? null;
}

async function notifyAdminsOrOwners(text: string, kb?: any) {
  const recipients = new Set<number>();

  if (ENV.OWNER_TELEGRAM_ID > 0) {
    recipients.add(Number(ENV.OWNER_TELEGRAM_ID));
  }

  const { data: rows, error } = await supabase
    .from("users")
    .select("telegram_id")
    .in("role", ["admin", "owner"])
    .eq("is_banned", false);

  if (error) {
    console.error("notifyAdminsOrOwners query error:", error);
  }

  for (const row of rows || []) {
    if (row.telegram_id) {
      recipients.add(Number(row.telegram_id));
    }
  }

  console.log("notifyAdminsOrOwners recipients:", [...recipients]);

  if (recipients.size === 0) {
    console.error("notifyAdminsOrOwners: no recipients found");
    return;
  }

  for (const recipientId of recipients) {
    try {
      await send(recipientId, text, kb);
      console.log("notifyAdminsOrOwners sent to:", recipientId);
    } catch (err) {
      console.error("notifyAdminsOrOwners send error:", {
        recipientId,
        err,
      });
    }
  }
}

async function sendPurchaseResult(
  chatId: number,
  summaryText: string,
  items: any[],
  productName: string,
  tosDescription?: string | null
) {
  await sendLongMessage(chatId, summaryText);

  for (let i = 0; i < items.length; i++) {
    const itm = items[i];

    const itemText = `<b>[${escapeHtml(productName)} - Akun ${i + 1}]</b>
└ Email : <code>${escapeHtml(itm.email ?? "-")}</code>
└ Password : <code>${escapeHtml(itm.password ?? "-")}</code>
└ Profile : ${escapeHtml(itm.profile ?? "-")}
└ PIN : ${escapeHtml(itm.pin ?? "-")}`;

    await sendLongMessage(chatId, itemText);
  }

  const tos = formatMultiline(tosDescription);
  if (tos && tos !== "-") {
    await sendLongMessage(chatId, `<b>Term of Service</b>\n${escapeHtml(tos)}`);
  }
}

async function getLatestSoldAccountsForUserProduct(
  userId: string,
  productId: string,
  qty: number
) {
  const { data, error } = await supabase
    .from("sold_accounts")
    .select("id, created_at, account_snapshot")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(qty);

  if (error) {
    console.error("getLatestSoldAccountsForUserProduct error:", error);
    return [];
  }

  return data || [];
}

async function getSoldAccountsByOrderId(orderId: string) {
  const { data, error } = await supabase
    .from("sold_accounts")
    .select(`
      id,
      created_at,
      account_snapshot,
      transactions!inner (
        id,
        invoice
      )
    `)
    .eq("transactions.invoice", orderId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getSoldAccountsByOrderId error:", error);
    return [];
  }

  return data || [];
}

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
  const pId = partsCb[2];
  const qty = Math.max(1, Number(partsCb[3] || 1));

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

  if (u.is_banned) {
    await send(chatId, "❌ Akun kamu sedang dibanned.");
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
  const uniqueCode = generateUniqueCode();
  const finalAmount = totalPrice + uniqueCode;

  if (unitPrice <= 0) {
    await send(chatId, "❌ Harga produk tidak valid.");
    return ok();
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
      unique_code: uniqueCode,
      final_amount: finalAmount,
      status: "waiting_payment",
      payment_method: "manual",
    })
    .select()
    .single();

  if (orderInsertError || !order) {
    console.error("BUY NOW orderInsertError:", orderInsertError);
    await send(chatId, "❌ Gagal membuat order.");
    return ok();
  }

  const invoiceText = `💳 <b>PEMBAYARAN BUY NOW</b>

<b>Informasi Order</b>
└ Order ID : <code>${escapeHtml(order.id)}</code>
└ Produk : ${escapeHtml(product.product_name)}
└ Kode : ${escapeHtml(product.product_code || "-")}
└ Role Harga : ${escapeHtml(product.user_role || u.role)}
└ Jumlah : ${qty}
└ Harga Satuan : ${rupiah(unitPrice)}
└ Total Produk : ${rupiah(totalPrice)}
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

  await send(
    chatId,
    `⏳ Konfirmasi pembayaran order dikirim ke owner.

└ Order ID : <code>${escapeHtml(orderId)}</code>
└ Status : <b>${escapeHtml(result.out_status || "pending")}</b>`
  );

  const ownerText = `📢 <b>ORDER PAYMENT REQUEST</b>

User: ${username ? `@${escapeHtml(username)}` : "-"}
ID: <code>${telegramId}</code>

└ Order ID : <code>${escapeHtml(order.id)}</code>
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

  const summaryText = `✅ <b>PEMBELIAN BERHASIL!</b>

<b>Informasi Pembelian</b>
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

  await send(chatId, `✅ Order ${escapeHtml(orderId)} berhasil di-approve.`);
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