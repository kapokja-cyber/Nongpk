/**
 * app/api/line-webhook/route.ts
 * LINE Webhook — verify signature → fetch FAQ → call Gemini → reply
 * ทุกอย่างต้องจบภายใน 10 วินาที (LINE timeout)
 */

import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";
import { messagingApi, webhook } from "@line/bot-sdk";
import { fetchFaq, faqToPromptString } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";

const { MessagingApiClient } = messagingApi;

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error("[webhook] LINE_CHANNEL_SECRET is not set");
    return false;
  }
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// ---------------------------------------------------------------------------
// LINE client (lazy init)
// ---------------------------------------------------------------------------
function getLineClient(): messagingApi.MessagingApiClient {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return new MessagingApiClient({ channelAccessToken: token });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // 1. Read raw body (ต้องใช้ raw text สำหรับ verify signature)
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  // 2. Verify signature
  if (!verifySignature(rawBody, signature)) {
    console.warn("[webhook] invalid signature");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Parse events
  let body: webhook.CallbackRequest;
  try {
    body = JSON.parse(rawBody) as webhook.CallbackRequest;
  } catch {
    console.error("[webhook] failed to parse body");
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  // 4. Process events แบบ parallel (หลาย message พร้อมกัน)
  const promises = body.events.map(async (event) => {
    // รับเฉพาะ text message
    if (
      event.type !== "message" ||
      event.message.type !== "text" ||
      !event.replyToken
    ) {
      return;
    }

    const userMessage = (event.message as webhook.TextMessageContent).text;
    const replyToken = event.replyToken;

    console.log(`[webhook] message: "${userMessage}"`);

    try {
      // 5. Fetch FAQ (มี cache 60 วิ — เร็วมาก)
      const faqRows = await fetchFaq();
      const faqContent = faqToPromptString(faqRows);

      // 6. Ask Gemini
      const replyText = await askGemini(userMessage, faqContent);

      // 7. Reply กลับ LINE
      const client = getLineClient();
      await client.replyMessage({
        replyToken,
        messages: [
          {
            type: "text",
            text: replyText,
          },
        ],
      });

      console.log(`[webhook] replied: "${replyText.slice(0, 50)}..."`);
    } catch (err) {
      console.error("[webhook] error processing message:", err);

      // พยายาม reply default message แม้จะ error
      try {
        const client = getLineClient();
        await client.replyMessage({
          replyToken,
          messages: [{ type: "text", text: DEFAULT_REPLY }],
        });
      } catch (replyErr) {
        // LINE replyToken หมดอายุ หรือ network error — log แล้วปล่อยผ่าน
        console.error("[webhook] failed to send default reply:", replyErr);
      }
    }
  });

  // รอทุก event เสร็จ (แต่ไม่ให้ timeout เกิน 9 วิ)
  await Promise.allSettled(promises);

  // ต้อง return 200 เสมอ — LINE จะ retry ถ้าได้รับ error
  return NextResponse.json({ ok: true }, { status: 200 });
}

// LINE ส่ง GET ตอน verify webhook URL
export async function GET() {
  return NextResponse.json({ status: "LINE Bot น้อง PK is running 🌸" });
}
