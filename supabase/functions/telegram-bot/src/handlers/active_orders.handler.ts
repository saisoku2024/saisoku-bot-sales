import { supabase } from "../../supabase.ts";
import { send, editMessage, sendDocument } from "../../telegram.ts";
import { escapeHtml, rupiah } from "../../helper.ts";
import type { BotContext } from "../../context.ts";

function ok() {
  return new Response("ok");
}

function parseYMDToUTC(dateStr: string) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0));
}

function daysBetweenInclusive(a: string, b: string) {
  const d1 = parseYMDToUTC(a), d2 = parseYMDToUTC(b);
  if (!d1 || !d2) return 0;
  const diff = (d2.getTime() - d1.getTime()) / 86400000;
  return Math.floor(diff) + 1;
}

function formatWIB(date: Date): string {
  const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wibDate.getUTCFullYear();
  const mm = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wibDate.getUTCDate()).padStart(2, "0");
  const hh = String(wibDate.getUTCHours()).padStart(2, "0");
  const min = String(wibDate.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} WIB`;
}

function formatTicketDateDisplay(date: Date): string {
  const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const dd = String(wibDate.getUTCDate()).padStart(2, "0");
  const mm = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = wibDate.getUTCFullYear();
  const hh = String(wibDate.getUTCHours()).padStart(2, "0");
  const min = String(wibDate.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function buildTicketNotificationText(params: {
  ticketCode: string;
  orderId: string;
  createdAt: Date;
  userMessage: string;
  adminResponse?: string;
  footer: string;
}): string {
  const response = params.adminResponse || "(Menunggu balasan admin...)";

  return `<b>[ TICKET NOTIFICATION ]</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ <b>TICKET ID</b>    : <code>${escapeHtml(params.ticketCode)}</code>
▶ <b>ORDER ID</b>     : <code>${escapeHtml(params.orderId)}</code>
▶ <b>STATUS</b>       : ⏳ [ OPEN ]

<b>LOG AKTIVITAS</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[+] Dibuat     : ${formatTicketDateDisplay(params.createdAt)}
[-] Selesai    : PENDING

<b>PESAN DARI USER</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
&quot;${escapeHtml(params.userMessage)}&quot;
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>RESPON ADMIN</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${escapeHtml(response)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<i>${escapeHtml(params.footer)}</i>`;
}

function formatDateYMD(date: Date): string {
  const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wibDate.getUTCFullYear();
  const mm = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wibDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getFriendlyShortId(t: any): string {
  if (!t) return "#ORDER";
  
  let idOrTrxCode = "";
  if (typeof t === "string") {
    idOrTrxCode = t;
  } else {
    idOrTrxCode = t.invoice || t.trx_code || t.id || "";
  }
  
  let shortCode = idOrTrxCode;
  if (shortCode.includes("-")) {
    const parts = shortCode.split("-");
    if (parts[0].length === 8) {
      shortCode = parts[0];
    } else {
      shortCode = parts[parts.length - 1];
    }
  }
  if (shortCode.length > 8) {
    shortCode = shortCode.slice(0, 8);
  }
  return `#${shortCode.toUpperCase()}`;
}

function getOrderTime(t: any): number {
  return new Date(getTransactionSoldAt(t) || t.purchased_at || t.created_at || 0).getTime();
}

function sortNewestFirst(list: any[]) {
  return list.sort((a: any, b: any) => getOrderTime(b) - getOrderTime(a));
}

function getRefundDurationDays(): number {
  return 30;
}

function getSoldAccount(t: any): any {
  if (!t?.sold_accounts) return null;
  return Array.isArray(t.sold_accounts) ? (t.sold_accounts[0] ?? null) : t.sold_accounts;
}

function getTransactionAccount(t: any): any {
  const snapshot = getSoldAccount(t)?.account_snapshot;
  return snapshot || t?.product_accounts || {};
}

function getTransactionSoldAt(t: any): string | null {
  return getTransactionAccount(t)?.sold_at || t?.product_accounts?.sold_at || null;
}

