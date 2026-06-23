import { supabase } from "../../supabase.ts";

import {
  send,
  editMessage,
} from "../../telegram.ts";

import {
  rupiah,
  escapeHtml,
} from "../../helper.ts";

import type { BotContext } from "../../context.ts";

function ok(body = "OK", status = 200) {
  return new Response(body, { status });
}

async function getProductDetailForBot(
  productId: string,
  userId: string,
) {
  const { data, error } = await supabase.rpc(
    "get_product_detail_for_bot",
    {
      p_product_id: productId,
      p_user_id: userId,
    },
  );

  if (error) {
    console.error(error);
    return null;
  }

  return data?.[0] ?? null;
}

// ===============================
// EXPORTED HANDLERS
// ===============================

export async function handleProductNumberInput(ctx: BotContext): Promise<Response> {
  const { chatId, normalizedText, user } = ctx;

  const pIdx = parseInt(String(normalizedText)) - 1;

  const { data: visibleProducts, error: visibleProductsError } = await supabase.rpc(
    "get_products_with_stock",
    {
      p_page: 1,
      p_limit: 1000,
    }
  );

  if (visibleProductsError) {
    console.error("DETAIL PRODUK visibleProductsError:", visibleProductsError);
    await send(chatId, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!visibleProducts || !visibleProducts[pIdx]) {
    await send(chatId, "❌ Nomor produk tidak valid.");
    return ok();
  }

  const productId = visibleProducts[pIdx].id;
  const product = await getProductDetailForBot(productId, user.id);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan atau sedang nonaktif.");
    return ok();
  }

  const qty = 1;
  const stockNum = Number(product.stock_count || 0);
  const safeQty = stockNum > 0 ? Math.min(qty, stockNum) : 1;
  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * safeQty;

  const detailText = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || user.role}
• Sisa Stok : ${stockNum}
• Desk : ${product.description || "-"}
╰──────────────

╭──────────────
• Jumlah : ${safeQty}
• Harga : ${rupiah(unitPrice)}
• Total Harga : ${rupiah(totalPrice)}
╰──────────────
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `qty_minus_${product.product_id}_${safeQty}_${stockNum}` },
        { text: "✏️", callback_data: `qty_reset_${product.product_id}_${safeQty}_${stockNum}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${safeQty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${safeQty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${safeQty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${safeQty}` },
      ],
      [{ text: "⬅️ Kembali", callback_data: "list_produk" }],
    ],
  };

  await send(chatId, detailText, keyboard);
  return ok();
}

export async function handleQtyAction(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, user, msg } = ctx;

  const parts = data.split("_");
  const action = parts[1];
  const productId = parts[2];
  let qty = Number(parts[3] || 1);
  const stockFromCallback = Number(parts[4] || 0);

  if (!qty || qty < 1) qty = 1;

  const product = await getProductDetailForBot(productId, user.id);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan.");
    return ok();
  }

  const stockNum = Number(product.stock_count ?? stockFromCallback ?? 0);
  const beforeQty = qty;

  if (action === "plus") {
    if (stockNum > 0 && qty < stockNum) {
      qty++;
    }
  }

  if (action === "minus" && qty > 1) {
    qty--;
  }

  if (action === "reset") {
    qty = 1;
  }

  if (stockNum > 0 && qty > stockNum) {
    qty = stockNum;
  }

  if (qty < 1) qty = 1;

  if (qty === beforeQty && action !== "reset") {
    return ok();
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * qty;

  const textDetail = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || user.role}
• Sisa Stok : ${stockNum}
• Desk : ${product.description || "-"}
╰──────────────

╭──────────────
• Jumlah : ${qty}
• Harga : ${rupiah(unitPrice)}
• Total Harga : ${rupiah(totalPrice)}
╰──────────────
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `qty_minus_${product.product_id}_${qty}_${stockNum}` },
        { text: "✏️", callback_data: `qty_reset_${product.product_id}_${qty}_${stockNum}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${qty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${qty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${qty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${qty}` },
      ],
      [{ text: "⬅️ Kembali", callback_data: "list_produk" }],
    ],
  };

  await editMessage(chatId, msg.message_id, textDetail, keyboard);
  return ok();
}

