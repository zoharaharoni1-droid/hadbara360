// @ts-nocheck
// הדברה 360 — עוזר חכם: מבין משפט חופשי בעברית וממלא טיוטה של יומן ביצוע / חשבונית.
// לא שומר ולא שולח כלום — רק מחזיר טיוטה. המשתמש בודק ומאשר במערכת.
// המפתח נשמר כסוד בשרת בשם GEMINI_API_KEY — לא בקוד ולא באפליקציה.
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const PREFERRED = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3-flash", "gemini-2.5-flash"];
const thinkOff = (m) => m.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { thinkingLevel: "low" } };
const noThink = new Set();
let cachedModel = "";

const S = (d) => ({ type: "STRING", description: d });
const A = (d) => ({ type: "ARRAY", items: { type: "STRING" }, description: d });
const SCHEMA = {
  type: "OBJECT",
  properties: {
    apptId: S("id of the matching appointment from the list, or empty"),
    customerName: S("customer name as said"),
    customerId: S("id from the customers list that matches the customer said, or empty"),
    docType: S("חשבונית מס / חשבונית מס/קבלה / קבלה — exactly as he asked, or empty"),
    invoiceDesc: S("short Hebrew description line for the invoice item, e.g. הדברת תיקנים, or empty"),
    wantLog: { type: "BOOLEAN", description: "user wants an execution log (יומן ביצוע)" },
    wantAppt: { type: "BOOLEAN", description: "user wants to SCHEDULE a new appointment / job in the calendar (תקבע, תרשום ביומן, תזמין)" },
    apptDate: S("date of the new appointment YYYY-MM-DD, computed from what he said (מחר, יום שלישי, 25 לחודש); empty if no date was said"),
    apptTime: S("time HH:MM of the new appointment; empty if no time was said"),
    newName: S("customer name for a NEW customer (not in the list), as said"),
    newPhone: S("phone number said, digits only, or empty"),
    newAddress: S("address said (street, number, city), or empty"),
    instructions: A("customer instructions he mentioned, EXACT texts from the instructions list only"),
    wantInvoice: { type: "BOOLEAN", description: "user wants an invoice/receipt (חשבונית / קבלה)" },
    pests: A("pests, exact names from the pests list when possible"),
    level: S("infestation level: קלה / בינונית / גבוהה or empty"),
    placeType: S("place type from list or empty"),
    rooms: S("number of rooms or empty"),
    floor: S("floor or empty"),
    extras: A("extra areas from list"),
    materials: A("chemical/product names, EXACT names from the chemicals list"),
    methodHint: S("method from list or empty"),
    areas: A("application areas, exact names from the areas list"),
    boxesNew: { type: "INTEGER", description: "new bait boxes placed (0 if none)" },
    boxesRefill: { type: "INTEGER", description: "existing bait boxes refilled (0 if none)" },
    spots: A("where bait boxes were placed"),
    reentry0: { type: "BOOLEAN", description: "no need to leave the place" },
    reentryAdults: S("hours adults must stay out, e.g. 2, or empty"),
    price: S("price in shekels, digits only, or empty"),
    payStatus: S("paid / debt / empty"),
    payMethod: S("payment method from list or empty"),
    warranty: S("warranty months, digits — ONLY if the word אחריות was said, otherwise empty"),
    signs: A("monitoring findings that were seen (ממצאי ניטור), exact phrases from the signs list"),
    hasPets: { type: "BOOLEAN" },
    hasBaby: { type: "BOOLEAN" },
    notes: S("ONLY if he said הערות / הערה / 'תרשום ש': that content, rewritten in clear, polite, professional Hebrew for the customer — same facts, nothing added. Otherwise empty."),
    summary: S("one short Hebrew sentence: what you understood"),
  },
  required: ["apptId", "wantLog", "wantInvoice", "wantAppt", "apptDate", "apptTime", "customerId", "newName", "pests", "materials", "price", "summary"],
};

