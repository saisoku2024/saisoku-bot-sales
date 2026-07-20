import { ENV } from "../../env.ts";
import { supabase } from "../../supabase.ts";
import { send, sendPhoto } from "../../telegram.ts";
import { rupiah, escapeHtml } from "../../helper.ts";
import type { BotContext } from "../../context.ts";

function ok() {
  return new Response("ok");
}

async function renderStartMenu(ctx: BotContext): Promise<Response> {
  const { chatId, telegramId, username, user, message } = ctx;
  const START_IMAGE_URL = ENV.START_IMAGE_URL;

  const { data: dashboardRows, error: dashboardError } = await supabase.rpc(
    "get_user_dashboard_summary",
    {
      p_telegram_id: telegramId,
    }
  );

  if (dashboardError) {
    console.error("START dashboardError:", dashboardError);
  }

  const dashboard = dashboardRows?.[0];
  const currentUser = dashboard || user;

  const fullName =
    [message?.from?.first_name, message?.from?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || (username ? `@${username}` : `User ${telegramId}`);

  const textMessage = `Halo ${escapeHtml(fullName)} 👋
Selamat datang di SAISOKU.ID

<b>User Info</b>
└ ID : <code>${telegramId}</code>
└ Username : ${username ? `@${escapeHtml(username)}` : "-"}
└ Role : <b>${escapeHtml(currentUser.role || "reguler")}</b>
└ Saldo : ${rupiah(Number(currentUser.balance || 0))}
└ Total Beli : ${Number(dashboard?.total_buy || 0)} pcs
└ Total Transaksi : ${rupiah(Number(dashboard?.total_spent || 0))}

<b>Bot Info</b>
└ Terjual : ${Number(dashboard?.total_terjual || 0)} pcs
└ Total Transaksi : ${rupiah(Number(dashboard?.total_revenue || 0))}
└ Total Pengguna : ${Number(dashboard?.total_users || 0)}`;

  const role = String(currentUser.role || user.role || "reguler").toLowerCase();
  const keyboardRows = [
  [
    { text: "🛒 List Produk", callback_data: "list_produk" },
    { text: "💰 Saldo", callback_data: "saldo" },
  ],
  [
    { text: "🎮 Mini Games", callback_data: "daily_absen" },
    { text: "🔵 Menu Lain", callback_data: "menu_lain" },
  ],
];

if (role === "reguler" || role === "regular" || role === "reseller") {
  keyboardRows.unshift([
    { text: "🟠 Promo Aktif", callback_data: "promo_aktif" },
  ]);
}

if (
  role === "admin" ||
  role === "owner"
) {
  keyboardRows.push([
    {
      text: "🟡 Stock",
      callback_data: "stock_menu",
    },
  ]);
}

const keyboard = {
  inline_keyboard: keyboardRows,
};

  try {
    await sendPhoto(chatId, START_IMAGE_URL, textMessage, keyboard);
  } catch (err) {
    console.error("START sendPhoto error:", err);
    await send(chatId, textMessage, keyboard);
  }

  return ok();
}

export async function handleStartCommand(
  ctx: BotContext,
): Promise<Response> {
  return renderStartMenu(ctx);
}

export async function handleStartCallback(
  ctx: BotContext,
): Promise<Response> {
  return renderStartMenu(ctx);
}

