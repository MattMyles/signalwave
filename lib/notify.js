// Emails the admin when WRONG GENRE? reports pile up for review: once the
// number waiting goes over REVIEW_ALERT_AT (from 3 to 4 or more), one email
// with the list and a link to /admin. It fires again only after reviews bring
// the count back down and it crosses the line again.
//
// Sent through Resend (resend.com, free tier). Setup, in Vercel env vars:
//   RESEND_API_KEY  the API key from resend.com (required; no key = no emails)
//   NOTIFY_EMAIL    who to email (defaults to the ADMIN_EMAILS addresses)
//   NOTIFY_FROM     sender (defaults to Resend's onboarding@resend.dev, which
//                   can only email the address that owns the Resend account;
//                   verify neoearthradio.com in Resend to send from it)
const { adminEmails } = require('./supabase-env');

const REVIEW_ALERT_AT = 3; // email when more than this many reports are waiting

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const genreName = (id) => String(id || '').replace(/^tag:/, '').replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** Did this batch of new pending reports take the waiting count over the line? */
function crossedLine(before, after) {
  return before <= REVIEW_ALERT_AT && after > REVIEW_ALERT_AT;
}

async function sendReviewAlert(pending, siteUrl) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const to = (process.env.NOTIFY_EMAIL || '').split(/[\s,;]+/).filter(Boolean);
  const recipients = to.length ? to : adminEmails();
  if (!recipients.length) return false;
  const admin = `${String(siteUrl || '').replace(/\/$/, '')}/admin`;
  const rows = pending.slice(0, 20).map((x) => `<tr>
      <td style="padding:6px 10px 6px 0;color:#fcee0a;vertical-align:top">${esc(genreName(x.genre_key))}</td>
      <td style="padding:6px 10px 6px 0;color:#00f0ff;vertical-align:top">${esc(x.station_name || 'Unnamed station')}<br><span style="color:#7a9aa8">${esc([x.city, x.country_code].filter(Boolean).join(', '))}</span></td>
      <td style="padding:6px 0;color:#cfe9f2;vertical-align:top">${esc(x.song || '—')}</td></tr>`).join('');
  const html = `<div style="background:#000;color:#e6f7ff;font-family:Menlo,Consolas,monospace;padding:24px">
    <p style="color:#39ff14;margin:0 0 12px">&gt; ${pending.length} WRONG GENRE REPORTS TO REVIEW</p>
    <p style="margin:0 0 16px;color:#cfe9f2;font-family:-apple-system,Segoe UI,sans-serif">Listeners flagged these signals as the wrong genre. They keep playing for that genre until you agree.</p>
    <table style="border-collapse:collapse;font-size:13px;font-family:-apple-system,Segoe UI,sans-serif">
      <tr style="color:#7a9aa8;text-align:left"><th style="padding:0 10px 6px 0">PICKED</th><th style="padding:0 10px 6px 0">SIGNAL</th><th style="padding:0 0 6px">SONG</th></tr>${rows}
    </table>
    <p style="margin:20px 0 0"><a href="${esc(admin)}" style="background:#fcee0a;color:#000;padding:10px 16px;text-decoration:none;font-weight:bold;font-family:-apple-system,Segoe UI,sans-serif">REVIEW IN THE DASHBOARD</a></p>
  </div>`;
  const text = [`${pending.length} wrong-genre reports to review:`,
    ...pending.slice(0, 20).map((x) => `- ${genreName(x.genre_key)}: ${x.station_name || 'Unnamed'} (${[x.city, x.country_code].filter(Boolean).join(', ')}) — ${x.song || '?'}`),
    '', `Review: ${admin}`].join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || 'NEO // EARTH <onboarding@resend.dev>',
        to: recipients,
        subject: `NEO // EARTH: ${pending.length} wrong-genre reports to review`,
        html,
        text,
      }),
      signal: AbortSignal.timeout(6000),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

module.exports = { REVIEW_ALERT_AT, crossedLine, sendReviewAlert };
