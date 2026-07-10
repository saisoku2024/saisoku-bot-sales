import { supabase } from "./supabase.ts";
import { ENV } from "./env.ts";

export async function getUserByTelegramId(telegramId: number) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error("getUserByTelegramId error:", error);
  }

  return data ?? null;
}

export async function getUserIdByTelegramId(telegramId: number) {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error("getUserIdByTelegramId error:", error);
  }

  return data?.id ?? null;
}

export async function getRoleByTelegramId(telegramId: number) {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error("getRoleByTelegramId error:", error);
  }

  return data?.role ?? "reguler";
}

export async function createUserIfNotExists(
  telegramId: number,
  username?: string | null
) {
  const existingUser = await getUserByTelegramId(telegramId);
  if (existingUser) return existingUser;

  const defaultRole =
    ENV.OWNER_TELEGRAM_ID && telegramId === ENV.OWNER_TELEGRAM_ID
      ? "owner"
      : "reguler";

  const { data, error } = await supabase
    .from("users")
    .insert({
      telegram_id: telegramId,
      username: username || null,
      role: defaultRole,
      balance: 0,
      is_banned: false,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("createUserIfNotExists error:", error);
    return null;
  }

  return data ?? null;
}

export async function ensureOwnerBootstrap(telegramId: number) {
  if (!ENV.OWNER_TELEGRAM_ID || ENV.OWNER_TELEGRAM_ID !== telegramId) return;

  const { data: user, error } = await supabase
    .from("users")
    .select("role")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error("ensureOwnerBootstrap get user error:", error);
    return;
  }

  if (!user) return;

  if (user.role !== "owner") {
    const { error: updateError } = await supabase
      .from("users")
      .update({ role: "owner" })
      .eq("telegram_id", telegramId);

    if (updateError) {
      console.error("ensureOwnerBootstrap update error:", updateError);
    }
  }
}

export async function getOrCreateUser(
  telegramId: number,
  username?: string | null
) {
  let user = await getUserByTelegramId(telegramId);

  if (!user) {
    user = await createUserIfNotExists(telegramId, username);
  }

  await ensureOwnerBootstrap(telegramId);

  user = await getUserByTelegramId(telegramId);

  return user;
}

export function isUserRestricted(user: any) {
  return Boolean(user?.is_banned) || user?.is_active === false;
}

export function getUserRestrictedMessage(user: any) {
  if (user?.is_banned) {
    return "Akun kamu sedang dibanned. Hubungi admin jika merasa ini kesalahan.";
  }

  return "Akun kamu sedang disuspend. Hubungi admin jika merasa ini kesalahan.";
}

export async function isUserBanned(telegramId: number) {
  const { data, error } = await supabase
    .from("users")
    .select("is_banned, is_active")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error("isUserBanned error:", error);
    return false;
  }

  return isUserRestricted(data);
}

export async function updateUserRole(
  targetTelegramId: number,
  newRole: string
) {
  const { error } = await supabase
    .from("users")
    .update({ role: newRole })
    .eq("telegram_id", targetTelegramId);

  if (error) {
    console.error("updateUserRole error:", error);
    return false;
  }

  return true;
}

export async function updateUserBanStatus(
  targetTelegramId: number,
  isBanned: boolean
) {
  const { error } = await supabase
    .from("users")
    .update({ is_banned: isBanned, is_active: !isBanned })
    .eq("telegram_id", targetTelegramId);

  if (error) {
    console.error("updateUserBanStatus error:", error);
    return false;
  }

  return true;
}

export async function updateUserBalanceByTelegramId(
  telegramId: number,
  newBalance: number
) {
  const { error } = await supabase
    .from("users")
    .update({ balance: newBalance })
    .eq("telegram_id", telegramId);

  if (error) {
    console.error("updateUserBalanceByTelegramId error:", error);
    return false;
  }

  return true;
}
