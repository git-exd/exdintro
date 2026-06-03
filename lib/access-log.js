// Records the last successful login of each user directly into the Google
// Sheet, via a bound Apps Script web app. See README → "Last-login logging"
// for the script and deployment steps.
//
// Failures are non-fatal for the caller — the server logs an error but the
// login flow proceeds. Calling code is expected to swallow the rejection.

export function lastLoginEnabled() {
  return Boolean(process.env.LAST_LOGIN_WEBHOOK_URL && process.env.LAST_LOGIN_TOKEN);
}

export async function logLastAccess({ user }) {
  if (!lastLoginEnabled()) {
    console.log(`[log] skipped (no webhook configured) — login by ${user.email}`);
    return;
  }
  const res = await fetch(process.env.LAST_LOGIN_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: process.env.LAST_LOGIN_TOKEN,
      email: user.email,
      timestamp: new Date().toISOString(),
    }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`webhook ${res.status} ${res.statusText}`);
  const body = await res.json().catch(() => ({}));
  if (body && body.error) throw new Error(`webhook reported: ${body.error}`);
}
