// הדברה 360 — מושך את היומן של גוגל (כתובת iCal סודית) כדי שהאפליקציה תוכל לייבא אירועים.
// מאפשר רק כתובות של calendar.google.com — לא פרוקסי פתוח.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const OK = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^\s?#]+\/(private-[0-9a-f]+|public)\/basic\.ics$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });
  let url = "";
  try { url = String((await req.json()).url || "").trim(); } catch { /* */ }
  if (!OK.test(url)) return new Response(JSON.stringify({ error: "כתובת לא תקינה — צריך את 'הכתובת הסודית בפורמט iCal' מהגדרות היומן בגוגל" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return new Response(JSON.stringify({ error: "גוגל החזיר שגיאה " + r.status }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    const txt = await r.text();
    return new Response(txt, { headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