async function getActiveTransactions(userId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select(`
      id,
      invoice,
      trx_code,
      price,
      purchased_at,
      expired_at,
      status,
      products (name, modal, duration_days),
      product_accounts (email, password, pin, profile, sold_at),
      sold_accounts (account_snapshot, warranty_claim_count)
    `)
    .eq("user_id", userId)
    .eq("status", "paid")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getActiveTransactions error:", error);
    return [];
  }

  const now = new Date();
  const rows = (data || []) as any[];
  const activeList = rows.filter((t: any) => {
    const baseDateStr = getTransactionSoldAt(t) || t.purchased_at || t.created_at;
    if (!baseDateStr) return false;
    const baseDate = new Date(baseDateStr);
    const durationDays = Number(t.products?.duration_days || 30);
    const calculatedExpiry = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const actualExpiry = t.expired_at ? new Date(t.expired_at) : calculatedExpiry;
    t.calculated_expired_at = actualExpiry;
    return actualExpiry > now;
  });

  return sortNewestFirst(activeList);
}

export async function handleActiveOrdersList(ctx: BotContext, data = "active_orders"): Promise<Response> {
  const { chatId, user } = ctx;

  const list = await getActiveTransactions(user.id);

  if (list.length === 0) {
    await send(chatId, "📂 Anda tidak memiliki order aktif saat ini.");
    return ok();
  }

  sortNewestFirst(list);

  let page = 1;
  if (data.startsWith("active_orders_page_")) {
    page = parseInt(data.replace("active_orders_page_", ""), 10) || 1;
  }

  const itemsPerPage = 10;
  const totalPages = Math.ceil(list.length / itemsPerPage);
  page = Math.min(Math.max(1, page), totalPages);

  const startIndex = (page - 1) * itemsPerPage;
  const pageList = list.slice(startIndex, startIndex + itemsPerPage);

  let text = `🛒 <b>ORDER AKTIF SAYA (${list.length})</b> - Halaman ${page}/${totalPages}\n\n`;
  const inlineKeyboard: any[] = [];

  pageList.forEach((t: any, idx: number) => {
    const account = getTransactionAccount(t);
    const profileName = account?.profile || "-";
    const shortId = getFriendlyShortId(t);
    const expiredStr = t.calculated_expired_at ? formatWIB(t.calculated_expired_at) : "-";
    const globalIdx = startIndex + idx + 1;

    text += `${globalIdx}. 👑 ⏳ <b>${escapeHtml(profileName)}</b> — exp ${expiredStr} — ${shortId}\n`;

    inlineKeyboard.push([
      {
        text: `🛡 ${shortId}`,
        callback_data: `view_order_detail_${t.id}`,
      },
      {
        text: "🔐 Garansi",
        callback_data: `claim_warranty_menu_${t.id}`,
      },
    ]);
  });

  if (totalPages > 1) {
    const navRow: any[] = [];
    if (page > 1) {
      navRow.push({ text: "◀️ Prev", callback_data: `active_orders_page_${page - 1}` });
    }
    navRow.push({ text: `${page}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages) {
      navRow.push({ text: "Next ▶️", callback_data: `active_orders_page_${page + 1}` });
    }
    inlineKeyboard.push(navRow);
  }

  inlineKeyboard.push([
    { text: "🔍 Cari Order ID", callback_data: "search_order_start" },
    { text: "📄 Rekap TXT", callback_data: "rekap_txt" },
  ]);
  inlineKeyboard.push([
    { text: "🔴 Kembali", callback_data: "menu_lain" },
  ]);

  if (ctx.callback) {
    const { editMessage } = await import("../../telegram.ts");
    await editMessage(chatId, ctx.msg.message_id, text, { inline_keyboard: inlineKeyboard });
  } else {
    await send(chatId, text, { inline_keyboard: inlineKeyboard });
  }
  return ok();
}

export async function handleExportRekapTxt(ctx: BotContext): Promise<Response> {
  const { chatId, user } = ctx;

  const list = await getActiveTransactions(user.id);

  if (list.length === 0) {
    await send(chatId, "📂 Tidak ada order aktif untuk diekspor.");
    return ok();
  }

  sortNewestFirst(list);

  const now = new Date();
  const ts = now.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });

  let txtContent = `REKAP ORDER AKTIF - SAISOKU.ID\n`;
  txtContent += `Tanggal: ${ts}\n`;
  txtContent += `Total Order: ${list.length}\n`;
  txtContent += `=======================================\n\n`;

  list.forEach((t: any, idx: number) => {
    const shortId = getFriendlyShortId(t);
    const prodName = t.products?.name || "-";
    const account = getTransactionAccount(t);
    const email = account?.email || "-";
    const profile = account?.profile || "-";
    const expiredStr = t.calculated_expired_at ? formatWIB(t.calculated_expired_at) : "-";
    const claimCount = t.sold_accounts?.[0]?.warranty_claim_count ?? 0;

    txtContent += `${idx + 1}. ID Order : ${shortId}\n`;
    txtContent += `   Paket    : ${prodName}\n`;
    txtContent += `   Email    : ${email}\n`;
    txtContent += `   Profil   : ${profile}\n`;
    txtContent += `   Expired  : ${expiredStr}\n`;
    txtContent += `   Status   : Permen (Aktif)\n`;
    txtContent += `   Garansi  : Claim ${claimCount} kali\n`;
    txtContent += `---------------------------------------\n`;
  });

  try {
    const filename = `rekap_order_${user.id.slice(0, 8)}_${Date.now()}.txt`;
    await sendDocument(chatId, txtContent, filename, "📄 Rekap Order Aktif Anda");
  } catch (err) {
    console.error("handleExportRekapTxt error:", err);
    await send(chatId, "❌ Gagal mengirimkan dokumen rekap.");
  }

  return ok();
}

export async function handleViewOrderDetail(ctx: BotContext, data: string): Promise<Response> {
  const { chatId } = ctx;
  const trxId = data.replace("view_order_detail_", "").trim();

  const { data: t, error }: { data: any; error: any } = await supabase
    .from("transactions")
    .select(`
      id,
      invoice,
      trx_code,
      price,
      purchased_at,
      created_at,
      expired_at,
      status,
      products (name, duration_days),
      product_accounts (email, password, pin, profile, sold_at),
      sold_accounts (account_snapshot)
    `)
    .eq("id", trxId)
    .single();

  if (error || !t) {
    await send(chatId, "❌ Detail transaksi tidak ditemukan.");
    return ok();
  }

  const account = getTransactionAccount(t);
  const baseDateStr = getTransactionSoldAt(t) || t.purchased_at || t.created_at;
  const baseDate = baseDateStr ? new Date(baseDateStr) : new Date();
  const durDays = Number(t.products?.duration_days || 30);
  const calculatedExpiry = new Date(baseDate.getTime() + durDays * 24 * 60 * 60 * 1000);
  const actualExpiry = t.expired_at ? new Date(t.expired_at) : calculatedExpiry;

  const shortId = getFriendlyShortId(t);
  const detailText = `🧾 <b>DETAIL ORDER ${shortId}</b>
  
└ Produk : <b>${escapeHtml(t.products?.name || "Produk")}</b>
└ Email : <code>${escapeHtml(account?.email || "-")}</code>
└ Password : <code>${escapeHtml(account?.password || "-")}</code>
└ PIN : <code>${escapeHtml(account?.pin || "-")}</code>
└ Profile : <b>${escapeHtml(account?.profile || "-")}</b>
└ Tanggal Beli : ${baseDateStr ? formatWIB(new Date(baseDateStr)) : "-"}
└ Tanggal Expired : <b>${formatWIB(actualExpiry)}</b>
└ Status : <b>${escapeHtml(t.status || "-").toUpperCase()}</b>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔴 Kembali ke List", callback_data: "active_orders" }],
    ],
  };

  await send(chatId, detailText, keyboard);
  return ok();
}

export async function handleClaimWarrantyMenu(ctx: BotContext, data: string): Promise<Response> {
  const { chatId } = ctx;
  const trxId = data.replace("claim_warranty_menu_", "").trim();

  // Fetch warranty claim count
  const { data: sa } = await supabase
    .from("sold_accounts")
    .select("warranty_claim_count")
    .eq("transaction_id", trxId)
    .single();

  const claimCount = sa?.warranty_claim_count ?? 0;

  const text = `🔐 <b>KLAIM GARANSI</b>

Jumlah Klaim Sebelumnya: <b>${claimCount} kali</b>

Apakah Anda ingin melakukan klaim garansi untuk order ini? Admin akan meninjau dan mengganti akun/melakukan perbaikan jika diperlukan.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "✅ Ajukan Klaim", callback_data: `apply_warranty_claim_${trxId}` }],
      [{ text: "🔴 Batal", callback_data: "active_orders" }],
    ],
  };

  await send(chatId, text, keyboard);
  return ok();
}

export async function handleApplyWarrantyClaim(ctx: BotContext, data: string): Promise<Response> {
  const { chatId, telegramId } = ctx;
  const trxId = data.replace("apply_warranty_claim_", "").trim();

  // Reset any old session
  await supabase.from("warranty_sessions").delete().eq("telegram_id", telegramId);

  // Insert a new warranty session awaiting photo
  await supabase.from("warranty_sessions").insert({
    telegram_id: telegramId,
    transaction_id: trxId,
    step: "awaiting_photo",
  });

  const text = `📸 <b>KLAIM GARANSI - FOTO KENDALA</b>

Silakan kirimkan foto/screenshot bukti kendala pada akun Anda secara langsung di chat ini.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔴 Batalkan Sesi", callback_data: "cancel_warranty_session" }],
    ],
  };

  await send(chatId, text, keyboard);
  return ok();
}