async function requireUser(req) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data, error } = await sb.auth.getUser(tok);
  if (error || !data || !data.user) throw new Error("צריך להיות מחובר למערכת");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    try { await requireUser(req); } catch (e) { return json({ error: String(e.message || e) }, 401); }
    const body = await req.json();
    const text = String(body.text || "").slice(0, 3000).trim();
    if (!text) return json({ error: "אין טקסט" }, 400);
    const c = body.ctx || {};
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "missing key: GEMINI_API_KEY" }, 500);
    const L = (a, n = 300) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => String(x)).join(" | ");
    const appts = (Array.isArray(c.appts) ? c.appts : []).slice(0, 40).map((a) => JSON.stringify(a)).join("\n");
    const system = [
      "You are the assistant inside the CRM of an Israeli pest-control company (הדברה 360).",
      "The exterminator speaks or types a free Hebrew sentence about a job he just finished. Extract the data into the JSON schema.",
      "Rules: use ONLY facts that were said. Never invent materials, prices or pests. Leave fields empty when not said.",
      "Map slang: ג'וקים = תיקן (German if he says גרמני, otherwise American), עכברושים = חולדות.",
      "Materials MUST be written exactly as in the chemicals list (match spelling variations and transcription errors to the closest name).",
      "Payment: ביט, פייבוקס/PayBox, מזומן, העברה בנקאית, אשראי, צ'ק. 'לא שילם' / 'ישלם אחר כך' = debt.",
      "wantInvoice is true only if he asks for an invoice/receipt (חשבונית, קבלה). wantLog is true if he asks for יומן ביצוע or describes a treatment.",
      "Customer: the customer is whoever he NAMES (person, business, hotel, contact person). Pick customerId from the customers list (match name, business, place or contact person). apptId ONLY if today's appointment is for that same customer; NEVER pick an appointment of a different customer just because it is the only one today.",
      "Doc type: 'חשבונית מס' = tax invoice (no receipt). 'חשבונית מס/קבלה' or 'חשבונית מס קבלה' = invoice+receipt (paid). 'קבלה' alone = receipt. Copy what he asked.",
      "Price: if he says 'כולל מע\"מ' the price includes VAT; 'פלוס מע\"מ' / 'לפני מע\"מ' means before VAT. Write the number he said.",
      "Today: " + String(c.today || ""),
      "Today's appointments (JSON lines):\n" + (appts || "(none)"),
      "Customers that may match (JSON lines):\n" + ((Array.isArray(c.customers) ? c.customers : []).slice(0, 20).map((x) => JSON.stringify(x)).join("\n") || "(none)"),
      "ZERO GUESSING: every field must come from words he actually said. Never add defaults (no default warranty, price, materials, areas, re-entry time, instructions). Empty is better than a guess.",
      "Warranty: fill ONLY if he said the word אחריות. Never guess a warranty.",
      "Instructions: when he mentions an instruction briefly (e.g. 'לא לשטוף 24 שעות', 'לאוורר', 'לא לגעת בתחנות'), return the matching full text(s) from the instructions list. Only ones he said.",
      "Scheduling: wantAppt=true when he asks to set/book a future appointment (or the screen mode is appt). ALWAYS fill apptDate as YYYY-MM-DD computed from today's date and weekday (e.g. today Friday 2026-11-20: 'מחר' = 2026-11-21, 'יום שני' = 2026-11-23) and apptTime as 24h HH:MM ('2 בצהריים' = 14:00, '8:30 בערב' = 20:30, 'בעשר' = 10:00). If he names a customer that is NOT clearly in the customers list, leave customerId empty and put the name/phone/address he said in newName/newPhone/newAddress. A customer in the list only matches if the NAME matches — words like הדברה, תיקנים, בניין, קומה are not names.",
      "Mode chosen on screen (hint, may be empty): " + String(c.mode || ""),
      "Signs (monitoring findings) = what he saw: droppings (גללים / צואה), live adults, nymphs, egg cases, shed skins, gnaw marks, nests, trails etc. Map to the signs list.",
      "Pests list: " + L(c.pests),
      "Instructions list: " + L(c.instr, 80),
      "Signs list: " + L(c.signs),
      "Chemicals list: " + L(c.chems),
      "Application areas: " + L(c.areas),
      "Place types: " + L(c.places),
      "Methods: " + L(c.methods),
      "Payment methods: " + L(c.payMethods),
    ].join("\n");
    const errors = []; const tried = new Set();
    const queue = [...(cachedModel ? [cachedModel] : []), ...PREFERRED];
    while (queue.length) {
      const model = queue.shift(); if (tried.has(model)) continue; tried.add(model);
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", signal: AbortSignal.timeout(20000),
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, ...(noThink.has(model) ? {} : thinkOff(model)) },
          }),
        });
      } catch (_e) { errors.push(model + ": timeout"); if (cachedModel === model) cachedModel = ""; continue; }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const out = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
        let data; try { data = JSON.parse(out); } catch { errors.push(model + ": bad json"); continue; }
        cachedModel = model;
        return json({ ok: true, data, model });
      }
      const msg = j?.error?.message || `HTTP ${r.status}`;
      if (r.status === 400 && /thinking/i.test(msg) && !noThink.has(model)) { noThink.add(model); tried.delete(model); queue.unshift(model); continue; }
      if (cachedModel === model) cachedModel = "";
      errors.push(model + ": " + r.status + " " + msg.slice(0, 90));
      if (r.status === 400 && /API key/i.test(msg)) return json({ error: "מפתח Gemini לא תקין" }, 401);
      if (r.status === 429 && !queue.length) return json({ error: "quota: " + msg }, 429);
    }
    return json({ error: "gemini error", skipped: errors }, 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
