# הדברה 360 — CRM (map for future edits)

Single-page app: `index.html` (React 18 + Babel in the browser, no build step). Hosted on GitHub Pages.
All text in the UI is Hebrew (RTL). Mobile-first, white with sky-blue/green.
Phone (<900px) = clean, minimal (extra actions behind +, explanations only with 💡). Desktop (`useWide()`) = use the width: side-by-side panels (e.g. exec log form + history), all buttons visible.

## Release checklist
1. Bump `APP_BUILD` in `index.html` **and** the cache name `hadbara360-vNNN` in `sw.js` (same number).
2. Syntax check (Babel parse) before committing.
3. Commit, push, check `gh run list -L 1` (Pages deploy).

## Where things live in `index.html` (search by name — line numbers drift)
| Area | Names to search |
|---|---|
| App shell, tabs, nav, back button, sync | `function App(`, `TABS`, `h360CloseTop`, `goBack`, `window.__h360Nav` |
| Calendar (main screen) | `function WeekCalendar(`, `saveLog`, `invAppt`, `showNew` |
| Work order / new appointment | `function OrderForm(`, `waParse`, `IntakeTextBox`, `window.__h360PendingOrder` |
| Quick entry / task | `FreeNoteForm`, `QuickAddModal`, `PersonalTaskForm`, `parseTask` |
| Exec log (יומן ביצוע) | `function ExecLogForm(`, `applySmart`, `ExecSmartFill`, `elParse`, `ExecLogModalInline`, `execLogHtml` |
| Instructions presets | `INSTR_BASE`, `INSTR_BY_PEST`, `INSTR_PETS`, `INSTR_BABY`, `INSTR_RODENT_BAIT` |
| Monitoring findings | `MONITOR_SIGNS`, `monitorSigns`, `monitorText` |
| Invoices / receipts | `function DocModal(`, `printDoc`, `docPrefillFromLog`, `LOG_PAY_TO_DOC`, `PAY_METHODS_DOC` |
| Customers | `custSuggest`, `custFindByPhone`, `ensureCustomerFor`, `custMergeData`, `custDocName` |
| Voice input | `MicButton` → edge function `transcribe` |

## AI assistant (🎙️ עוזר)
- Client (in `index.html`): `aiAssist` (calls the server), `aiNorm` (normalises + **zero-guessing guards**: `aiSaid`, `aiNumSaid`),
  `AssistantModal` (modes: log / invoice / appt, `AI_SCRIPTS` cheat-sheet, customer matching `aiCustScore`),
  `AiFillSummary` (filled / not said box in drafts), history: `aiHistAdd`, `aiHistUpd`, `AssistantHistory` (tab `aihist`, stored per device in localStorage `h360_ai_hist`).
- Server: `supabase/functions/assistant/index.ts` — Gemini Flash, JSON schema output, needs a logged-in user.
  Key is the Supabase secret `GEMINI_API_KEY` (never in code). Only sends today's appointments + ≤15 matching customers + lists; no chat history.
- Opened from anywhere: event `h360aiopen` (button `AiAssistBtn` next to every 🧠 smart fill — `SmartTitle`); App renders `AssistantModal`; drafts are opened in the calendar via event `h360aiact` (log / inv / appt). Shared memory `AI_MEM`.
- Explanations use class `h360-hint` (shown only when the 💡 lamp is on).
- Rule: the assistant **never saves or sends** — it only opens drafts; the user approves.
- Rule: **zero guessing** — a field is filled only if it was said (warranty only with the word "אחריות", price only if the number was said, notes only after "הערות").

## Edge functions (`supabase/functions/`)
`assistant` (AI drafts), `transcribe` (voice → text), `gcal`, `gcal-sync` (Google Calendar).
Deploy: Supabase Management API `POST /v1/projects/<ref>/functions/deploy?slug=<name>` (multipart: metadata + index.ts).

## Never
- Put secrets, keys or customer data in the repo.
- Change Supabase permissions/DNS/account settings — the owner does that.
- Delete data permanently.
