// @ts-nocheck
// הדברה 360 — סנכרון גוגל יומן בצד השרת.
// רץ גם כשאף מכשיר לא פתוח (מתוזמן), שומר את הקישור הסודי רק בשרת, ולא מוחק כלום כשגוגל לא זמין.
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "Content-Type": "application/json" } });
const OK = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^\s?#]+\/(private-[0-9a-f]+|public)\/basic\.ics$/i;
const ALL_DAY_TW = "במהלך היום";
const BUCKET = "contracts";
const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const isoOf = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const todayIL = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(x => [x.type, x.value])); return p.year + "-" + p.month + "-" + p.day; };
async function readJson(path, dflt) { const r = await sb.storage.from(BUCKET).download(path); if (r.error) return dflt; try { return JSON.parse(await r.data.text()); } catch { return dflt; } }
async function writeJson(path, obj) { const r = await sb.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(obj)], { type: "application/json" }), { contentType: "application/json", upsert: true }); if (r.error) throw r.error; }

function icsParse(text){
  const lines=String(text||"").replace(/\r\n/g,"\n").replace(/\n[ \t]/g,"").split("\n");
  const evs=[]; let cur=null;
  const unesc=s=>String(s||"").replace(/\\n/gi,"\n").replace(/\\([,;\\])/g,"$1");
  for(const ln of lines){
    if(ln==="BEGIN:VEVENT"){ cur={exdate:[]}; continue; }
    if(ln==="END:VEVENT"){ if(cur) evs.push(cur); cur=null; continue; }
    if(!cur) continue;
    const i=ln.indexOf(":"); if(i<0) continue;
    const head=ln.slice(0,i), val=ln.slice(i+1); const [name,...ps]=head.split(";"); const params={}; ps.forEach(p=>{ const [k,v]=p.split("="); params[k]=v; });
    if(name==="UID") cur.uid=val;
    else if(name==="SUMMARY") cur.summary=unesc(val);
    else if(name==="DESCRIPTION") cur.desc=unesc(val);
    else if(name==="LOCATION") cur.loc=unesc(val);
    else if(name==="STATUS") cur.status=val;
    else if(name==="RRULE") cur.rrule=val;
    else if(name==="DTSTART") cur.start={v:val,p:params};
    else if(name==="DTEND") cur.end={v:val,p:params};
    else if(name==="RECURRENCE-ID") cur.recId={v:val,p:params};
    else if(name==="EXDATE") val.split(",").forEach(x=>cur.exdate.push(x));
  }
  return evs;
}
// תאריך+שעה מקומיים (ישראל)
function icsTime(t){
  if(!t) return null; const v=t.v; const m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/); if(!m) return null;
  if(!m[4]) return {date:m[1]+"-"+m[2]+"-"+m[3],time:"",allDay:true};
  if(m[7]){ const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]));
    const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d).map(x=>[x.type,x.value]));
    return {date:p.year+"-"+p.month+"-"+p.day,time:(p.hour==="24"?"00":p.hour)+":"+p.minute,allDay:false}; }
  return {date:m[1]+"-"+m[2]+"-"+m[3],time:m[4]+":"+m[5],allDay:false};
}
// פריסת אירועים חוזרים (יומי/שבועי/חודשי/שנתי) בטווח
function icsExpand(evs,fromIso,toIso){
  const out=[]; const overrides={};
  evs.filter(e=>e.recId).forEach(e=>{ const r=icsTime(e.recId); if(r) overrides[e.uid+"|"+r.date]=e; });
  const DAYS=["SU","MO","TU","WE","TH","FR","SA"];
  for(const e of evs){
    if(e.recId) { const s=icsTime(e.start); if(s&&s.date>=fromIso&&s.date<=toIso) out.push({...e,iid:e.uid+"|"+icsTime(e.recId).date,s,en:icsTime(e.end)}); continue; }
    const s=icsTime(e.start); if(!s) continue; const en=icsTime(e.end);
    if(!e.rrule){ if(s.date>=fromIso&&s.date<=toIso) out.push({...e,iid:e.uid,s,en}); continue; }
    const R=Object.fromEntries(e.rrule.split(";").map(x=>x.split("="))); const iv=parseInt(R.INTERVAL)||1; let count=parseInt(R.COUNT)||0;
    const until=R.UNTIL?R.UNTIL.slice(0,4)+"-"+R.UNTIL.slice(4,6)+"-"+R.UNTIL.slice(6,8):"9999";
    const ex=new Set(e.exdate.map(x=>x.slice(0,4)+"-"+x.slice(4,6)+"-"+x.slice(6,8)));
    const byday=R.BYDAY?R.BYDAY.split(",").map(x=>DAYS.indexOf(x.replace(/[^A-Z]/g,""))).filter(x=>x>=0):null;
    const d0=new Date(s.date+"T12:00:00"); const durDays=en&&s.allDay&&en.date?Math.round((new Date(en.date+"T12:00:00")-d0)/864e5):0;
    let n=0;
    for(let k=0;k<800;k++){
      let cands=[];
      if(R.FREQ==="DAILY"){ const d=new Date(d0); d.setDate(d.getDate()+k*iv); cands=[d]; }
      else if(R.FREQ==="WEEKLY"){ const w=new Date(d0); w.setDate(w.getDate()-w.getDay()+k*7*iv); const days=byday||[d0.getDay()]; cands=days.sort().map(dd=>{ const d=new Date(w); d.setDate(w.getDate()+dd); return d; }).filter(d=>d>=d0); }
      else if(R.FREQ==="MONTHLY"){ const d=new Date(d0); d.setMonth(d.getMonth()+k*iv); if(d.getDate()!==d0.getDate()) continue; cands=[d]; }
      else if(R.FREQ==="YEARLY"){ const d=new Date(d0); d.setFullYear(d.getFullYear()+k*iv); cands=[d]; }
      else break;
      let stop=false;
      for(const d of cands){ const iso=isoOf(d); if(iso>until||iso>toIso){ stop=true; break; } n++; if(count&&n>count){ stop=true; break; }
        if(iso<fromIso||ex.has(iso)) continue; const key=e.uid+"|"+iso; if(overrides[key]) continue;
        const enD=new Date(d); enD.setDate(enD.getDate()+durDays);
        out.push({...e,iid:key,s:{...s,date:iso},en:en?{...en,date:s.allDay?isoOf(enD):iso}:null}); }
      if(stop) break;
    }
  }
  return out.filter(e=>e.status!=="CANCELLED");
}

