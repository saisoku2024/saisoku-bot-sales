export const ENV = {
  SB_URL: Deno.env.get("SB_URL") || "",
  SB_SERVICE_ROLE: Deno.env.get("SB_SERVICE_ROLE") || "",
  TELEGRAM_BOT_TOKEN: Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
  TELEGRAM_WEBHOOK_SECRET: Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "",
  QRIS_IMAGE_URL:
    Deno.env.get("QRIS_IMAGE_URL") ||
    "https://lgptunvfnosnfejzrhml.supabase.co/storage/v1/object/public/QRIS%20SHOPEE/QR%20SHOPEE.jpg",
  START_IMAGE_URL:
    Deno.env.get("START_IMAGE_URL") ||
    "https://i.ibb.co.com/xttnhqVg/photo-2024-11-08-05-16-02.jpg",
  OWNER_TELEGRAM_ID: Number(Deno.env.get("OWNER_TELEGRAM_ID") || 0),
  BETTER_STACK_INGESTING_HOST:
    Deno.env.get("BETTER_STACK_INGESTING_HOST") ||
    Deno.env.get("BETTER_STACK_ENDPOINT") ||
    Deno.env.get("ERROR_LOG_DRAIN_URL") ||
    Deno.env.get("LOGTAIL_INGEST_URL") ||
    "",
  BETTER_STACK_SOURCE_TOKEN:
    Deno.env.get("BETTER_STACK_SOURCE_TOKEN") ||
    Deno.env.get("ERROR_LOG_DRAIN_TOKEN") ||
    Deno.env.get("LOGTAIL_SOURCE_TOKEN") ||
    "",
};

// Validasi penting
if (!ENV.SB_URL) throw new Error("Missing env SB_URL");
if (!ENV.SB_SERVICE_ROLE) throw new Error("Missing env SB_SERVICE_ROLE");
if (!ENV.TELEGRAM_BOT_TOKEN) {
  throw new Error("Missing env TELEGRAM_BOT_TOKEN");
}
if (!ENV.TELEGRAM_WEBHOOK_SECRET) {
  throw new Error("Missing env TELEGRAM_WEBHOOK_SECRET");
}
