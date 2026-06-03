import { Resend } from 'resend';

let client = null;
function getClient() {
  if (client) return client;
  client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

// Returns false when notifications are not configured — the caller treats that
// as "skip, don't fail the login". Returns true on success.
export function notificationsEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM && process.env.NOTIFY_TO);
}

export async function notifyLogin({ user, ip, userAgent }) {
  if (!notificationsEnabled()) {
    console.log(`[notify] skipped (no Resend config) — login by ${user.email}`);
    return;
  }
  const from = process.env.NOTIFY_FROM;
  const to = process.env.NOTIFY_TO;

  const when = new Date().toISOString();
  const lines = [
    `${user.name || user.email} ha appena aperto il deck.`,
    '',
    `Email: ${user.email}`,
    user.name ? `Nome: ${user.name}` : null,
    user.company ? `Azienda: ${user.company}` : null,
    `Quando: ${when}`,
    `IP: ${ip || 'unknown'}`,
    `User-Agent: ${userAgent || 'unknown'}`,
  ].filter(Boolean);

  const subject = `Login deck .exd — ${user.name || user.email}`;
  await getClient().emails.send({
    from,
    to,
    subject,
    text: lines.join('\n'),
  });
}
