/**
 * Build SMISS catalog seed SQL/JSON from the two RAPORT_SMISS CSV files.
 *
 * Usage:
 *   node scripts/build-smiss-import.mjs
 *   node scripts/build-smiss-import.mjs --csv-dir "C:/Users/lilly/Desktop/smiss-import"
 *
 * Outputs:
 *   migrations/smiss-seed/*.sql   (chunked INSERTs)
 *   migrations/smiss-seed/smiss_catalog.jsonl
 *   migrations/smiss-seed/README.md
 *   Desktop/smiss-catalog-sql.zip  (zip of seed SQL for manual D1 apply)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const CSV_DIR = argValue(
  "--csv-dir",
  path.join(path.dirname(ROOT), "smiss-import")
);
const OUT_DIR = path.join(ROOT, "migrations", "smiss-seed");
const CHUNK = Number(argValue("--chunk", "300"));
const DESKTOP_ZIP = path.join(path.dirname(ROOT), "smiss-catalog-sql.zip");

const CSV_FILES = [
  "RAPORT_SMISS_80_branch_0000_20260831.csv",
  "RAPORT_SMISS_01_branch_0000_20260831.csv",
];

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
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
  if (s == null || s === "") return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function normalizeFix(v) {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeOrig(v) {
  if (v == null) return "";
  let s = String(v).trim();
  // Excel-style leading apostrophe
  if (s.startsWith("'")) s = s.slice(1).trim();
  return s;
}

function readCsv(filePath, sourceReport) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const need = [
    "MIJLOC_FIX",
    "MIJLOC_FIX_ORIG",
    "CLASA",
    "DENUMIRE1",
    "DENUMIRE2",
    "TEXT_NR_PRIN_MIJLOC_FIX",
    "NUMAR_SERIAL",
  ];
  for (const n of need) {
    if (idx[n] == null) {
      throw new Error(`Missing column ${n} in ${path.basename(filePath)}`);
    }
  }
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    const mijloc_fix = normalizeFix(cols[idx.MIJLOC_FIX]);
    if (!mijloc_fix) continue;
    const denumire1 = (cols[idx.DENUMIRE1] || "").trim();
    rows.push({
      mijloc_fix,
      mijloc_fix_orig: normalizeOrig(cols[idx.MIJLOC_FIX_ORIG]) || null,
      clasa: (cols[idx.CLASA] || "").trim() || null,
      denumire1,
      denumire2: (cols[idx.DENUMIRE2] || "").trim() || null,
      description: (cols[idx.TEXT_NR_PRIN_MIJLOC_FIX] || "").trim() || null,
      numar_serial: (cols[idx.NUMAR_SERIAL] || "").trim() || null,
      source_report: sourceReport,
    });
  }
  return rows;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // clean previous seed sql/jsonl
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".sql") || f.endsWith(".jsonl")) {
      fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }

  const byFix = new Map();
  let totalRaw = 0;
  for (const name of CSV_FILES) {
    const full = path.join(CSV_DIR, name);
    if (!fs.existsSync(full)) {
      throw new Error(`CSV not found: ${full}`);
    }
    const rows = readCsv(full, name);
    totalRaw += rows.length;
    for (const r of rows) {
      const existing = byFix.get(r.mijloc_fix);
      if (!existing) {
        byFix.set(r.mijloc_fix, r);
        continue;
      }
      // prefer non-empty denumire1; otherwise keep first
      if (!existing.denumire1 && r.denumire1) {
        byFix.set(r.mijloc_fix, r);
      }
    }
  }

  const items = [...byFix.values()];
  items.sort((a, b) => a.mijloc_fix.localeCompare(b.mijloc_fix, "en"));
  console.log(`Raw rows: ${totalRaw}; unique mijloc_fix: ${items.length}`);

  // JSONL
  const jsonlPath = path.join(OUT_DIR, "smiss_catalog.jsonl");
  const jsonl = fs.createWriteStream(jsonlPath, { encoding: "utf8" });
  for (const r of items) {
    jsonl.write(JSON.stringify(r) + "\n");
  }
  jsonl.end();

  // Chunked SQL
  let chunkIdx = 0;
  const sqlFiles = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    chunkIdx++;
    const slice = items.slice(i, i + CHUNK);
    const values = slice
      .map((r) => {
        const d1 = r.denumire1 || `NECUNOSCUT ${r.mijloc_fix}`;
        return `(${sqlEsc(r.mijloc_fix)}, ${sqlEsc(r.mijloc_fix_orig)}, ${sqlEsc(r.clasa)}, ${sqlEsc(d1)}, ${sqlEsc(r.denumire2)}, ${sqlEsc(r.description)}, ${sqlEsc(r.numar_serial)}, ${sqlEsc(r.source_report)})`;
      })
      .join(",\n");
    const sql =
      `INSERT OR REPLACE INTO smiss_catalog ` +
      `(mijloc_fix, mijloc_fix_orig, clasa, denumire1, denumire2, description, numar_serial, source_report)\n` +
      `VALUES\n${values};\n`;
    const fname = `seed_${String(chunkIdx).padStart(3, "0")}.sql`;
    fs.writeFileSync(path.join(OUT_DIR, fname), sql, "utf8");
    sqlFiles.push(fname);
  }

  const readme = `# SMISS catalog seed

Generated by \`scripts/build-smiss-import.mjs\` from the two RAPORT_SMISS CSV files.

## Contents
- \`seed_NNN.sql\` — chunked \`INSERT OR REPLACE\` (~${CHUNK} rows each), **${sqlFiles.length} files**, **${items.length}** unique codes
- \`smiss_catalog.jsonl\` — one JSON object per line (for tooling / wrangler batch if desired)

## Prerequisites
1. Apply schema migration first:
   - Full file: \`migrations/0003_smiss_catalog.sql\` (may fail in D1 Console if multi-statement)
   - Or paste one-by-one from \`migrations/d1-steps-0003/01.sql\` … \`12.sql\`

## Apply seed in Cloudflare D1 Console (no API token)
1. Open Cloudflare Dashboard → Workers & Pages → D1 → \`depozit-bt\` → Console
2. For each \`seed_NNN.sql\` in order, paste the **entire file contents** and Run
3. Expect ~${sqlFiles.length} runs (${items.length} rows total)
4. Optional zip on Desktop: \`smiss-catalog-sql.zip\` (same SQL files)

## Apply via wrangler (when logged in / token available)
\`\`\`bash
# schema
npx wrangler d1 execute depozit-bt --remote --file=migrations/0003_smiss_catalog.sql
# or apply migrations folder
npm run db:migrate:remote

# seed chunks (PowerShell example)
Get-ChildItem migrations/smiss-seed/seed_*.sql | Sort-Object Name | ForEach-Object {
  npx wrangler d1 execute depozit-bt --remote --file=$_.FullName
}
\`\`\`

## Re-generate
\`\`\`bash
node scripts/build-smiss-import.mjs --csv-dir "C:/Users/lilly/Desktop/smiss-import"
\`\`\`

Do **not** commit the raw multi-MB CSVs. Seed SQL may live in a Desktop zip for manual import.
`;
  fs.writeFileSync(path.join(OUT_DIR, "README.md"), readme, "utf8");

  // Zip to Desktop via PowerShell Compress-Archive
  const zipList = sqlFiles.map((f) => path.join(OUT_DIR, f));
  zipList.push(path.join(OUT_DIR, "README.md"));
  if (fs.existsSync(DESKTOP_ZIP)) fs.unlinkSync(DESKTOP_ZIP);
  const ps = `
$files = @(${zipList.map((f) => `'${f.replace(/'/g, "''")}'`).join(",")})
Compress-Archive -Path $files -DestinationPath '${DESKTOP_ZIP.replace(/'/g, "''")}' -Force
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.warn("Zip failed:", r.stderr || r.stdout);
  } else {
    console.log("Wrote zip:", DESKTOP_ZIP);
  }

  console.log(`Wrote ${sqlFiles.length} SQL chunks + jsonl to ${OUT_DIR}`);
}

main();
