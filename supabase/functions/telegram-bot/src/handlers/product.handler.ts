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

function buildProductDetail(
  product: any,
  userRole: string,
  qty: number,
  stockNum: number,
  unitPrice: number,
  totalPrice: number
) {
  const text = `
Tambahkan jumlah pembelian:

╭──────────────
• Produk : ${product.product_name}
• Kode : ${product.product_code || "-"}
• Role : ${product.user_role || userRole}
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
        { text: "✏️", callback_data: `qty_custom_${product.product_id}_${qty}` },
        { text: "➕", callback_data: `qty_plus_${product.product_id}_${qty}_${stockNum}` },
      ],
      [
        { text: "🔄 Refresh", callback_data: `refresh_detail_${product.product_id}_${qty}` },
      ],
      [
        { text: "Buy (Saldo)", callback_data: `buy_saldo_${product.product_id}_${qty}` },
        { text: "Buy (Now)", callback_data: `buy_now_${product.product_id}_${qty}` },
      ],
      [{ text: "🔴 Kembali", callback_data: "list_produk" }],
    ],
  };

  return { text, keyboard };
}

function buildProductList(products: any[], page: number, ITEMS_PER_PAGE: number) {
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

  const numberButtons: any[] = [];

  for (let i = 0; i < products.length; i += 5) {
    const row = [];

    for (
      let j = i;
      j < Math.min(i + 5, products.length);
      j++
    ) {
      const nomor = startIndex + j + 1;

      row.push({
        text: String(nomor),
        callback_data: `pick_product_${nomor}`,
      });
    }

    numberButtons.push(row);
  }

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🔴 Previous",
          callback_data: `list_produk_page_${Math.max(1, page - 1)}`,
        },
        {
          text: "🔄 Refresh",
          callback_data: `list_produk_page_${page}`,
        },
        {
          text: "➡️ Next",
          callback_data: `list_produk_page_${Math.min(totalPages, page + 1)}`,
        },
      ],

      ...numberButtons,

      [
        {
          text: "🟢 Home",
          callback_data: "start",
        },
      ],
    ],
  };

  return { text: textProduk, keyboard };
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

  const { text, keyboard } = buildProductDetail(
    product,
    user.role,
    safeQty,
    stockNum,
    unitPrice,
    totalPrice
  );

  await send(chatId, text, keyboard);
  return ok();
}

export async function handlePromoAktif(ctx: BotContext): Promise<Response> {
  const { chatId, user } = ctx;
  const role = String(user.role || "reguler").toLowerCase();

  if (!(role === "reguler" || role === "regular" || role === "reseller")) {
    await send(chatId, "🔥 Promo aktif tersedia untuk user reguler/reseller.", {
      inline_keyboard: [[{ text: "🟢 Home", callback_data: "start" }]],
    });
    return ok();
  }

  const { data, error } = await supabase.rpc("get_active_promos_for_bot", {
    p_user_id: user.id,
  });

  if (error) {
    console.error("handlePromoAktif error:", error);
    await send(chatId, "❌ Gagal memuat promo aktif.");
    return ok();
  }

  const promos = data || [];
  if (!promos.length) {
    await send(chatId, "🔥 Belum ada promo aktif saat ini.\n\nKetik /start untuk order 🛒", {
      inline_keyboard: [[{ text: "🛒 List Produk", callback_data: "list_produk" }]],
    });
    return ok();
  }

  let text = `┌─「 🔥 PROMO AKTIF 」\n`;
  promos.forEach((promo: any) => {
    const label = promo.promo_label || promo.product_name || "Produk";
    text += `│ 🎬 ${escapeHtml(label)} : ${rupiah(Number(promo.final_price || 0))}\n`;
  });
  text += `└─────────────────\n\nKetik /start untuk order 🛒`;

  await send(chatId, text, {
    inline_keyboard: [
      [{ text: "🛒 List Produk", callback_data: "list_produk" }],
      [{ text: "🟢 Home", callback_data: "start" }],
    ],
  });
  return ok();
}

export async function handleQtyCustom(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId, msg } = ctx;

  const parts = data.split("_");
  const productId = parts[2];

  // Simpan session ke database. 
  // Pastikan Anda sudah membuat table "qty_sessions" dengan kolom: telegram_id (PK), product_id, message_id
  await supabase.from("qty_sessions").upsert({
    telegram_id: telegramId,
    product_id: productId,
    message_id: msg.message_id,
  });

  await send(
    chatId,
    "Silakan kirim jumlah pembelian.\n\nContoh:\n5\n10\n25"
  );

  return ok();
}

export async function handleQtyCustomInput(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, normalizedText, user } = ctx;

  // Cek apakah user sedang dalam mode input custom qty
  const { data: session } = await supabase
    .from("qty_sessions")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!session) {
    // Jika tidak ada session, berarti user mengetik angka untuk memilih produk
    return await handleProductNumberInput(ctx);
  }

  let newQty = parseInt(String(normalizedText));
  
  if (isNaN(newQty)) {
    return await handleProductNumberInput(ctx);
  }

  if (newQty < 1) newQty = 1;

  const productId = session.product_id;
  const product = await getProductDetailForBot(productId, user.id);

  if (!product) {
    await send(chatId, "❌ Produk tidak ditemukan.");
    await supabase.from("qty_sessions").delete().eq("telegram_id", telegramId);
    return ok();
  }

  const stockNum = Number(product.stock_count || 0);

  if (stockNum > 0 && newQty > stockNum) {
    newQty = stockNum;
  }

  const unitPrice = Number(product.final_price || 0);
  const totalPrice = unitPrice * newQty;

  const { text, keyboard } = buildProductDetail(
    product,
    user.role,
    newQty,
    stockNum,
    unitPrice,
    totalPrice
  );

  // Update pesan detail yang lama
  await editMessage(chatId, session.message_id, text, keyboard);

  // Hapus session setelah berhasil update qty
  await supabase.from("qty_sessions").delete().eq("telegram_id", telegramId);

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

  // Tetap dipertahankan barangkali ada pesan lama (sebelum update) yang masih menggunakan tombol reset
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

  const { text, keyboard } = buildProductDetail(
    product,
    user.role,
    qty,
    stockNum,
    unitPrice,
    totalPrice
  );

  await editMessage(chatId, msg.message_id, text, keyboard);
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

  const { text, keyboard } = buildProductDetail(
    product,
    user.role,
    qty,
    stockNum,
    unitPrice,
    totalPrice
  );

  await editMessage(chatId, msg.message_id, text, keyboard);
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

  const { text, keyboard } = buildProductList(products, page, ITEMS_PER_PAGE);

  await send(chatId, text, keyboard);
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
    await editMessage(chatId, msg.message_id, "❌ Gagal mengambil daftar produk.");
    return ok();
  }

  if (!products || products.length === 0) {
    await editMessage(chatId, msg.message_id, "📭 Tidak ada produk dengan stok tersedia.", {
      inline_keyboard: [[{ text: "🟢 Home", callback_data: "start" }]],
    });
    return ok();
  }

  const { text, keyboard } = buildProductList(products, page, ITEMS_PER_PAGE);

  await editMessage(chatId, msg.message_id, text, keyboard);
  return ok();
}

export async function handlePickProduct(
  ctx: BotContext,
  data: string
): Promise<Response> {

  const nomor = Number(
    data.replace("pick_product_", "")
  );

  ctx.normalizedText = String(nomor);

  return await handleProductNumberInput(ctx);
}