function phoneIn(t) { const m = String(t || "").replace(/[\s-]/g, "").match(/(?:\+?972|0)5\d{7,8}/); return m ? m[0].replace(/^\+?972/, "0") : ""; }
async function syncOne(cfg, rows, status) {
  const r = await fetch(cfg.url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("גוגל החזיר שגיאה " + r.status);
  const txt = await r.text();
  if (!/BEGIN:VCALENDAR/.test(txt)) throw new Error("גוגל החזיר תשובה לא תקינה");
  const to = new Date(); to.setDate(to.getDate() + 60);
  const from = cfg.from || todayIL();
  const evs = icsExpand(icsParse(txt), from, isoOf(to));
  const pre = "g:" + cfg.id + ":";
  const byUid = {}; rows.forEach(a => { if (a.gcalUid) byUid[a.gcalUid] = a; });
  const seen = new Set(); const ups = []; let added = 0, updated = 0, removed = 0;
  let idBase = Math.max(Math.floor(Date.now() / 1000 - 1700000000) * 100, ...rows.map(a => Number(a.id) || 0)) + 1;
  for (const e of evs) {
    const iid = pre + e.iid; seen.add(iid);
    const s = e.s; if (!s || s.date < from) continue;
    const endT = e.en && !e.en.allDay ? e.en.time : "";
    const text = [e.summary, e.loc, e.desc].filter(Boolean).join("\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    const sig = [e.summary, e.desc, e.loc, s.date, s.time, endT].join("|");
    const tw = s.allDay ? ALL_DAY_TW : (s.time + "–" + (endT || String(Math.min(23, parseInt(s.time) + 2)).padStart(2, "0") + s.time.slice(2)));
    const ex = byUid[iid];
    const base = { date: s.date, time: s.allDay ? "07:00" : s.time, timeWindow: tw, allDay: !!s.allDay, gcalSig: sig, updatedAt: new Date().toISOString() };
    if (ex) {
      if (ex.gcalSig === sig && !(ex.deleted && ex.gcalRemoved)) continue;
      let nx;
      if (ex.kind === "free") nx = { ...ex, ...base, freeText: text, rawMsg: text, needsParse: true };
      else if (ex.kind === "personal") nx = { ...ex, ...base, notes: text, title: e.summary || ex.title, customerName: "📌 " + (e.summary || "") };
      else nx = { ...ex, ...base };
      if (ex.deleted && ex.gcalRemoved) { delete nx.deleted; delete nx.deletedAt; delete nx.gcalRemoved; }
      ups.push(nx); updated++; continue;
    }
    const title = (e.summary || text.split("\n")[0] || "אירוע מגוגל").slice(0, 60);
    const phone = phoneIn(text);
    const twin = rows.find(a => !a.deleted && !a.gcalUid && a.date === s.date && ((phone && String(a.phone || "").replace(/\D/g, "").endsWith(phone.slice(-9))) || (e.summary && a.customerName && String(e.summary).includes(a.customerName))));
    if (twin) { ups.push({ ...twin, gcalUid: iid, gcalSig: sig }); updated++; continue; }
    const common = { ...base, id: idBase++, workerId: cfg.workerId || null, workerName: cfg.workerName || "", status: "ממתין", gcalUid: iid, source: "google" };
    if (cfg.kind === "personal") ups.push({ ...common, kind: "personal", title, customerName: "📌 " + title, pestType: "משימה אישית", price: 0, address: e.loc || "", customerId: null, blockDay: false, notes: text });
    else ups.push({ ...common, kind: "free", freeText: text, rawMsg: text, customerName: title, customerId: null, phone, address: e.loc || "", pestType: "", pests: [], price: 0, notes: "", executionLog: null, needsParse: true });
    added++;
  }
  // אירועים שנמחקו בגוגל — רק אם ההגדרה מאפשרת, רק רישומים שלא הפכו להזמנה, ורק אם הפיד נראה תקין
  const today = todayIL();
  const linkedFuture = rows.filter(a => a.gcalUid && String(a.gcalUid).startsWith(pre) && !a.deleted && a.date >= today);
  const gone = linkedFuture.filter(a => !seen.has(a.gcalUid) && (a.kind === "free" || a.kind === "personal") && a.status !== "בוצע" && a.date >= from);
  const suspicious = evs.length === 0 && linkedFuture.length > 2 || (linkedFuture.length >= 5 && gone.length > linkedFuture.length * 0.6);
  if (cfg.syncDeletes !== false && !suspicious) gone.forEach(a => { ups.push({ ...a, deleted: true, deletedAt: new Date().toISOString(), gcalRemoved: true, updatedAt: new Date().toISOString() }); removed++; });
  if (ups.length) {
    for (let i = 0; i < ups.length; i += 200) {
      const chunk = ups.slice(i, i + 200).map(a => ({ id: String(a.id), data: a, updated_at: new Date().toISOString() }));
      const { error } = await sb.from("appointments").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error("שמירה למערכת נכשלה: " + error.message);
    }
  }
  return { added, updated, removed, events: evs.length, skippedDeletes: suspicious ? gone.length : 0 };
}
async function runSync() {
  const cfg = await readJson("gcal/config.json", { calendars: [] });
  const cals = (cfg.calendars || []).filter(c => c.url && !c.paused);
  const st = await readJson("gcal/status.json", {});
  if (!cals.length) return { ok: true, calendars: [], none: true };
  const minFrom = cals.reduce((m, c) => (c.from || todayIL()) < m ? (c.from || todayIL()) : m, "9999");
  const { data, error } = await sb.from("appointments").select("id,data").gte("data->>date", minFrom);
  if (error) throw new Error("קריאת היומן נכשלה: " + error.message);
  const { data: g2 } = await sb.from("appointments").select("id,data").not("data->>gcalUid", "is", null);
  const map = new Map(); [...(data || []), ...(g2 || [])].forEach(r => map.set(String(r.id), r.data));
  const rows = [...map.values()].filter(Boolean);
  const out = [];
  for (const c of cals) {
    const s = st[c.id] || {};
    try { const res = await syncOne(c, rows, s); st[c.id] = { lastOk: new Date().toISOString(), lastTry: new Date().toISOString(), lastErr: "", fails: 0, ...res }; out.push({ id: c.id, ok: true, ...res }); }
    catch (e) { st[c.id] = { ...s, lastTry: new Date().toISOString(), lastErr: String(e.message || e), fails: (s.fails || 0) + 1 }; out.push({ id: c.id, ok: false, error: String(e.message || e) }); }
  }
  await writeJson("gcal/status.json", st).catch(() => {});
  return { ok: out.every(x => x.ok), calendars: out };
}
function publicCfg(cfg, st) { return (cfg.calendars || []).map(c => ({ id: c.id, workerId: c.workerId, workerName: c.workerName, kind: c.kind, from: c.from, paused: !!c.paused, syncDeletes: c.syncDeletes !== false, label: c.label || "", status: st[c.id] || {} })); }
async function requireUser(req) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data, error } = await sb.auth.getUser(tok);
  if (error || !data || !data.user) throw new Error("צריך להיות מחובר למערכת");
  return data.user;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body = {}; try { body = await req.json(); } catch { /* */ }
  const action = body.action || "sync";
  try {
    if (action === "sync") { const r = await runSync(); const cfg = await readJson("gcal/config.json", { calendars: [] }); const st = await readJson("gcal/status.json", {}); return J({ ...r, list: publicCfg(cfg, st) }); }
    if (action === "status") { const cfg = await readJson("gcal/config.json", { calendars: [] }); const st = await readJson("gcal/status.json", {}); return J({ ok: true, list: publicCfg(cfg, st) }); }
    await requireUser(req);
    const cfg = await readJson("gcal/config.json", { calendars: [] }); cfg.calendars = cfg.calendars || [];
    if (action === "connect") {
      const url = String(body.url || "").replace(/\s+/g, "").replace(/^webcal:\/\//i, "https://");
      if (!OK.test(url)) return J({ ok: false, error: "כתובת לא תקינה — צריך את 'הכתובת הסודית בפורמט iCal'" }, 400);
      const t = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!t.ok) return J({ ok: false, error: t.status === 404 ? "גוגל לא מצא את היומן — הכתובת לא הועתקה עד הסוף" : "גוגל החזיר שגיאה " + t.status }, 400);
      const id = body.id || Date.now().toString(36);
      const c = { id, url, workerId: body.workerId ?? null, workerName: body.workerName || "", kind: body.kind === "personal" ? "personal" : "free", from: body.from || todayIL(), syncDeletes: true, label: body.label || "" };
      cfg.calendars = [...cfg.calendars.filter(x => x.id !== id && x.url !== url), c];
      await writeJson("gcal/config.json", cfg);
      const r = await runSync();
      const st = await readJson("gcal/status.json", {});
      return J({ ...r, list: publicCfg(cfg, st) });
    }
    if (action === "update") {
      cfg.calendars = cfg.calendars.map(c => c.id === body.id ? { ...c, ...(body.patch && typeof body.patch === "object" ? Object.fromEntries(Object.entries(body.patch).filter(([k]) => ["paused", "syncDeletes", "workerId", "workerName", "kind", "label"].includes(k))) : {}) } : c);
      await writeJson("gcal/config.json", cfg); const st = await readJson("gcal/status.json", {}); return J({ ok: true, list: publicCfg(cfg, st) });
    }
    if (action === "disconnect") {
      const c = cfg.calendars.find(x => x.id === body.id);
      cfg.calendars = cfg.calendars.filter(x => x.id !== body.id);
      await writeJson("gcal/config.json", cfg);
      let removed = 0;
      if (c && body.removeItems) {
        const pre = "g:" + c.id + ":"; const today = todayIL();
        const { data } = await sb.from("appointments").select("id,data").like("data->>gcalUid", pre + "%");
        const ups = (data || []).map(r => r.data).filter(a => a && !a.deleted && a.date >= today && (a.kind === "free" || a.kind === "personal") && a.status !== "בוצע")
          .map(a => ({ id: String(a.id), data: { ...a, deleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }));
        if (ups.length) { const { error } = await sb.from("appointments").upsert(ups, { onConflict: "id" }); if (error) throw error; removed = ups.length; }
      }
      const st = await readJson("gcal/status.json", {}); return J({ ok: true, removed, list: publicCfg(cfg, st) });
    }
    return J({ ok: false, error: "פעולה לא מוכרת" }, 400);
  } catch (e) { return J({ ok: false, error: String(e.message || e) }, 500); }
});
