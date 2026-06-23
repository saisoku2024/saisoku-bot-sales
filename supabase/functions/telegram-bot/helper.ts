// ==========================
// FORMAT
// ==========================
export function rupiah(amount: number) {
  return `Rp ${Number(amount || 0).toLocaleString("id-ID")}`;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatMultiline(text?: string | null) {
  if (!text) return "-";
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

// ==========================
// MESSAGE SPLIT
// ==========================
export function splitMessage(text: string, maxLen = 3500) {
  const safeText = String(text || "").trim();
  if (!safeText) return [];

  const chunks: string[] = [];
  let remaining = safeText;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

// ==========================
// COMMAND PARSER
// ==========================
export function parseCommand(text?: string | null) {
  const normalizedText = text?.trim() || "";

  if (!normalizedText.startsWith("/")) {
    return {
      isCommand: false,
      text: normalizedText,
      cmd: "",
      rawCmd: "",
      args: [] as string[],
    };
  }

  const tokens = normalizedText.split(/\s+/);
  const rawCmd = (tokens[0] || "").toLowerCase();
  const cmd = rawCmd.split("@")[0];
  const args = tokens.slice(1);

  return {
    isCommand: true,
    text: normalizedText,
    cmd,
    rawCmd,
    args,
  };
}

// ==========================
// ADMIN COMMANDS
// ==========================
export function isManagedAdminCommand(cmd: string) {
  return [
    "/setrole",
    "/addsaldo",
    "/addbalance",
    "/kurangsaldo",
    "/addvoucher",
    "/delvoucher",
    "/voucherlist",
    "/nonaktifvoucher",
    "/aktifvoucher",
    "/broadcast",
    "/ban",
    "/unban",
  ].includes(cmd);
}

// ==========================
// GENERATOR
// ==========================
export function generateTrxCode(prefix = "TRX") {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const i = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;

  return `${prefix}-${y}${m}${d}${h}${i}${s}-${rand}`;
}

export function generateUniqueCode() {
  return Math.floor(Math.random() * 99) + 1;
}

export function normalizeVoucherCode(text?: string | null) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

// ==========================
// DATE - JAKARTA
// ==========================
export function getJakartaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isSameJakartaDay(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return getJakartaDateKey(new Date(a)) === getJakartaDateKey(new Date(b));
}