export async function handleCancelWarrantySession(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, msg } = ctx;

  await supabase.from("warranty_sessions").delete().eq("telegram_id", telegramId);
  await editMessage(chatId, msg.message_id, "❌ Pembuatan klaim garansi dibatalkan.");
  return ok();
}

export async function handleWarrantyPhotoInput(ctx: BotContext, session: any): Promise<Response> {
  const { chatId, telegramId, message, document } = ctx;

  let fileId = "";
  if (message?.photo && message.photo.length > 0) {
    const highestRes = message.photo[message.photo.length - 1];
    fileId = highestRes.file_id;
  } else if (document && (document.mime_type?.startsWith("image/") || document.file_name?.match(/\.(jpg|jpeg|png|webp)$/i))) {
    fileId = document.file_id;
  }

  if (!fileId) {
    await send(chatId, "❌ Bukti kendala harus berupa foto/screenshot kendala. Silakan kirimkan kembali foto screenshot kendala akun Anda.");
    return ok();
  }

  // Save file ID and advance step
  await supabase
    .from("warranty_sessions")
    .update({
      photo_file_id: fileId,
      step: "awaiting_description",
    })
    .eq("telegram_id", telegramId);

  const text = `📝 <b>KLAIM GARANSI - KETERANGAN KENDALA</b>

Foto kendala berhasil diterima!
Silakan ketikkan deskripsi/keterangan kendala akun Anda secara langsung di chat ini.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔴 Batalkan Sesi", callback_data: "cancel_warranty_session" }],
    ],
  };

  await send(chatId, text, keyboard);
  return ok();
}

export async function handleWarrantyDescriptionInput(ctx: BotContext, session: any): Promise<Response> {
  const { chatId, telegramId, normalizedText, user } = ctx;

  if (!normalizedText || normalizedText.trim().length === 0) {
    await send(chatId, "❌ Keterangan kendala tidak boleh kosong. Silakan ketikkan keterangan kendala Anda.");
    return ok();
  }

  const description = normalizedText.trim();
  const trxId = session.transaction_id;
  const photoFileId = session.photo_file_id;

  // Clean up session
  await supabase.from("warranty_sessions").delete().eq("telegram_id", telegramId);

  // Fetch transaction details
  const { data: t }: { data: any } = await supabase
    .from("transactions")
    .select(`
      id,
      invoice,
      trx_code,
      created_at,
      products (name),
      product_accounts (email, profile),
      sold_accounts (account_snapshot)
    `)
    .eq("id", trxId)
    .single();

  const shortId = getFriendlyShortId(t);
  const prodName = t?.products?.name || "Produk";

  // Create Support Ticket
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      user_id: user.id,
      telegram_id: telegramId,
      transaction_id: trxId,
      status: "open",
    })
    .select()
    .single();

  if (ticketError || !ticket) {
    console.error("WARRANTY TICKET CREATION ERROR:", ticketError);
    await send(chatId, "❌ Gagal memproses klaim garansi. Silakan coba kembali.");
    return ok();
  }

  const replyMessage = `[Screenshot Kendala: Telegram File ID = ${photoFileId}]\n\nKeterangan Kendala:\n${description}`;

  const { error: replyError } = await supabase
    .from("ticket_replies")
    .insert({
      ticket_id: ticket.id,
      sender_type: "user",
      message: replyMessage,
    });

  if (replyError) {
    console.error("WARRANTY TICKET REPLY ERROR:", replyError);
  }

  // Increment warranty claim count
  const { data: sa } = await supabase
    .from("sold_accounts")
    .select("id, warranty_claim_count")
    .eq("transaction_id", trxId)
    .single();

  if (sa) {
    await supabase
      .from("sold_accounts")
      .update({
        warranty_claim_count: (sa.warranty_claim_count || 0) + 1,
        warranty_last_claim_at: new Date().toISOString(),
      })
      .eq("id", sa.id);
  }

  // Custom Ticket ID format: #<ID> - [SID<YYYYMMDD>-<ShortOrder>-<PaddedSerial>]
  const date = ticket.created_at ? new Date(ticket.created_at) : new Date();
  const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const yyyy = wibDate.getUTCFullYear();
  const mm = String(wibDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wibDate.getUTCDate()).padStart(2, "0");
  
  const rawTrxId = t?.invoice || t?.trx_code || t?.id || "";
  let orderHash = rawTrxId.includes("-") ? rawTrxId.split("-")[0] : rawTrxId;
  if (orderHash.startsWith("SALDO-")) orderHash = orderHash.replace("SALDO-", "");
  if (orderHash.startsWith("ORDER-")) orderHash = orderHash.replace("ORDER-", "");
  if (orderHash.length > 8) orderHash = orderHash.slice(0, 8);
  orderHash = orderHash.toUpperCase();

  const paddedSerial = String(ticket.id).padStart(6, "0");
  const customTicketCode = `SID${yyyy}${mm}${dd}-${orderHash}-${paddedSerial}`;

  // Notify admins
  const username = user.username ? `@${escapeHtml(user.username)}` : `User ${telegramId}`;
  const adminText = `⚠️ <b>KLAIM GARANSI BARU</b>

Aktor: ${username}
ID Telegram: <code>${telegramId}</code>

└ Tiket ID : <b>#${ticket.id} - [${customTicketCode}]</b>
└ Order ID : <code>${shortId}</code>
└ Produk : <b>${escapeHtml(prodName)}</b>
└ Total Klaim : <b>${(sa?.warranty_claim_count ?? 0) + 1}x</b>
└ Keterangan : <i>${escapeHtml(description)}</i>

Silakan tindak lanjuti melalui panel admin.`;

  const { notifyAdminsOrOwners } = await import("../../services/order/order.helper.ts");
  await notifyAdminsOrOwners(adminText);

  const userSuccessText = buildTicketNotificationText({
    ticketCode: customTicketCode,
    orderId: shortId.replace(/^#/, ""),
    createdAt: date,
    userMessage: description,
    footer: "Admin telah dinotifikasi. Harap tunggu balasan selanjutnya.",
  });

  await send(chatId, userSuccessText);
  return ok();
}

function getRemainingDays(t: any): number {
  const baseDateStr = getTransactionSoldAt(t) || t.purchased_at || t.created_at;
  if (!baseDateStr) return 0;
  const baseDate = new Date(baseDateStr);
  const durDays = getRefundDurationDays();

  const startStr = formatDateYMD(baseDate);
  const nowStr = formatDateYMD(new Date());

  const dur = durDays;
  let used = daysBetweenInclusive(startStr, nowStr);
  used = Math.min(Math.max(0, used), dur);
  return Math.max(0, dur - used);
}

// ===================================
// REFUND CALCULATOR IN BOT
// ===================================

export async function handleRefundCalculatorStart(ctx: BotContext, data = "calc_refund"): Promise<Response> {
  const { chatId, user } = ctx;

  const list = await getActiveTransactions(user.id);
  const activeOnlyList = list.filter((t: any) => getRemainingDays(t) > 0);

  if (activeOnlyList.length === 0) {
    await send(chatId, "🧮 <b>Refund Calculator</b>\n\nAnda tidak memiliki order aktif dengan sisa hari untuk dihitung refund.");
    return ok();
  }

  sortNewestFirst(activeOnlyList);

  let page = 1;
  if (data.startsWith("calc_refund_page_")) {
    page = parseInt(data.replace("calc_refund_page_", ""), 10) || 1;
  }

  const itemsPerPage = 10;
  const totalPages = Math.ceil(activeOnlyList.length / itemsPerPage);
  page = Math.min(Math.max(1, page), totalPages);

  const startIndex = (page - 1) * itemsPerPage;
  const pageList = activeOnlyList.slice(startIndex, startIndex + itemsPerPage);

  let text = `🧮 <b>REFUND CALCULATOR (SAISOKU.ID)</b> - Halaman ${page}/${totalPages}\n\nPilih order yang ingin Anda kalkulasikan estimasi refund-nya:`;
  const inlineKeyboard: any[] = [];

  pageList.forEach((t: any) => {
    const shortId = getFriendlyShortId(t);
    inlineKeyboard.push([
      {
        text: `🧮 ${shortId}`,
        callback_data: `calc_refund_select_${t.id}`,
      },
    ]);
  });

  if (totalPages > 1) {
    const navRow: any[] = [];
    if (page > 1) {
      navRow.push({ text: "◀️ Prev", callback_data: `calc_refund_page_${page - 1}` });
    }
    navRow.push({ text: `${page}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages) {
      navRow.push({ text: "Next ▶️", callback_data: `calc_refund_page_${page + 1}` });
    }
    inlineKeyboard.push(navRow);
  }

  inlineKeyboard.push([
    { text: "🔴 Kembali", callback_data: "menu_lain" },
  ]);

  if (ctx.callback) {
    const { editMessage } = await import("../../telegram.ts");
    await editMessage(chatId, ctx.msg.message_id, text, { inline_keyboard: inlineKeyboard });
  } else {
    await send(chatId, text, { inline_keyboard: inlineKeyboard });
  }
  return ok();
}

