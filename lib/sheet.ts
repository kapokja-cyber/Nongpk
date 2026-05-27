/**
 * lib/sheet.ts
 * Fetch FAQ จาก Google Sheet (CSV public URL)
 * Cache ใน memory 60 วินาที — ไม่ fetch ทุก message
 */

export interface FaqRow {
  category: string;
  question: string;
  answer: string;
}

interface CacheEntry {
  data: FaqRow[];
  fetchedAt: number; // Date.now()
}

// In-memory cache — reset ทุกครั้งที่ Vercel cold start
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 วินาที

/**
 * แปลง CSV text → array ของ FaqRow
 * รองรับ header row: category, question, answer
 */
function parseCsv(csv: string): FaqRow[] {
  const lines = csv
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  // skip header row (บรรทัดแรก)
  const rows = lines.slice(1);

  return rows
    .map((line) => {
      // split by comma แต่ระวัง comma ใน quoted field
      const cols = splitCsvLine(line);
      return {
        category: cols[0]?.trim() ?? "",
        question: cols[1]?.trim() ?? "",
        answer: cols[2]?.trim() ?? "",
      };
    })
    .filter((row) => row.question && row.answer); // กรอง row ว่าง
}

/**
 * Simple CSV line splitter — รองรับ "field with, comma"
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * แปลง FaqRow[] → string ที่จะ inject เข้า system prompt
 * format: category | question → answer
 */
export function faqToPromptString(rows: FaqRow[]): string {
  if (rows.length === 0) return "(ไม่มีข้อมูล FAQ)";
  return rows
    .map((r) => `[${r.category}] ${r.question} → ${r.answer}`)
    .join("\n");
}

/**
 * Main function: ดึง FAQ พร้อม cache
 * - ถ้า cache ยังสด (< 60 วิ) → return cache
 * - ถ้า fetch ล้มเหลว → return cache เก่า (ถ้ามี) หรือ []
 */
export async function fetchFaq(): Promise<FaqRow[]> {
  const now = Date.now();

  // ถ้า cache ยังสด → return เลย
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    console.log("[sheet] cache hit");
    return cache.data;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    console.error("[sheet] SHEET_CSV_URL is not set");
    return cache?.data ?? [];
  }

  try {
    console.log("[sheet] fetching FAQ from Sheet...");
    const res = await fetch(url, {
      // บอก fetch ไม่ให้ใช้ Next.js cache (ต้องการ real-time)
      cache: "no-store",
      signal: AbortSignal.timeout(5000), // timeout 5 วิ
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const csv = await res.text();
    const rows = parseCsv(csv);

    // อัพเดต cache
    cache = { data: rows, fetchedAt: now };
    console.log(`[sheet] fetched ${rows.length} FAQ rows`);
    return rows;
  } catch (err) {
    console.error("[sheet] fetch failed:", err);

    // fallback → cache เก่า (ถ้ามี)
    if (cache) {
      console.warn("[sheet] using stale cache as fallback");
      return cache.data;
    }

    return [];
  }
}
