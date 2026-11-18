// GET /api/station?uuid=<stationuuid> — details for one station, for adding a
// shared station to someone's saved list. Unlike /api/next this doesn't
// require song titles: the person chose this station on purpose.
const { stationByUuid } = require('../lib/radio');
const { locateStation } = require('../lib/geo');
const { probeStream } = require('../lib/icy');
const { rememberStream, splitTags } = require('../lib/vet');
const { poolLookup } = require('../lib/pool');
const { isIcecastId } = require('../lib/shelf');
const { query, sendJson } = require('../lib/http');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A station from the shelf: its location is already known.
async function sendShelfStation(res, row) {
  if (!/^https:\/\//.test(row.url)) return sendJson(res, 422, { error: "That station's stream isn't secure (HTTPS), so it can't play here." });
  const p = await probeStream(row.url);
  const tags = splitTags(row.tags);
  rememberStream(row.uuid, row.url);
  sendJson(res, 200, {
    station: {
      uuid: row.uuid,
      name: String(row.name || '').replace(/\s+/g, ' ').trim() || 'Unnamed station',
      url: row.url,
      favicon: /^https:\/\//.test(row.favicon || '') ? row.favicon : null,
      tags,
      genre: tags.slice(0, 2).join(' / ') || null,
      city: row.city || null, // null: only the country is known (region may name its state)
      region: row.city ? null : (row.region || null),
      country: row.country || 'Unknown',
      countryCode: row.country_code || null,
      lat: row.lat, lng: row.lng,
      bitrate: p.bitrate || row.bitrate || null,
      codec: row.codec || null,
      cors: Boolean(p.cors),
      lastSong: p.ok && p.title ? p.title : null,
      live: Boolean(p.ok),
    },
  }, 300);
}

module.exports = async function handler(req, res) {
  const uuid = (query(req).get('uuid') || '').trim();
  if (!UUID.test(uuid)) return sendJson(res, 400, { error: "That doesn't look like a Neo Earth Radio station link." });
  // Stations only the Icecast directory knows are on the station shelf, not in
  // Radio Browser; the shelf is also the fallback for a station the
  // directory no longer lists (or can't be reached about).
  let s = null;
  let row = isIcecastId(uuid) ? await poolLookup(uuid) : null;
  let directoryDown = false;
  if (!row) {
    try { s = await stationByUuid(uuid); } catch (_) { directoryDown = true; }
    if (!s || !s.url_resolved) { s = null; row = await poolLookup(uuid); }
  }
  if (row) return sendShelfStation(res, row);
  if (directoryDown) return sendJson(res, 502, { error: 'The station directory did not answer. Try again in a moment.' });
  if (!s) return sendJson(res, 404, { error: 'That station is no longer in the directory.' });
  if (!s.url_resolved.startsWith('https://')) return sendJson(res, 422, { error: "That station's stream isn't secure (HTTPS), so it can't play here." });

  const cc = (s.countrycode || '').toUpperCase() || null;
  // Its coordinates, else a city from its region, name, tags or addresses, else
  // its country (city null, region = its state when it lists a usable one).
  let where = await locateStation(s);
  // A shared link is a deliberate choice, so a station with its own coordinates but no
  // usable country is still shown at those coordinates.
  const ownLat = s.geo_lat != null ? Number(s.geo_lat) : NaN;
  const ownLng = s.geo_long != null ? Number(s.geo_long) : NaN;
  if (!where && Number.isFinite(ownLat) && Number.isFinite(ownLng) && !(ownLat === 0 && ownLng === 0)) where = { city: null, region: null, lat: ownLat, lng: ownLng };
  if (!where || !Number.isFinite(where.lat) || !Number.isFinite(where.lng)) return sendJson(res, 422, { error: "That station has no location, so it can't be shown on the globe." });
  const { lat, lng } = where;
  const city = where.city || null;
  const region = city ? null : (where.region || null);

  const p = await probeStream(s.url_resolved);
  const tags = splitTags(s.tags);
  rememberStream(s.stationuuid, s.url_resolved);
  sendJson(res, 200, {
    station: {
      uuid: s.stationuuid,
      name: String(s.name || '').replace(/\s+/g, ' ').trim() || 'Unnamed station',
      url: s.url_resolved,
      favicon: /^https:\/\//.test(s.favicon || '') ? s.favicon : null,
      tags,
      genre: tags.slice(0, 2).join(' / ') || null,
      city,
      region,
      country: s.country || 'Unknown',
      countryCode: cc,
      lat, lng,
      bitrate: p.bitrate || s.bitrate || null,
      codec: s.codec || null,
      cors: Boolean(p.cors),
      lastSong: p.ok && p.title ? p.title : null,
      live: Boolean(p.ok),
    },
  }, 300);
};
