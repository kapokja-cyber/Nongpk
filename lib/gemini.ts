/**
 * lib/gemini.ts
 * เรียก Gemini + handle MAX_TOKENS + log debug info
 */

import { GoogleGenAI } from "@google/genai";

const DEFAULT_REPLY =
  "ขออภัยนะคะ น้อง PK ยังไม่มีข้อมูลส่วนนี้ค่ะ จะประสานเจ้าหน้าที่ตอบเพิ่มเติมนะคะ";

function buildSystemPrompt(faqContent: string): string {
  return `<role>
คุณคือ น้อง PK พยาบาลของคลินิกพัฒนาการ โรงพยาบาลภูเขียวเฉลิมพระเกียรติ
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
- ห้ามแต่งข้อมูลที่ไม่มีใน FAQ เช่น วันเวลา เบอร์โทร ขั้นตอน
- ถ้าไม่มีข้อมูลใน FAQ ให้ตอบว่า "${DEFAULT_REPLY}"
- โทน: สุภาพ อบอุ่น เป็นกันเอง ใช้ "ค่ะ/นะคะ" ใช้ emoji ได้นิดหน่อย
- ความยาว: 1-3 ประโยค กระชับ ได้ใจความ
</constraints>

<output_format>
- ภาษาไทยเท่านั้น
- ห้ามใช้ markdown เช่น ** หรือ ##
- ไม่ต้องขึ้นต้นด้วย "น้อง PK:"
</output_format>

<faq>
${faqContent}
</faq>`;
}

export async function askGemini(
  userMessage: string,
  faqContent: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[gemini] GEMINI_API_KEY is not set");
    return DEFAULT_REPLY;
  }

  const ai = new GoogleGenAI({ apiKey });

  const systemPrompt = buildSystemPrompt(faqContent);
  const fullPrompt = `${systemPrompt}\n\n<question>\n${userMessage}\n</question>`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      config: {
        temperature: 1.0,
        maxOutputTokens: 1024,
      },
    });

    // --- debug logging ---
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason ?? "UNKNOWN";
    const thoughtsTokenCount =
      response.usageMetadata?.thoughtsTokenCount ?? 0;
    const candidatesTokenCount =
      response.usageMetadata?.candidatesTokenCount ?? 0;

    console.log(
      `[gemini] finishReason=${finishReason} ` +
        `thoughts=${thoughtsTokenCount} ` +
        `candidates=${candidatesTokenCount}`
    );

    // ถ้าตัดกลางประโยค → ส่ง default แทน
    if (finishReason === "MAX_TOKENS") {
      console.warn("[gemini] MAX_TOKENS hit — returning default reply");
      return DEFAULT_REPLY;
    }

    const text = response.text?.trim();
    if (!text) {
      console.warn("[gemini] empty response text");
      return DEFAULT_REPLY;
    }

    return text;
  } catch (err) {
    console.error("[gemini] API error:", err);
    return DEFAULT_REPLY;
  }
}

export { DEFAULT_REPLY };
