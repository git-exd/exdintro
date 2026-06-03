# .exd — Introduction Deck (gated)

Single-page presentation deck for **.exd**, served behind a credential gate.
Credentials live in a private Google Sheet; every successful login fires an email
notification.

## Stack

- Node.js 20 + Express
- Google Sheet *published as CSV* (no Google Cloud, no API key) for credentials
- Google Apps Script web app bound to the same sheet for writing last-login
- JWT session cookie (httpOnly, signed)
- Deployed on Railway

> ⚠️ The published CSV URL is **publicly readable to anyone who knows it**. Keep
> it secret (don't commit it, don't share it). Use short-lived per-prospect
> passwords. If you need a private credential store, switch to the
> service-account flow (Google Cloud) instead.

## Repository layout

```
exdintro/
├── server.js              # Express app: routes, auth, session cookie, rate limit
├── lib/
│   ├── sheets.js          # Google Sheets client
│   └── email.js           # Resend client
├── views/
│   ├── login.html         # public: the sign-in page
│   └── deck.html          # gated: the actual deck (served only after auth)
├── exd/                   # public: brand assets (CSS, fonts, images, logos)
├── deck-stage.js          # public: <deck-stage> web component
├── package.json
├── railway.json           # Railway build/deploy config
├── .env.example
└── CNAME                  # intro.exdpeople.org
```

## Routes

| Method | Path             | Auth | Purpose                                                |
| ------ | ---------------- | ---- | ------------------------------------------------------ |
| GET    | `/`              | —    | Login page (redirects to `/deck` if already signed in) |
| POST   | `/api/login`     | —    | Validate, set session cookie, send notification email  |
| POST   | `/api/logout`    | —    | Clear session cookie                                   |
| GET    | `/deck`          | yes  | Serve the deck HTML                                    |
| GET    | `/exd/*`         | —    | Brand assets (public)                                  |
| GET    | `/deck-stage.js` | —    | Deck-stage runtime (public)                            |
| GET    | `/healthz`       | —    | Liveness probe for Railway                             |

Only `/deck` is gated. The brand assets are not sensitive.

On `/api/login` success the server also POSTs to the Apps Script web app
(see "Last-login logging") to stamp the user's `Last login` cell in the
sheet. The call is fire-and-forget — a webhook failure logs but never
blocks the login.

## Setup

### 1. Google Sheet

Create a sheet with a tab named **`Users`**. Row 1 is the header; the loader
matches columns by name (case-insensitive).

| email             | password        | name        | company    | industry | Luxardo | Pasticceria Giotto | DAB Pumps | vVardis | Crédit Agricole |
| ----------------- | --------------- | ----------- | ---------- | -------- | ------- | ------------------ | --------- | ------- | --------------- |
| alice@example.com | a-shared-string | Alice Rossi | Example Co | banking  | 3       |                    | 1         |         | 2               |

Only `email` and `password` are required.