export async function handleRefundCalculatorSelectOrder(ctx: BotContext, data: string): Promise<Response> {
  const { chatId } = ctx;
  const trxId = data.replace("calc_refund_select_", "").trim();

  const text = `🧩 <b>PILIH STATUS KLAIM</b>

Pilih berapa kali akun ini telah diklaim garansinya atau status klaim saat ini untuk menentukan koefisien refund:`;

  const inlineKeyboard = [
    [
      { text: "Belum Pernah Klaim < 7 Hari (0.90)", callback_data: `calc_refund_coef_${trxId}_0.90` },
    ],
    [
      { text: "Belum Pernah Klaim > 7 Hari (0.85)", callback_data: `calc_refund_coef_${trxId}_0.85` },
    ],
    [
      { text: "Klaim 1x (0.80)", callback_data: `calc_refund_coef_${trxId}_0.80` },
    ],
    [
      { text: "Klaim 2x (0.75)", callback_data: `calc_refund_coef_${trxId}_0.75` },
    ],
    [
      { text: "Klaim 3x (0.70)", callback_data: `calc_refund_coef_${trxId}_0.70` },
    ],
    [
      { text: "🔴 Batal", callback_data: "calc_refund" },
    ],
  ];

  await send(chatId, text, { inline_keyboard: inlineKeyboard });
  return ok();
}

