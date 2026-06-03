# .exd — Introduction Deck (gated)

Single-page presentation deck for **.exd**, served behind a credential gate.
Credentials live in a private Google Sheet; every successful login fires an email
notification.

## Stack

- Node.js 20 + Express
- Google Sheet *published as CSV* (no Google Cloud, no API key)
- Resend for email
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

## Setup

### 1. Google Sheet

Create a sheet with a tab named **`Users`**. Row 1 is the header; the loader
matches columns by name (case-insensitive).

| email             | password        | name        | company    | industry |
| ----------------- | --------------- | ----------- | ---------- | -------- |
| alice@example.com | a-shared-string | Alice Rossi | Example Co | banking  |

Only `email` and `password` are required.

- `name`, `company` — appear in the notification email.
- `industry` — personalizes slide 18 ("We track the *banking* industry
  closely."). When empty, falls back to `food`. Accepted column names:
  `industry`, `industria`, `settore`.

### 2. Publish the sheet as CSV

In the sheet: **File → Share → Publish to the web**.

- **Link** tab → select the *Users* sheet (not "Entire document")
- Format: **Comma-separated values (.csv)**
- Click **Publish**, copy the URL → `SHEET_CSV_URL`

The published URL is independent from the sheet's sharing settings: the sheet
itself can stay restricted to you, while the published copy is publicly readable.
**Treat the URL as a secret** — anyone who has it can download every credential.

The server caches the CSV for 60 seconds, so changes propagate within a minute.

### 3. Resend

1. Sign up at <https://resend.com/>.
2. Add and verify the sending domain (e.g. `exdpeople.org`).
3. Create an API key → `RESEND_API_KEY`.
4. Set `NOTIFY_FROM` to a verified address on that domain, `NOTIFY_TO` to the
   inbox that should receive the alerts.

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

## Print to PDF

Browser **Print → Save as PDF**. The `<deck-stage>` component lays out each
slide as a full page at 1920×1080.