export async function handleRefreshDetail(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, user, msg } = ctx;

  const parts = data.split("_");
  const productId = parts[2];
  let qty = Number(parts[3] || 1);

  if (!qty || qty < 1) qty = 1;

  const product = await getProductDetailForBot(productId, user.id);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan.");
    return ok();
  }

  const stockNum = Number(product.stock_count || 0);

  if (stockNum > 0 && qty > stockNum) {
    qty = stockNum;
  }

  if (qty < 1) {
    qty = 1;
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * qty;

  const textDetail = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || user.role}
• Sisa Stok : ${stockNum}
• Desk : ${product.description || "-"}
╰──────────────

╭──────────────
• Jumlah : ${qty}
• Harga : ${rupiah(unitPrice)}
• Total Harga : ${rupiah(totalPrice)}
╰──────────────
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `qty_minus_${product.product_id}_${qty}_${stockNum}` },
        { text: "✏️", callback_data: `qty_reset_${product.product_id}_${qty}_${stockNum}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${qty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${qty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${qty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${qty}` },
      ],
      [{ text: "⬅️ Kembali", callback_data: "list_produk" }],
    ],
  };

  await editMessage(chatId, msg.message_id, textDetail, keyboard);
  return ok();
}

export async function handleListProduk(ctx: BotContext): Promise<Response> {
  const { chatId } = ctx;
  const ITEMS_PER_PAGE = 10;
  const page = 1;

  const { data: products, error } = await supabase.rpc(
    "get_products_with_stock",
    {
      p_page: page,
      p_limit: ITEMS_PER_PAGE,
    }
  );

  if (error) {
    console.error("LIST PRODUK RPC error:", error);
    await send(chatId, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!products || products.length === 0) {
    await send(chatId, "📭 Tidak ada produk dengan stok tersedia.");
    return ok();
  }

  const totalCount = Number(products[0]?.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const startIndex = (page - 1) * ITEMS_PER_PAGE;

  let textProduk = `<b>LIST PRODUCT</b>\n\n`;

  products.forEach((p: any, i: number) => {
    const nomor = startIndex + i + 1;
    textProduk += `[${nomor}]. ${escapeHtml(p.name)} ( ${Number(
      p.stock || 0
    )} )\n`;
  });

  textProduk += `\n📄 Halaman ${page}/${totalPages}`;

  const navRow: any[] = [];
  if (page > 1) {
    navRow.push({
      text: "⬅️ Sebelumnya",
      callback_data: `list_produk_page_${page - 1}`,
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "➡️ Selanjutnya",
      callback_data: `list_produk_page_${page + 1}`,
    });
  }

  const keyboard = {
    inline_keyboard: [
      ...(navRow.length ? [navRow] : []),
      [{ text: "🏠 Home", callback_data: "start" }],
    ],
  };

  await send(chatId, textProduk, keyboard);
  return ok();
}

export async function handleListProdukPage(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, msg } = ctx;
  const ITEMS_PER_PAGE = 10;
  const page = Number(data.replace("list_produk_page_", "")) || 1;

  const { data: products, error } = await supabase.rpc(
    "get_products_with_stock",
    {
      p_page: page,
      p_limit: ITEMS_PER_PAGE,
    }
  );

  if (error) {
    console.error("LIST PRODUK PAGING RPC error:", error);
    await send(chatId, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!products || products.length === 0) {
    await editMessage(chatId, msg.message_id, "📭 Tidak ada produk dengan stok tersedia.", {
      inline_keyboard: [[{ text: "🏠 Home", callback_data: "start" }]],
    });
    return ok();
  }

  const totalCount = Number(products[0]?.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const startIndex = (page - 1) * ITEMS_PER_PAGE;

  let textProduk = `<b>LIST PRODUCT</b>\n\n`;

  products.forEach((p: any, i: number) => {
    const nomor = startIndex + i + 1;
    textProduk += `[${nomor}]. ${escapeHtml(p.name)} ( ${Number(
      p.stock || 0
    )} )\n`;
  });

  textProduk += `\n📄 Halaman ${page}/${totalPages}`;

  const navRow: any[] = [];
  if (page > 1) {
    navRow.push({
      text: "⬅️ Sebelumnya",
      callback_data: `list_produk_page_${page - 1}`,
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "➡️ Selanjutnya",
      callback_data: `list_produk_page_${page + 1}`,
    });
  }

  const keyboard = {
    inline_keyboard: [
      ...(navRow.length ? [navRow] : []),
      [{ text: "🏠 Home", callback_data: "start" }],
    ],
  };

  await editMessage(chatId, msg.message_id, textProduk, keyboard);
  return ok();
}