// Pre-publish safety audit. Run before making the repo public: node scripts/prepublish-check.mjs
// Exits 1 if anything blocks publishing. Never prints a secret value, only where it was found.
//
// Checks:
// 1. Forbidden files (.env, databases, token or credential files) tracked now, staged, OR in any commit of any ref.
// 2. Secret patterns (Google tokens and client secrets, private keys, token JSON fields) in tracked files and in
//    every line ever added in git history.
// 3. The literal values from your local .env, searched in tracked files and history. This catches keys whose
//    format we do not know (Baseten), because we never guess a key format.
// 4. .gitignore covers .env, .env.*, databases, server/data/, agent notes (CLAUDE.md, AGENTS.md, .claude/), web/dist/
//    and web/artifacts/, and does NOT ignore .env.example.
// 5. Every image in fixtures/ is approved in fixtures/APPROVED.json with its sha256. This script cannot tell if a
//    screenshot is blurred, so approval is your decision. Editing an image changes its hash and needs re-approval.
//
// Limits: it scans refs reachable with --all. Dangling objects and the reflog are not pushed by git push, so they
// are not scanned. It cannot detect personal data inside images.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const gitOk = (...args) => {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const list = (out) => out.split("\0").filter(Boolean);
const failures = [];
const warnings = [];
const fail = (section, msg) => failures.push(`[${section}] ${msg}`);
const warn = (section, msg) => warnings.push(`[${section}] ${msg}`);

