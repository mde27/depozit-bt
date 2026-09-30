/**
 * Backfill smiss_catalog.locatie from the RAPORT_SMISS CSVs.
 *
 * Does NOT talk to D1. It writes chunked UPDATE statements you apply later:
 *
 *   node scripts/backfill-smiss-locatie.mjs \
 *     --csv-dir /path/to/csvs \
 *     --out scripts/backfill-locatie-sql
 *
 *   npx wrangler d1 execute depozit-bt --remote --file=migrations/0004_smiss_locatie.sql
 *   for f in scripts/backfill-locatie-sql/locatie_*.sql; do
 *     npx wrangler d1 execute depozit-bt --remote --file="$f"
 *   done
 *
 * Keyed by MIJLOC_FIX (smiss_catalog primary key). Empty LOCATIE is skipped.
 * If the same mijloc_fix has several different locations (only RAPORT_SMISS_01
 * duplicates, ~27 codes), they are stored together, sorted, separated by " / ".
 *
 * Column is LOCATIE in both reports (column T on RAPORT_SMISS_80, column AC
 * on RAPORT_SMISS_01). Files are Windows-1250.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const CSV_DIR = argValue(
  "--csv-dir",
  fs.existsSync(path.join(ROOT, "..", "product-catalog"))
    ? path.join(ROOT, "..", "product-catalog")
    : path.join(path.dirname(ROOT), "smiss-import")
);
const OUT_DIR = argValue("--out", path.join(ROOT, "scripts", "backfill-locatie-sql"));
const CHUNK = Number(argValue("--chunk", "400"));

const CSV_FILES = [
  "RAPORT_SMISS_80_branch_0000_20260831.csv",
  "RAPORT_SMISS_01_branch_0000_20260831.csv",
];

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  const isDelim = (ch) => ch === undefined || ch === "," || ch === "\n" || ch === "\r";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const n1 = line[i + 1];
        const n2 = line[i + 2];
        // SMISS sometimes leaves an inch-mark quote unescaped: 27"" ,
        // which is a literal quote and the end of the field. An empty field is "".
        if (n1 === '"' && isDelim(n2)) {
          if (cur.length > 0) cur += '"';
          inQuotes = false;
          i++;
          continue;
        }
        if (n1 === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function sqlEsc(s) {
  return String(s).replace(/'/g, "''");
}

function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1250").decode(buf);
  }
}

function readLocatii(filePath) {
  const text = readText(filePath);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  if (idx.MIJLOC_FIX == null || idx.LOCATIE == null) {
    throw new Error(`Need MIJLOC_FIX and LOCATIE in ${path.basename(filePath)}`);
  }
  const byFix = new Map();
  let rows = 0;
  let filled = 0;
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    const fix = String(cols[idx.MIJLOC_FIX] || "").trim();
    if (!fix) continue;
    rows++;
    const loc = String(cols[idx.LOCATIE] || "").trim();
    if (!loc) continue;
    filled++;
    if (!byFix.has(fix)) byFix.set(fix, new Set());
    byFix.get(fix).add(loc);
  }
  return { byFix, rows, filled };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".sql")) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const merged = new Map();
  for (const name of CSV_FILES) {
    const full = path.join(CSV_DIR, name);
    if (!fs.existsSync(full)) throw new Error(`CSV not found: ${full}`);
    const { byFix, rows, filled } = readLocatii(full);
    console.log(`${name}: ${rows} rows, ${filled} with LOCATIE, ${byFix.size} codes`);
    for (const [fix, set] of byFix) {
      if (!merged.has(fix)) merged.set(fix, new Set());
      for (const v of set) merged.get(fix).add(v);
    }
  }

  const updates = [...merged.entries()]
    .map(([fix, set]) => ({ fix, locatie: [...set].sort().join(" / ") }))
    .filter((r) => r.locatie)
    .sort((a, b) => a.fix.localeCompare(b.fix, "en"));

  const multi = updates.filter((r) => r.locatie.includes(" / ")).length;
  console.log(`UPDATE rows: ${updates.length} (${multi} with more than one location)`);

  const files = [];
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    const body = slice
      .map(
        (r) =>
          `UPDATE smiss_catalog SET locatie = '${sqlEsc(r.locatie)}' WHERE mijloc_fix = '${sqlEsc(r.fix)}';`
      )
      .join("\n");
    const n = String(files.length + 1).padStart(3, "0");
    const fname = `locatie_${n}.sql`;
    fs.writeFileSync(path.join(OUT_DIR, fname), body + "\n", "utf8");
    files.push(fname);
  }

  const chair = updates.find((r) => r.fix === "1091229");
  console.log("1091229 locatie:", chair ? chair.locatie : "(not in CSV)");
  console.log(`Wrote ${files.length} files to ${OUT_DIR}`);
}

main();