export async function handleRefundCalculatorOutput(ctx: BotContext, data: string): Promise<Response> {
  const { chatId } = ctx;

  // format: calc_refund_coef_<trxId>_<coef>
  const parts = data.replace("calc_refund_coef_", "").split("_");
  const trxId = parts[0];
  const coef = parseFloat(parts[1] || "1");

  const { data: t, error }: { data: any; error: any } = await supabase
    .from("transactions")
    .select(`
      id,
      invoice,
      trx_code,
      price,
      purchased_at,
      created_at,
      expired_at,
      products (name, duration_days),
      product_accounts (email, profile, sold_at),
      sold_accounts (account_snapshot),
      users (whatsapp, role, username)
    `)
    .eq("id", trxId)
    .single();

  if (error || !t) {
    await send(chatId, "❌ Transaksi tidak ditemukan.");
    return ok();
  }

  const price = Number(t.price || 0);
  const account = getTransactionAccount(t);
  const baseDateStr = getTransactionSoldAt(t) || t.purchased_at || t.created_at;
  const baseDate = baseDateStr ? new Date(baseDateStr) : new Date();
  
  const durDays = getRefundDurationDays();
  const calculatedExpiry = new Date(baseDate.getTime() + durDays * 24 * 60 * 60 * 1000);
  const expiryDate = t.expired_at ? new Date(t.expired_at) : calculatedExpiry;

  const startStr = formatDateYMD(baseDate);
  const expiryStr = formatDateYMD(expiryDate);
  const nowStr = formatDateYMD(new Date());

  if (!startStr || !expiryStr) {
    await send(chatId, "❌ Data tanggal transaksi tidak lengkap untuk menghitung refund.");
    return ok();
  }

  const dur = getRefundDurationDays();
  let used = daysBetweenInclusive(startStr, nowStr);
  used = Math.min(Math.max(0, used), dur);
  const left = Math.max(0, dur - used);

  const roundTo = (x: number, step = 1) => (step <= 1 ? Math.round(x) : Math.round(x / step) * step);

  const gross = roundTo(Math.max(0, (left / dur) * price), 1000);
  const net = roundTo(gross * coef, 1);

  const shortId = getFriendlyShortId(t);
  
  // PII masking helpers
  const maskPhoneStrict = (phone: string) => {
    const s = String(phone).replace(/\D/g,'');
    if (!s) return '-';
    if (s.length <= 8) {
      const head = s.slice(0, Math.min(2, s.length));
      const tail = s.slice(-2);
      return head + 'xxxx' + tail;
    }
    return s.slice(0,4) + 'xxxx' + s.slice(-4);
  };

  const maskEmail = (e: string) => {
    const m = String(e).split("@");
    if (m.length !== 2) return e || '-';
    const user = m[0], dom = m[1];
    const vis = user.slice(0, Math.min(2, user.length));
    return `${vis}${"*".repeat(Math.max(1, user.length - vis.length))}@${dom}`;
  };

  const formatStrukWIB = (date: Date): string => {
    const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    const dd = wibDate.getUTCDate();
    const month = months[wibDate.getUTCMonth()];
    const yyyy = wibDate.getUTCFullYear();
    const hh = String(wibDate.getUTCHours()).padStart(2, "0");
    const min = String(wibDate.getUTCMinutes()).padStart(2, "0");
    return `${dd} ${month} ${yyyy}, ${hh}.${min}`;
  };

  let buyerPhone = "-";
  const buyerPhoneRaw = t.users?.whatsapp || ctx.user?.whatsapp || ctx.user?.phone || "-";
  if (buyerPhoneRaw !== "-") {
    buyerPhone = maskPhoneStrict(buyerPhoneRaw);
  } else {
    const uname = t.users?.username || ctx.user?.username || "";
    buyerPhone = uname ? `@${uname}` : "-";
  }
  
  const rawRole = t.users?.role || ctx.user?.role || "reguler";
  const tipe = rawRole.charAt(0).toUpperCase() + rawRole.slice(1);
  const prodName = t.products?.name || "Produk";
  const emailMasked = account?.email ? maskEmail(account.email) : "-";
  
  const statusLabel =
    coef === 0.90 ? "Belum Klaim < 7 Hari (0.90)" :
    coef === 0.85 ? "Belum Klaim > 7 Hari (0.85)" :
    coef === 0.80 ? "Klaim 1x (0.80)" :
    coef === 0.75 ? "Klaim 2x (0.75)" :
    coef === 0.70 ? "Klaim 3x (0.70)" : "Custom";

  const now = new Date();
  const tsStr = formatStrukWIB(now);

  const resultText = `🧾 <b>STRUK REFUND SAISOKU.ID</b>
──────────
📱 Buyer     : ${buyerPhone}
👤 Tipe      : ${tipe}
🎬 Produk    : ${escapeHtml(prodName)}
🔑 Akun      : ${escapeHtml(emailMasked)}
──────────
📅 Beli/Klaim: ${startStr} → ${nowStr}
⏱️ Durasi    : ${dur} hari
📊 Pemakaian : Terpakai ${used} hari • Sisa ${left} hari
──────────
🏷️ Harga     : ${rupiah(price)}
🧩 Status    : ${statusLabel}
──────────
💎 <b>Refund Bersih: ${rupiah(net)}</b>
──────────

Terima kasih telah menggunakan layanan SAISOKU.ID 🙏


© ${now.getFullYear()} SAISOKU.ID • ${tsStr}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔴 Kembali", callback_data: "calc_refund" }],
    ],
  };

  await send(chatId, resultText, keyboard);
  return ok();
}

// ===================================
// CARI ORDER ID IN BOT
// ===================================

export async function handleSearchOrderStart(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId } = ctx;

  await supabase.from("search_sessions").upsert({
    telegram_id: telegramId,
  });

  const text = `🔍 <b>CARI ORDER ID</b>

Silakan masukkan ID Order / Invoice Anda secara langsung di chat ini.
Contoh: <code>80e1a571</code>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔴 Batalkan", callback_data: "active_orders" }],
    ],
  };

  await send(chatId, text, keyboard);
  return ok();
}

