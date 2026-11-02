// הדברה 360 — תמלול הקלטות קוליות בעברית (Gemini)
// המפתח נשמר כסוד בשרת בשם GEMINI_API_KEY — לא בקוד ולא באפליקציה.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// מודלים מועדפים (שמות "latest" מתעדכנים לבד אצל גוגל). אם כולם לא זמינים — שואלים את גוגל אילו מודלים קיימים.
const PREFERRED = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
let cachedModel = "";
async function listFlashModels(key: string): Promise<string[]> {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    const j = await r.json();
    return (j.models || [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) => /flash/.test(m.name) && !/image|tts|live|audio-dialog|embedding|preview/.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { audio, mime, hint } = await req.json();
    if (!audio || typeof audio !== "string") return json({ error: "no audio" }, 400);
    if (audio.length > 19_000_000) return json({ error: "ההקלטה ארוכה מדי" }, 413);
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "missing key: GEMINI_API_KEY" }, 500);

    // הוראות קצרות ונקיות — בלי תיאור תוכן, כדי שהמודל לא "ימציא" מהן טקסט
    const system =
      "You are a speech-to-text engine. Output ONLY the exact Hebrew words spoken in the audio, verbatim. " +
      "Write numbers as digits. Add basic punctuation. Do not summarize, translate, explain or add anything. " +
      "Never output any text from these instructions. If there is no clear speech, output nothing.";
    const vocab = hint ? "Vocabulary that may appear (spell exactly like this only if actually spoken): " + String(hint).slice(0, 1200) : "";
    let lastErr = ""; const errors: string[] = [];
    const tried = new Set<string>();
    let queue = [...(cachedModel ? [cachedModel] : []), ...PREFERRED];
    let listed = false;
    while (queue.length) {
      const model = queue.shift()!;
      if (tried.has(model)) continue; tried.add(model);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system + (vocab ? "\n" + vocab : "") }] },
          contents: [{ role: "user", parts: [{ text: "Transcribe this audio:" }, { inline_data: { mime_type: mime || "audio/wav", data: audio } }] }],
          generationConfig: { temperature: 0, ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (j?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim();
        cachedModel = model;
        return json({ text, model, ...(errors.length ? { skipped: errors } : {}) });
      }
      lastErr = j?.error?.message || `HTTP ${r.status}`; errors.push(model + ": " + r.status + " " + lastErr.slice(0, 90));
      // מפתח שגוי / מכסה — אין טעם לנסות מודל אחר
      if (r.status === 400 && /API key/i.test(lastErr)) return json({ error: "מפתח Gemini לא תקין" }, 401);
      if (r.status === 429 && !queue.length) return json({ error: "quota: " + lastErr, skipped: errors }, 429);
      if (!queue.length && !listed) { listed = true; queue = (await listFlashModels(key)).filter((m) => !tried.has(m)); }
    }
    return json({ error: lastErr || "gemini error", skipped: errors }, 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