const FORBIDDEN_PATHS = [
  { name: "env file", re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/ },
  { name: "database", re: /\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3|sqlite-wal|sqlite-shm)$/i },
  { name: "app data dir", re: /^server\/data\// },
  { name: "credentials file", re: /(^|\/)(credentials|client_secret[^/]*|tokens?|service[-_]account[^/]*)\.json$/i },
  { name: "private key file", re: /\.(pem|p12|key)$/i },
];
const SECRET_PATTERNS = [
  { name: "Google OAuth access token", re: /ya29\.[0-9A-Za-z_-]{20,}/ },
  { name: "Google OAuth refresh token", re: /1\/\/0[0-9A-Za-z_-]{20,}/ },
  { name: "Google OAuth client secret", re: /GOCSPX-[0-9A-Za-z_-]{10,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "token or secret JSON field with a value", re: /"(refresh_token|access_token|id_token|client_secret|api_key)"\s*:\s*"[^"\s]{8,}"/i },
  { name: "Bearer token literal", re: /Bearer\s+(?!\$|\{|<)[A-Za-z0-9._~+/-]{24,}/ },
  { name: "secret assignment with a value", re: /\b[A-Z0-9_]*(API_KEY|CLIENT_SECRET|REFRESH_TOKEN|ACCESS_TOKEN)\s*=\s*['"]?(?!\$|<|your|xxx|changeme)[A-Za-z0-9._/+-]{12,}/ },
];

// Values from the local .env, never printed. URLs and short values are skipped.
const envValues = [];
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^['"]|['"]$/g, "");
    if (value.length >= 12 && !/^https?:\/\//.test(value) && /SECRET|KEY|TOKEN|CLIENT_ID/.test(m[1])) envValues.push({ key: m[1], value });
  }
}

function scanLine(line, where) {
  const hits = [];
  for (const p of SECRET_PATTERNS) if (p.re.test(line)) hits.push(`${where} matches ${p.name}`);
  for (const e of envValues) if (line.includes(e.value)) hits.push(`${where} contains the value of ${e.key} from your .env`);
  return hits;
}
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

function scanFile(f, section) {
  const abs = path.join(root, f);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return;
  const buf = fs.readFileSync(abs);
  if (isBinary(buf)) return;
  buf.toString("utf8").split("\n").forEach((line, i) => scanLine(line, `${f}:${i + 1}`).forEach((h) => fail(section, h)));
}

// Tracked files, as they are on disk now.
const tracked = list(git("ls-files", "-z"));
for (const f of tracked) {
  for (const p of FORBIDDEN_PATHS) if (p.re.test(f)) fail("tracked", `${f} is tracked (${p.name}). Untrack it: git rm --cached "${f}"`);
  scanFile(f, "tracked");
}

// Untracked and not ignored: a careless "git add ." would publish these, so their names and contents count too.
const untracked = list(git("ls-files", "--others", "--exclude-standard", "-z"));
for (const f of untracked) {
  for (const p of FORBIDDEN_PATHS) if (p.re.test(f)) fail("untracked", `${f} is not ignored (${p.name})`);
  scanFile(f, "untracked");
}

// Staged counts too: it is what the next commit publishes.
for (const f of list(git("diff", "--cached", "--name-only", "-z"))) for (const p of FORBIDDEN_PATHS) if (p.re.test(f)) fail("staged", `${f} is staged (${p.name})`);

// Every commit on every ref.
let commitCount = 0;
if (gitOk("rev-parse", "--verify", "HEAD")) {
  commitCount = Number(git("rev-list", "--all", "--count").trim());
  const everPaths = new Set(git("log", "--all", "--name-only", "--pretty=format:").split("\n").filter(Boolean));
  for (const f of everPaths) for (const p of FORBIDDEN_PATHS) if (p.re.test(f)) fail("history", `${f} appears in history (${p.name})`);

  // Every line ever added. --text so a committed binary with an embedded token is still read.
  const patch = git("log", "--all", "-p", "--text", "--no-color", "--unified=0", "--no-ext-diff", "--pretty=format:@@COMMIT %H");
  let commit = null;
  let file = null;
  let lineNo = 0;
  const seen = new Set();
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@COMMIT ")) commit = line.slice(9, 17);
    else if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
    else if (line.startsWith("@@ ")) lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 1) - 1;
    else if (line.startsWith("+")) {
      lineNo++;
      for (const h of scanLine(line.slice(1), `commit ${commit} ${file}:${lineNo}`)) if (!seen.has(h)) fail("history", (seen.add(h), h));
    }
  }
}

// .gitignore coverage. --no-index answers "would this path be ignored", tracked or not.
const ignored = (p) => gitOk("check-ignore", "-q", "--no-index", p);
for (const p of [".env", ".env.local", ".env.production", "server/data/savedtoaction.db", "x.db", "x.db-wal", "x.db-shm", "x.sqlite", "x.sqlite3", "server/data/screenshots/a.png", "CLAUDE.md", "web/CLAUDE.md", "AGENTS.md", "web/AGENTS.md", ".claude/settings.json", "web/dist/index.html", "web/artifacts/home/a.png"])
  if (!ignored(p)) fail("gitignore", `${p} would NOT be ignored`);
if (ignored(".env.example")) fail("gitignore", ".env.example is ignored, the empty template would be missing from the repo");

// Fixtures approval.
const IMAGE = /\.(png|jpe?g|webp|gif|heic|bmp)$/i;
const fixturesDir = path.join(root, "fixtures");
const approvedFile = path.join(fixturesDir, "APPROVED.json");
let fixtureImages = [];
if (fs.existsSync(fixturesDir)) {
  fixtureImages = fs.readdirSync(fixturesDir, { recursive: true }).map(String).filter((f) => IMAGE.test(f)).sort();
  let approved = {};
  if (fs.existsSync(approvedFile)) {
    try {
      approved = JSON.parse(fs.readFileSync(approvedFile, "utf8"));
    } catch {
      fail("fixtures", "fixtures/APPROVED.json is not valid JSON");
    }
  }
  for (const f of fixtureImages) {
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(fixturesDir, f))).digest("hex");
    const a = approved[f];
    if (!a) fail("fixtures", `fixtures/${f} is NOT approved. Once you have checked it is blurred or safe, add to fixtures/APPROVED.json: "${f}": { "sha256": "${sha256}", "blurred": true, "approvedBy": "<you>" }`);
    else if (a.sha256 !== sha256) fail("fixtures", `fixtures/${f} changed since approval (sha256 differs), re-approve it`);
  }
} else {
  warn("fixtures", "no fixtures/ folder yet, nothing to approve");
}

// Images outside fixtures/ that are tracked or would be added: not a failure, but check them by eye.
const candidates = [...tracked, ...untracked];
const otherImages = candidates.filter((f) => IMAGE.test(f) && !f.startsWith("fixtures/"));
if (otherImages.length) warn("images", `images outside fixtures/ that are tracked or not ignored (check by eye): ${otherImages.join(", ")}`);
if (!envValues.length) warn("env", "no .env secret values loaded, the literal value search did not run");

console.log(
  `Pre-publish check: ${tracked.length} tracked files, ${commitCount} commit(s) on all refs, ${envValues.length} .env secret value(s) searched for, ${fixtureImages.length} fixture image(s)`,
);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(failures.length ? `\nBLOCKED: ${failures.length} problem(s). Do not publish.` : "\nPASS: nothing found that blocks publishing.");
process.exitCode = failures.length ? 1 : 0;
