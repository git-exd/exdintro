// Reads users from a Google Sheet "Published to the web" as CSV.
//
// To get the URL:
//   Google Sheets → File → Share → Publish to the web
//   Select the "Users" tab, format "Comma-separated values (.csv)"
//   Copy the URL into SHEET_CSV_URL.
//
// Expected columns (header on row 1): email | password | name | company | industry
//   - `industry` is optional. When set, it personalizes slide 18 ("We track
//     the {industry} industry closely"). Empty → defaults to "food".

const CACHE_TTL_MS = 60 * 1000;
let cache = { fetchedAt: 0, users: [] };

// Minimal RFC-4180-aware CSV parser: handles quoted fields and escaped quotes.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip; \n on the next char will close the row
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

async function loadUsersFromSheet() {
  const url = process.env.SHEET_CSV_URL;
  if (!url) throw new Error('SHEET_CSV_URL is not set');

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    email: header.findIndex((h) => h === 'email'),
    password: header.findIndex((h) => h === 'password' || h === 'pass'),
    name: header.findIndex((h) => h === 'name' || h === 'nome'),
    company: header.findIndex((h) => h === 'company' || h === 'azienda'),
    industry: header.findIndex((h) => h === 'industry' || h === 'industria' || h === 'settore'),
  };
  if (idx.email === -1 || idx.password === -1) {
    throw new Error('Sheet must contain at least "email" and "password" columns');
  }
  return rows.slice(1)
    .map((r) => ({
      email: (r[idx.email] || '').trim().toLowerCase(),
      password: (r[idx.password] || '').toString(),
      name: idx.name >= 0 ? (r[idx.name] || '').trim() : '',
      company: idx.company >= 0 ? (r[idx.company] || '').trim() : '',
      industry: idx.industry >= 0 ? (r[idx.industry] || '').trim() : '',
    }))
    .filter((u) => u.email && u.password);
}

async function fetchUsers() {
  const now = Date.now();
  if (now - cache.fetchedAt < CACHE_TTL_MS) return cache.users;
  const users = await loadUsersFromSheet();
  cache = { fetchedAt: now, users };
  return users;
}

export async function findUser(email, password) {
  const target = (email || '').trim().toLowerCase();
  const users = await fetchUsers();
  return users.find((u) => u.email === target && u.password === password) || null;
}