export async function handleSearchOrderInput(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, normalizedText, user } = ctx;

  await supabase.from("search_sessions").delete().eq("telegram_id", telegramId);

  if (!normalizedText || normalizedText.trim().length === 0) {
    await send(chatId, "❌ Pencarian dibatalkan.");
    return ok();
  }

  const query = normalizedText.trim();

  const { data: list, error }: { data: any[] | null; error: any } = await supabase
    .from("transactions")
    .select(`
      id,
      invoice,
      trx_code,
      price,
      purchased_at,
      expired_at,
      status,
      products (name),
      product_accounts (email, password, pin, profile),
      sold_accounts (account_snapshot)
    `)
    .eq("user_id", user.id)
    .or(`invoice.ilike.%${query}%,trx_code.ilike.%${query}%`);

  if (error || !list || list.length === 0) {
    const keyboard = {
      inline_keyboard: [
        [{ text: "🔍 Cari Lagi", callback_data: "search_order_start" }],
        [{ text: "🔴 List Order", callback_data: "active_orders" }],
      ],
    };
    await send(chatId, `❌ Order dengan ID <code>${escapeHtml(query)}</code> tidak ditemukan dalam daftar order aktif Anda.`, keyboard);
    return ok();
  }

  let text = `🔍 <b>HASIL PENCARIAN (${list.length})</b>\n\n`;
  const inlineKeyboard: any[] = [];

  list.forEach((t: any) => {
    const account = getTransactionAccount(t);
    const profileName = account?.profile || "-";
    const shortId = getFriendlyShortId(t);
    const expiredStr = t.expired_at ? formatWIB(new Date(t.expired_at)) : "-";

    text += `• 👑 ⏳ <b>${escapeHtml(profileName)}</b> — exp ${expiredStr} — ${shortId}\n`;

    inlineKeyboard.push([
      {
        text: `🛡 ${shortId}`,
        callback_data: `view_order_detail_${t.id}`,
      },
      {
        text: "🔐 Garansi",
        callback_data: `claim_warranty_menu_${t.id}`,
      },
    ]);
  });

  inlineKeyboard.push([
    { text: "🔍 Cari Baru", callback_data: "search_order_start" },
    { text: "🔴 List Order", callback_data: "active_orders" },
  ]);

  await send(chatId, text, { inline_keyboard: inlineKeyboard });
  return ok();
}
