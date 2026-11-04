// The link to the original post, kept only as a reference for the user. It is never fetched, never scraped and never
// sent to the model. This file only checks that it is a plain web address and tidies it.
const MAX_LENGTH = 2048;

const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|igsh|igshid|mc_cid|mc_eid|ref_src|ref_url)$/i;
// X and Twitter add s and t to shared links as tracking.
const X_HOST = /^(x|twitter)\.com$/;

const PLATFORMS = [
  ["x", /^(x|twitter)\.com$/],
  ["linkedin", /(^|\.)linkedin\.com$|^lnkd\.in$/],
  ["instagram", /(^|\.)instagram\.com$|^instagr\.am$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["threads", /(^|\.)threads\.(net|com)$/],
  ["facebook", /(^|\.)facebook\.com$|^fb\.watch$|^fb\.com$/],
  ["youtube", /(^|\.)youtube\.com$|^youtu\.be$/],
  ["reddit", /(^|\.)reddit\.com$|^redd\.it$/],
];

export function platformOf(host) {
  for (const [name, pattern] of PLATFORMS) if (pattern.test(host)) return name;
  return "web";
}

/**
 * Returns { ok: true, url: null } for an empty value, { ok: true, url, host, platform } for a good address,
 * or { ok: false, reason: "invalid_link" }. Only http and https, no sign in details, no fragment, no tracking.
 */
export function cleanPostLink(raw) {
  if (raw === undefined || raw === null) return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false, reason: "invalid_link" };
  const text = raw.trim();
  if (!text) return { ok: true, url: null };
  if (text.length > MAX_LENGTH || /\s/.test(text)) return { ok: false, reason: "invalid_link" };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "invalid_link" };
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return { ok: false, reason: "invalid_link" };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || host.endsWith(".")) return { ok: false, reason: "invalid_link" };
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name) || (X_HOST.test(host) && (name === "s" || name === "t"))) url.searchParams.delete(name);
  }
  url.hash = "";
  const clean = url.toString();
  if (clean.length > MAX_LENGTH) return { ok: false, reason: "invalid_link" };
  return { ok: true, url: clean, host, platform: platformOf(host) };
}

/** The shape the API returns for a stored link. Null when there is none or it no longer passes the check. */
export function linkView(stored) {
  const result = cleanPostLink(stored);
  return result.ok && result.url ? { url: result.url, host: result.host, platform: result.platform } : null;
}
