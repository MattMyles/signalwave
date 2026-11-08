// NESE member IDs: number 7 is shown as "NESE-0007". Bigger numbers just grow.
function formatNeseId(n) {
  return Number.isInteger(n) && n >= 0 ? `NESE-${String(n).padStart(4, '0')}` : null;
}

// Accepts what people actually type: "NESE-0007", "nese 7", "#7", "0007", "7".
function parseNeseId(text) {
  const m = /^\s*(?:nese)?\s*[-#:]?\s*(\d{1,7})\s*$/i.exec(String(text == null ? '' : text));
  return m ? Number(m[1]) : null;
}

module.exports = { formatNeseId, parseNeseId };
