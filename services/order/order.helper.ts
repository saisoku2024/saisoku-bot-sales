import { ENV } from "../../env.ts";
import { supabase } from "../../supabase.ts";
import { send, sendLongMessage } from "../../telegram.ts";

import {
  escapeHtml,
  formatMultiline,
} from "../../helper.ts";

export function ok() {
  return new Response("ok");
}

export function isAdminOrOwner(role: string) {
  return role === "admin" || role === "owner";
}

export async function getProductDetailForBot(
  productId: string,
  userId: string
) {
  const { data, error } = await supabase.rpc(
    "get_product_detail_for_bot",
    {
      p_product_id: productId,
      p_user_id: userId,
    }
  );

  if (error) {
    console.error("getProductDetailForBot RPC error:", error);
    return null;
  }

  return data?.[0] ?? null;
}

export async function getUserActiveOrder(
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

export async function notifyAdminsOrOwners(
  text: string,
  kb?: any
) {
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
    console.error(
      "notifyAdminsOrOwners query error:",
      error
    );
  }

  for (const row of rows || []) {
    if (row.telegram_id) {
      recipients.add(Number(row.telegram_id));
    }
  }

  for (const recipientId of recipients) {
    try {
      await send(recipientId, text, kb);
    } catch (err) {
      console.error(
        "notifyAdminsOrOwners send error:",
        err
      );
    }
  }
}

export async function sendPurchaseResult(
  chatId: number,
  summaryText: string,
  items: any[],
  productName: string,
  tosDescription?: string | null
) {
  await sendLongMessage(chatId, summaryText);

  for (let i = 0; i < items.length; i++) {
    const itm = items[i];

    const itemText = `<b>[${escapeHtml(
      productName
    )} - Akun ${i + 1}]</b>
└ Email : <code>${escapeHtml(
      itm.email ?? "-"
    )}</code>
└ Password : <code>${escapeHtml(
      itm.password ?? "-"
    )}</code>
└ Profile : ${escapeHtml(itm.profile ?? "-")}
└ PIN : ${escapeHtml(itm.pin ?? "-")}`;

    await sendLongMessage(chatId, itemText);
  }

  const tos = formatMultiline(tosDescription);

  if (tos && tos !== "-") {
    await sendLongMessage(
      chatId,
      `<b>Term of Service</b>\n${escapeHtml(tos)}`
    );
  }
}

export async function getLatestSoldAccountsForUserProduct(
  userId: string,
  productId: string,
  qty: number
) {
  const { data, error } = await supabase
    .from("sold_accounts")
    .select(
      "id, created_at, account_snapshot"
    )
    .eq("user_id", userId)
    .eq("product_id", productId)
    .order("created_at", {
      ascending: false,
    })
    .limit(qty);

  if (error) {
    console.error(
      "getLatestSoldAccountsForUserProduct error:",
      error
    );
    return [];
  }

  return data || [];
}

export async function getSoldAccountsByOrderId(
  orderId: string
) {
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
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error(
      "getSoldAccountsByOrderId error:",
      error
    );
    return [];
  }

  return data || [];
}