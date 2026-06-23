import { supabase } from "../../supabase.ts";

import {
  rupiah,
  escapeHtml,
} from "../../helper.ts";

import type { BotContext } from "../../context.ts";

export async function renderUserDashboard(
  ctx: BotContext,
): Promise<string> {
  const { telegramId, username, user } = ctx;

  const { data, error } = await supabase.rpc(
    "get_user_dashboard_summary",
    {
      p_telegram_id: telegramId,
    },
  );

  if (error) {
    console.error("dashboard error:", error);

    return "❌ Gagal mengambil data dashboard";
  }

  const dashboard = data?.[0];
  const currentUser = dashboard || user;

  const { data: loyaltyData } = await supabase.rpc(
  "get_user_loyalty_summary",
  {
    p_telegram_id: telegramId,
  },
);

const loyalty = loyaltyData?.[0];

  return `
👤 <b>PROFIL USER</b>

🆔 ID : <code>${telegramId}</code>
👤 Username : ${username ? `@${escapeHtml(username)}` : "-"}
🎖 Role : <b>${escapeHtml(currentUser.role || "reguler")}</b>

💰 Saldo : ${rupiah(Number(currentUser.balance || 0))}

LOYALTY USER
====================
🏅 Tier Loyalty : ${loyalty?.tier_name || "-"}
🎁 Diskon Loyalty : ${rupiah(Number(loyalty?.discount_amount || 0))}
📈 Order YTD : ${Number(loyalty?.order_count || 0)}
💸 Spending YTD : ${rupiah(Number(dashboard?.total_spent || 0))}

📊 Statistik Sistem
====================
📦 Produk Terjual : ${Number(dashboard?.total_terjual || 0)}
💵 Revenue : ${rupiah(Number(dashboard?.total_revenue || 0))}
👥 Total User : ${Number(dashboard?.total_users || 0)}
`.trim();
}