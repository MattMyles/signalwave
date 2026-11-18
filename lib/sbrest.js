// Minimal Supabase REST client for the station shelf (server and scout only;
// uses the service key). No dependencies.
const { sbHeaders } = require('./supabase-env');

function makeDb(env, { timeoutMs = 15000 } = {}) {
  const base = `${env.url}/rest/v1`;
  async function call(method, path, { body, prefer, headers, timeout } = {}) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...sbHeaders(env.key),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
        ...(headers || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout || timeoutMs),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const err = new Error(`Supabase ${method} ${path.split('?')[0]} answered ${r.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      err.status = r.status;
      err.body = text;
      throw err;
    }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    get: (path, opts) => call('GET', path, opts),
    rpc: (fn, args, opts) => call('POST', `/rpc/${fn}`, { body: args || {}, ...opts }),
    insert: (table, rows, opts) => call('POST', `/${table}`, { body: rows, prefer: 'return=representation', ...opts }),
    patch: (path, body, opts) => call('PATCH', path, { body, prefer: 'return=minimal', ...opts }),
    del: (path, opts) => call('DELETE', path, { prefer: 'return=minimal', ...opts }),
    // Insert or update by primary key; every row must carry every column.
    upsert: (table, rows, opts) => call('POST', `/${table}`, { body: rows, prefer: 'resolution=merge-duplicates,return=minimal', ...opts }),
    // Up to `max` rows of a query, in pages (Supabase caps one answer at 1000
    // rows). Give the query a stable order so pages don't overlap.
    async getAll(path, { max = 100000 } = {}) {
      const out = [];
      const sep = path.includes('?') ? '&' : '?';
      for (let offset = 0; offset < max; offset += 1000) {
        const limit = Math.min(1000, max - offset);
        const page = await call('GET', `${path}${sep}limit=${limit}&offset=${offset}`);
        out.push(...page);
        if (page.length < limit) break;
      }
      return out;
    },
  };
}

// True when an error means "the shelf's table or function isn't there yet".
function isMissing(e) {
  if (!e) return false;
  if (e.status === 404) return true;
  return /PGRST20[24]|42P01|42883|does not exist|schema cache/i.test(`${e.body || ''} ${e.message || ''}`);
}

module.exports = { makeDb, isMissing };
