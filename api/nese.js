// NESE member ID and transmissions (stations sent between members).
//   GET  /api/nese                          → { id, number, inbox: [...] }  (assigns an ID on first call)
//   POST /api/nese { action: 'send', to, station: { uuid, name, city, country } }
//   POST /api/nese { action: 'dismiss', id }
// Needs a signed-in user (their access token) and the server-only service key.
// Members only ever see each other's NESE IDs, never emails.
const { serviceEnv, sbHeaders, verifyUser, adminEmails } = require('../lib/supabase-env');
const { sendJson, readJson, bearer } = require('../lib/http');
const { formatNeseId, parseNeseId } = require('../lib/nese');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v, max) => {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

class NotSetUp extends Error {}

async function rpc(env, fn, args) {
  const r = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...sbHeaders(env.key), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(6000),
  });
  if (r.status === 404) throw new NotSetUp(); // migration not run yet
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const SEND_ERRORS = {
  no_such_member: [404, 'No NESE member has that ID.'],
  self: [400, "That's your own ID."],
  rate_limited: [429, 'Transmission limit reached. Try again in an hour.'],
  inbox_full: [409, "That member's inbox is full."],
  not_member: [403, 'You need a NESE ID first.'],
};

module.exports = async function handler(req, res) {
  const env = serviceEnv();
  if (!env) return sendJson(res, 503, { error: 'NESE IDs are not set up on this server.' });
  const user = await verifyUser(bearer(req));
  if (!user) return sendJson(res, 401, { error: 'Sign in first.' });

  try {
    const isAdmin = adminEmails().includes(user.email);
    const number = await rpc(env, 'nese_member', { p_user: user.id, p_admin: isAdmin });

    if (req.method === 'GET') {
      const inbox = (await rpc(env, 'nese_inbox', { p_user: user.id })) || [];
      return sendJson(res, 200, {
        id: formatNeseId(number),
        number,
        inbox: inbox.map((s) => ({ ...s, from: formatNeseId(s.from) || 'NESE-????' })),
      });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'GET or POST only' });

    const body = await readJson(req);
    if (body && body.action === 'send') {
      const to = parseNeseId(body.to);
      const st = body.station || {};
      if (to == null) return sendJson(res, 400, { error: 'Enter a NESE ID like NESE-0007.' });
      if (!UUID.test(String(st.uuid || ''))) return sendJson(res, 400, { error: 'That station can\'t be sent.' });
      const place = [text(st.city, 90), text(st.country, 90)].filter(Boolean).join(', ') || null;
      const result = await rpc(env, 'nese_send', {
        p_from: user.id, p_to: to, p_uuid: String(st.uuid).toLowerCase(), p_name: text(st.name, 200), p_place: place,
      });
      if (result === 'ok') return sendJson(res, 200, { ok: true, to: formatNeseId(to) });
      const [status, error] = SEND_ERRORS[result] || [502, 'Transmission failed.'];
      return sendJson(res, status, { error });
    }
    if (body && body.action === 'dismiss') {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id < 1) return sendJson(res, 400, { error: 'Bad transmission ID.' });
      await rpc(env, 'nese_dismiss', { p_user: user.id, p_id: id });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    if (e instanceof NotSetUp) return sendJson(res, 503, { error: 'NESE database not set up yet.' });
    return sendJson(res, 502, { error: 'NESE network unreachable. Try again.' });
  }
};
