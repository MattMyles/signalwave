// GET /api/genre-counts?genre=metal
// Station counts for a main genre and each of its styles, for the genre editor:
//   counts[id] = { n, more, verified }
//   verified  stations on the shelf that the scout has checked and that qualify for the
//             genre (what can really play), or null when the shelf isn't set up
//   n, more   candidate stations the directory lists (secure stream and a place); an upper
//             bound, since some fail the live checks. `more` means the search hit its cap ("300+").
// See lib/genrecounts.js. Directory counts stay a day in server memory; the response itself
// is cached for 15 minutes so the verified numbers are never more than ~30 minutes old.
const { GENRES, STYLES } = require('../lib/config');
const { genreCounts } = require('../lib/genrecounts');
const { query, sendJson } = require('../lib/http');

module.exports = async function handler(req, res) {
  const genre = String(query(req).get('genre') || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!GENRES[genre] || !STYLES[genre]) return sendJson(res, 400, { error: 'Unknown genre.' });
  const counts = await genreCounts(genre).catch(() => null);
  if (!counts) return sendJson(res, 502, { error: 'The directory did not answer.' });
  sendJson(res, 200, { genre, counts }, 0, 'public, max-age=300, s-maxage=900, stale-while-revalidate=900');
};
