// הדברה 360 — תמלול הקלטות קוליות בעברית (Gemini)
// המפתח נשמר כסוד בשרת בשם GEMINI_API_KEY — לא בקוד ולא באפליקציה.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { audio, mime, hint } = await req.json();
    if (!audio || typeof audio !== "string") return json({ error: "no audio" }, 400);
    if (audio.length > 19_000_000) return json({ error: "ההקלטה ארוכה מדי" }, 413);
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "missing key: GEMINI_API_KEY" }, 500);

    const prompt =
      "תמלל את ההקלטה בעברית, מילה במילה, בדיוק כפי שנאמרה. " +
      "זה מדביר שמכתיב פרטי עבודה: לקוח, כתובת, טלפון, מזיקים, חומרי הדברה, תיבות, מחיר, תשלום ואחריות. " +
      "כתוב מספרים בספרות (טלפונים, מחירים, מספרי בתים, כמויות ושעות). הוסף פיסוק בסיסי. " +
      "אל תסכם, אל תתרגם, אל תוסיף מילים ואל תכתוב הקדמה — החזר רק את התמלול. אם אין דיבור — החזר מחרוזת ריקה." +
      (hint ? "\nמונחים שעשויים להופיע (כתוב אותם כך): " + String(hint).slice(0, 1500) : "");

    let lastErr = "";
    for (const model of MODELS) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime || "audio/wav", data: audio } }, { text: prompt }] }],
          generationConfig: { temperature: 0, ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (j?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim();
        return json({ text, model });
      }
      lastErr = j?.error?.message || `HTTP ${r.status}`;
      // מפתח שגוי / מכסה — אין טעם לנסות מודל אחר
      if (r.status === 400 && /API key/i.test(lastErr)) return json({ error: "מפתח Gemini לא תקין" }, 401);
      if (r.status === 429) return json({ error: "quota: " + lastErr }, 429);
    }
    return json({ error: lastErr || "gemini error" }, 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
