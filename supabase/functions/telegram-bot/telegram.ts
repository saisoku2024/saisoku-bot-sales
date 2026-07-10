import { ENV } from "./env.ts";
import { splitMessage } from "./helper.ts";

const BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN;

// ==========================
// SEND MESSAGE
// ==========================
export async function send(chatId: number, text: string, kb?: unknown) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: kb,
      }),
    }
  );

  const result = await res.json();

if (!result.ok) {
  console.error("TELEGRAM SEND ERROR:", result);
  throw new Error(result.description || "Failed to send message");
}

return result.result;
}

// ==========================
// SEND PHOTO
// ==========================
export async function sendPhoto(
  chatId: number,
  photo: string,
  caption: string,
  kb?: unknown
) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        caption,
        parse_mode: "HTML",
        reply_markup: kb,
      }),
    }
  );

  const result = await res.json();

  if (!result.ok) {
    console.error("TELEGRAM SEND PHOTO ERROR:", result);
    throw new Error(result.description || "Failed to send photo");
  }
}

// ==========================
// EDIT MESSAGE TEXT
// ==========================
export async function editMessage(
  chatId: number,
  msgId: number,
  text: string,
  kb?: unknown
) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: "HTML",
          reply_markup: kb,
        }),
      }
    );

    const result = await res.json();

    if (!result.ok) {
      const desc = String(result.description || "");
      if (desc.includes("message is not modified")) return true;
      throw new Error(desc || "Failed to edit message");
    }

    return true;
  } catch (err) {
    console.error("editMessage error:", err);
    return false;
  }
}

// ==========================
// EDIT MESSAGE CAPTION
// ==========================
export async function editCaption(
  chatId: number,
  msgId: number,
  caption: string,
  kb?: unknown
) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: msgId,
          caption,
          parse_mode: "HTML",
          reply_markup: kb,
        }),
      }
    );

    const result = await res.json();

    if (!result.ok) {
      const desc = String(result.description || "");

      if (desc.includes("message is not modified")) {
        return true;
      }

      throw new Error(desc || "Failed to edit caption");
    }

    return true;
  } catch (err) {
    console.error("editCaption error:", err);
    return false;
  }
}

// ==========================
// ANSWER CALLBACK
// ==========================
export async function answerCallback(id: string) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: id }),
      }
    );

    const result = await res.json();

    if (!result.ok) {
      const desc = String(result.description || "");

      if (
        desc.includes("query is too old") ||
        desc.includes("query ID is invalid") ||
        desc.includes("response timeout expired")
      ) {
        return true;
      }

      throw new Error(desc || "Failed to answer callback");
    }

    return true;
  } catch (err) {
    console.error("answerCallback error:", err);
    return false;
  }
}

// ==========================
// LONG MESSAGE
// ==========================
export async function sendLongMessage(
  chatId: number,
  text: string,
  kb?: unknown
) {
  const chunks = splitMessage(text, 3500);
  if (!chunks.length) return;

  for (let i = 0; i < chunks.length; i++) {
    await send(chatId, chunks[i], i === chunks.length - 1 ? kb : undefined);
  }
}

// ==========================
// GET TELEGRAM FILE
// ==========================
export async function getTelegramFile(fileId: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  return await res.json();
}

// ==========================
// DOWNLOAD FILE CONTENT
// ==========================
export async function downloadTelegramFile(filePath: string) {
  const res = await fetch(
    `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
  );
  return await res.text();
}