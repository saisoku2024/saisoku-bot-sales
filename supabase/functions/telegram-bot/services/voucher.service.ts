import { supabase } from "../supabase.ts";
import { send, sendLongMessage } from "../telegram.ts";
import {
  normalizeVoucherCode,
  rupiah,
  escapeHtml,
} from "../helper.ts";

// ===============================
// CLAIM VOUCHER
// ===============================
export async function claimVoucherByCode(
  chatId: number,
  telegramId: number,
  codeRaw: string
) {
  const code = normalizeVoucherCode(codeRaw);

  if (!code) {
    await send(chatId, "❌ Kode voucher tidak valid.");
    return;
  }

  const { data, error } = await supabase.rpc("claim_voucher_by_code", {
    p_telegram_id: telegramId,
    p_code: code,
  });

  if (error) {
    console.error("claimVoucherByCode RPC error:", error);
    await send(chatId, "❌ Gagal memproses klaim voucher.");
    return;
  }

  const result = data?.[0];

  if (!result?.success) {
    await send(chatId, `❌ ${result?.message || "Klaim voucher gagal."}`);
    return;
  }

  await send(
    chatId,
    `✅ <b>VOUCHER BERHASIL</b>

└ Kode : <code>${escapeHtml(code)}</code>
└ Bonus : ${rupiah(Number(result.reward_amount || 0))}
└ Saldo : ${rupiah(Number(result.new_balance || 0))}`
  );
}

// ===============================
// LIST VOUCHER
// ===============================
export async function handleVoucherList(chatId: number) {
  const { data: vouchers } = await supabase
    .from("vouchers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!vouchers || vouchers.length === 0) {
    await send(chatId, "📭 Belum ada voucher.");
    return;
  }

  let text = "🎟 <b>DAFTAR VOUCHER</b>\n";

  vouchers.forEach((v, i) => {
    text += `

${i + 1}. <code>${v.code}</code>
└ Nominal : ${rupiah(Number(v.reward_amount || 0))}
└ Kuota : ${v.used_count}/${v.quota}
└ Status : ${v.is_active ? "aktif" : "nonaktif"}`;
  });

  await sendLongMessage(chatId, text);
}