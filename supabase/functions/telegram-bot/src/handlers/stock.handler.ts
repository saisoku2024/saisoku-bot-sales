import { supabase } from "../../supabase.ts";
import { send } from "../../telegram.ts";
import type { BotContext } from "../../context.ts";
import {
  getTelegramFile,
  downloadTelegramFile,
  editMessage,
} from "../../telegram.ts";

const ITEMS_PER_PAGE = 10;

function ok() {
  return new Response("ok");
}

interface StockAccount {
  email: string;
  password: string;
  profile: string;
  pin: string;
}

function parseStockFile(content: string) {
  const lines = content
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const accounts: StockAccount[] = [];
  let invalid = 0;

  for (const line of lines) {
    const parts = line.split(":");

    if (parts.length !== 4) {
      invalid++;
      continue;
    }

    const [email, password, profile, pin] = parts;

    accounts.push({
      email,
      password,
      profile,
      pin,
    });
  }

  return { accounts, invalid, lines };
}

async function insertAccounts(productId: string, accounts: StockAccount[]) {
  let insertedNew = 0;
  let insertedExpired = 0;
  let skippedAvailable = 0;
  let skippedActive = 0;

  for (const account of accounts) {
    const { data } = await supabase.rpc("insert_product_stock", {
      p_product_id: productId,
      p_email: account.email,
      p_password: account.password,
      p_pin: account.pin,
      p_profile: account.profile,
    });

    switch (data) {
      case "INSERTED_NEW":
        insertedNew++;
        break;

      case "INSERTED_EXPIRED":
        insertedExpired++;
        break;

      case "SKIPPED_AVAILABLE":
        skippedAvailable++;
        break;

      case "SKIPPED_ACTIVE":
        skippedActive++;
        break;
    }
  }

  return {
    insertedNew,
    insertedExpired,
    skippedAvailable,
    skippedActive,
  };
}

export async function handleStockMenu(ctx: BotContext): Promise<Response> {
  const { chatId } = ctx;

  await send(
    chatId,
    "📦 <b>STOCK MANAGEMENT</b>\n\nPilih menu yang tersedia.",
    {
      inline_keyboard: [
        [
          {
            text: "🟡 Upload Stock",
            callback_data: "upload_stock",
          },
        ],
        [
          {
            text: "🟡 Stock Summary",
            callback_data: "stock_summary",
          },
        ],
      ],
    }
  );

  return ok();
}

export async function handleUploadStock(ctx: BotContext): Promise<Response> {
  return await handleUploadStockPage(ctx, "upload_stock_page_1");
}

export async function handleUploadStockPage(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId } = ctx;

  const page = Number(data.replace("upload_stock_page_", "")) || 1;

  const { data: products } = await supabase
    .from("products")
    .select("id,name")
    .order("name");

  const allProducts = products || [];

  const totalPages = Math.max(
    1,
    Math.ceil(allProducts.length / ITEMS_PER_PAGE)
  );

  const start = (page - 1) * ITEMS_PER_PAGE;
  const pageProducts = allProducts.slice(start, start + ITEMS_PER_PAGE);

  const keyboard: any[] = pageProducts.map((p: any) => [
    {
      text: p.name.toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()),
      callback_data: `upload_product_${p.id}`,
    },
  ]);

  const navRow: any[] = [];

  if (page > 1) {
    navRow.push({
      text: "🔴 Prev",
      callback_data: `upload_stock_page_${page - 1}`,
    });
  }

  if (page < totalPages) {
    navRow.push({
      text: "➡️ Next",
      callback_data: `upload_stock_page_${page + 1}`,
    });
  }

  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([
    {
      text: "🟢 Home",
      callback_data: "start",
    },
  ]);

  await send(
    chatId,
    `📤 <b>UPLOAD STOCK</b>\n\nPilih produk:\n\nHalaman ${page}/${totalPages}`,
    {
      inline_keyboard: keyboard,
    }
  );

  return ok();
}

export async function handleSelectUploadProduct(
  ctx: BotContext,
  data: string
): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const productId = data.replace("upload_product_", "");

  await supabase.from("upload_sessions").upsert({
    telegram_id: telegramId,
    product_id: productId,
  });

  const { data: product } = await supabase
    .from("products")
    .select("name")
    .eq("id", productId)
    .single();

  await send(
    chatId,
    `📤 <b>UPLOAD STOCK</b>\n\nProduk:\n<b>${
      product?.name || "-"
    }</b>\n\nSilakan kirim file TXT sekarang.\n\nFormat:\n\n<code>\nemail1@gmail.com:password1:Profile1:1234\nemail2@gmail.com:password2:Profile2:1234\nemail3@gmail.com:password3:Profile3:1234\n</code>`
  );

  return ok();
}

export async function handleUploadStockFile(
  ctx: BotContext
): Promise<Response> {
  const { chatId, telegramId } = ctx;

  const { data: session } = await supabase
    .from("upload_sessions")
    .select("product_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!session) {
    await send(chatId, "❌ Session upload tidak ditemukan");
    return ok();
  }
  const loadingMsg = await send(
    chatId,
    "⏳ <b>UPLOAD PROGRESS</b>\n\nUPLOAD PROGRESS..."
  );

  const fileId = ctx.document?.file_id;

  if (!fileId) {
    await send(chatId, "❌ File ID tidak ditemukan");
    return ok();
  }

  const fileInfo = await getTelegramFile(fileId);
  const filePath = fileInfo?.result?.file_path;

  if (!filePath) {
    await send(chatId, "❌ File path tidak ditemukan");
    return ok();
  }

  const content = await downloadTelegramFile(filePath);

  const { accounts, invalid, lines } = parseStockFile(content);

  const { insertedNew, insertedExpired, skippedAvailable, skippedActive } =
    await insertAccounts(session.product_id, accounts);

  await supabase
    .from("upload_sessions")
    .delete()
    .eq("telegram_id", telegramId);

  await editMessage(
    chatId,
    loadingMsg.message_id,
    `<b>📦 STOCK MANAGEMENT</b>

✅ Upload Stock Berhasil

📄 Total Data    [${lines.length}]
✅ Valid         [${accounts.length}]
❌ Invalid       [${invalid}]

📊 HASIL UPLOAD
━━━━━━━━━━━━━━━━━━
🆕 Insert Baru    [${insertedNew}]
♻️ Reuse Expired  [${insertedExpired}]
⏭️ Skip Available [${skippedAvailable}]
🔒 Skip Active    [${skippedActive}]

📈 SUMMARY
━━━━━━━━━━━━━━━━━━
📥 Berhasil Masuk  [${insertedNew + insertedExpired}]
🚫 Ditolak         [${skippedAvailable + skippedActive}]

━━━━━━━━━━━━━━━━━━
🎉 Upload Done`
  );

  return ok();
}
