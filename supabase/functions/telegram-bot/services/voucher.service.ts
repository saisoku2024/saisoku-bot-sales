import { supabase } from "../supabase.ts";
import { send, sendLongMessage } from "../telegram.ts";
import {
  normalizeVoucherCode,
  rupiah,
  escapeHtml,
} from "../helper.ts";

async function auditVoucherBalanceLog(params: {
  userId: string;
  code: string;
  rewardAmount: number;
  newBalance: number;
}) {
  const referenceId = `VOUCHER:${params.code}`;

  const { data: existingLog, error: lookupError } = await supabase
    .from("balance_logs")
    .select("id")
    .eq("user_id", params.userId)
    .eq("reference_id", referenceId)
    .maybeSingle();

  if (lookupError) {
    console.error("voucher balance log lookup error:", lookupError);
    return;
  }

  if (existingLog) return;

  const { error } = await supabase.from("balance_logs").insert({
    user_id: params.userId,
    amount: params.rewardAmount,
    type: "voucher_claim",
    reference_id: referenceId,
    note: `Voucher deposit bonus ${params.code}. Saldo akhir: ${rupiah(params.newBalance)}`,
  });

  if (error) {
    console.error("voucher balance log insert error:", error);
  }
}

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

  const { data: userRoleData, error: userRoleError } = await supabase
    .from("users")
    .select("id, role")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (userRoleError || !userRoleData) {
    console.error("claimVoucher role lookup error:", userRoleError);
    await send(chatId, "❌ Gagal memvalidasi role pengguna.");
    return;
  }

  const { data: voucherData, error: voucherError } = await supabase
    .from("vouchers")
    .select("target_role")
    .eq("code", code)
    .maybeSingle();

  if (voucherError) {
    console.error("claimVoucher target role lookup error:", voucherError);
    await send(chatId, "❌ Gagal memvalidasi voucher.");
    return;
  }

  const userRole = String(userRoleData.role || "reguler").toLowerCase();
  const targetRole = String(voucherData?.target_role || "both").toLowerCase();
  if (targetRole !== "both" && targetRole !== userRole) {
    await send(chatId, `❌ Voucher ini hanya berlaku untuk role ${escapeHtml(targetRole)}.`);
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

  await auditVoucherBalanceLog({
    userId: userRoleData.id,
    code,
    rewardAmount: Number(result.reward_amount || 0),
    newBalance: Number(result.new_balance || 0),
  });

  await send(
    chatId,
    `✅ <b>VOUCHER BERHASIL</b>

└ Kode : <code>${escapeHtml(code)}</code>
└ Tipe : Deposit Bonus
└ Berlaku : ${escapeHtml(targetRole)}
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
└ Berlaku : ${escapeHtml(v.target_role || "both")}
└ Kuota : ${v.used_count}/${v.quota}
└ Status : ${v.is_active ? "aktif" : "nonaktif"}`;
  });

  await sendLongMessage(chatId, text);
}