- `name`, `company` — appear in the notification email.
- `industry` — personalizes slide 18 ("We track the *banking* industry
  closely."). When empty, falls back to `food`. Accepted column names:
  `industry`, `industria`, `settore`.
- **Case priority columns** (one per case study) — each cell is a positive
  integer. Lower numbers come first. Empty cells leave the case in its
  default position at the end. Accepted column names (case-insensitive):
  `Luxardo`, `Pasticceria Giotto` (or `Giotto`), `DAB Pumps` (or `DAB`),
  `vVardis`, `Crédit Agricole` (or `Credit Agricole`). In the example
  above Alice sees: **DAB Pumps → Crédit Agricole → Luxardo → Pasticceria
  Giotto → vVardis** (the last two keep their default order at the end).

### 2. Publish the sheet as CSV

In the sheet: **File → Share → Publish to the web**.

- **Link** tab → select the *Users* sheet (not "Entire document")
- Format: **Comma-separated values (.csv)**
- Click **Publish**, copy the URL → `SHEET_CSV_URL`

The published URL is independent from the sheet's sharing settings: the sheet
itself can stay restricted to you, while the published copy is publicly readable.
**Treat the URL as a secret** — anyone who has it can download every credential.

The server caches the CSV for 60 seconds, so changes propagate within a minute.

### 3. Last-login logging (Google Apps Script)

The server writes each successful login back to the sheet (column `Last
login`, auto-created on first write) via an Apps Script web app bound to the
sheet.

**Set up the script**

1. Open the credentials Google Sheet.
2. **Extensions → Apps Script** → opens the script editor on a project bound
   to the sheet.
3. Replace the contents of `Code.gs` with:

```javascript
const SHEET_NAME = 'Users';
const EMAIL_HEADER = 'email';
const LAST_LOGIN_HEADER = 'Last login';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('LAST_LOGIN_TOKEN');
    if (!token || body.token !== token) {
      return jsonOut({ error: 'unauthorized' });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const timestamp = body.timestamp || new Date().toISOString();
    if (!email) return jsonOut({ error: 'missing email' });

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return jsonOut({ error: 'sheet not found: ' + SHEET_NAME });
    const data = sheet.getDataRange().getValues();
    if (data.length < 1) return jsonOut({ error: 'sheet is empty' });

    const header = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const emailIdx = header.indexOf(EMAIL_HEADER.toLowerCase());
    if (emailIdx === -1) return jsonOut({ error: 'email column not found' });
    let lastIdx = header.indexOf(LAST_LOGIN_HEADER.toLowerCase());
    if (lastIdx === -1) {
      lastIdx = header.length;
      sheet.getRange(1, lastIdx + 1).setValue(LAST_LOGIN_HEADER);
    }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailIdx] || '').trim().toLowerCase() === email) {
        sheet.getRange(i + 1, lastIdx + 1).setValue(timestamp);
        return jsonOut({ ok: true });
      }
    }
    return jsonOut({ error: 'user not found: ' + email });
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. **Project Settings** (the gear icon, left sidebar) → scroll to **Script
   Properties** → **Add script property**. Name `LAST_LOGIN_TOKEN`, value a
   random string (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
   Save.
5. **Deploy → New deployment** → type **Web app**.
   - Description: `last-login webhook`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, authorize when prompted, copy the **Web app URL**.

**Wire it to the server**

Set both variables in Railway (and `.env` locally if you test):

- `LAST_LOGIN_WEBHOOK_URL` → the Web app URL from step 5.
- `LAST_LOGIN_TOKEN` → the same token you put in script properties.

Both empty → logging is disabled (the server prints a `[log] skipped` line
in the console on every login and continues).

> Note: if you later edit the script, you must **Deploy → Manage
> deployments → edit → New version**. The URL stays the same.

### 4. Local dev

```bash
cp .env.example .env       # then fill the values
npm install
npm run dev                # auto-reloads on file changes
```

Open <http://localhost:3000/>.

### 5. Deploy to Railway

1. Push to GitHub.
2. On Railway: **New Project → Deploy from GitHub repo → exdintro**.
3. Set all the env vars from `.env.example` in the Railway service.
4. Wait for the first deploy.
5. (Optional) **Settings → Domains → Custom Domain → `intro.exdpeople.org`**.
   Update the DNS at the registrar: replace the GitHub Pages CNAME with the
   Railway-provided target.

## Operational notes

- **Rate limit**: 8 login attempts per 15 minutes per IP.
- **Session length**: configurable via `SESSION_DAYS`, default `7`.
- **Cache for the deck**: served with `Cache-Control: no-store` so a revoked
  user can't reopen from disk cache.
- **Adding a user**: edit the Google Sheet — no redeploy needed; the sheet is
  fetched on every login attempt.
- **Removing a user**: deleting the row prevents new logins; sessions already
  issued remain valid until the JWT expires. Rotate `JWT_SECRET` to invalidate
  every active session at once.

## Keyboard (inside the deck)

`→` / `Space` / `PageDown` — next · `←` / `PageUp` — previous ·
`Home` / `End` — first / last · `R` — reset · `1`–`9` — jump to slide
