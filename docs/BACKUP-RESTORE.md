# Depozit BT — Backup and Restore (Cloudflare D1)

This page explains, step by step, how the database `depozit-bt` is protected
and how to get data back if something goes wrong.

There are **two safety nets**:

| | What | How far back | Who makes it |
|---|---|---|---|
| 1 | **Time Travel** (built into Cloudflare D1) | any minute of the last **30 days** (Workers Paid plan) or **7 days** (Free plan) | Cloudflare, automatically |
| 2 | **Weekly backup file** (GitHub Actions) | one file per week, each kept **90 days** | our workflow `.github/workflows/d1-backup.yml` |

Use **Time Travel first** (fast, one command). Use the **weekly file** when
Time Travel is not enough (older than 30/7 days, or you want a copy to look at).

Useful facts:

- Database name: `depozit-bt`
- Database id: `189e60d5-792e-4df3-b318-f4fbcad73b0b`
- Account id: `6ce6feabe9fe6a75709ff372dd0b359a`
- Run all `npx wrangler ...` commands from the project folder (where
  `wrangler.toml` is), in **Git Bash** (Windows) or a terminal (Linux).
- The first time on a PC, log in to Cloudflare with `npx wrangler login`
  (opens the browser). Check with `npx wrangler whoami`.

> Think of it like FoxPro: `DROP TABLE` is like deleting the `.dbf` file, and a
> restore overwrites the whole database at once. There is no "undo" button,
> so always write down the current bookmark first (see below).

---

## 1. Time Travel (restore the live database to an earlier time)

### 1a. See the current bookmark (do this FIRST, always)

A *bookmark* is a code that means "the database exactly as it is now".

```bash
npx wrangler d1 time-travel info depozit-bt
```

Output looks like:

```
⚠️ The current bookmark is '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'
```

**Copy this bookmark into a text file (Notepad) before any restore.**
It is your "undo": you can always go back to it.

### 1b. See the bookmark for a past time

Times can be written as RFC3339 with the Romania offset
(`+03:00` in summer, `+02:00` in winter) or as a Unix timestamp:

```bash
# 27 Sep 2026, 14:30 Romania summer time
npx wrangler d1 time-travel info depozit-bt --timestamp="2026-09-27T14:30:00+03:00"
```

### 1c. Restore to a time (DANGER: overwrites the LIVE database)

> **WARNING:** Restore replaces the **whole live database** with the older
> version. Everything written after that time (new tickets, scans, stock
> changes) is gone from the live database. Queries running at that moment
> are cancelled. Tell users to stop working for a few minutes.

```bash
# 1) note the current bookmark (undo point)
npx wrangler d1 time-travel info depozit-bt

# 2) restore to a time
npx wrangler d1 time-travel restore depozit-bt --timestamp="2026-09-27T14:30:00+03:00"
#    or to an exact bookmark
npx wrangler d1 time-travel restore depozit-bt --bookmark=00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683
```

Wrangler asks `OK to proceed (y/N)` — type `y`. At the end it prints
"To undo this operation, you can restore to the previous bookmark: ...".
Save that bookmark too.

### 1d. Undo a restore

Restore again, to the bookmark you saved in step 1:

```bash
npx wrangler d1 time-travel restore depozit-bt --bookmark=<the bookmark you saved>
```

---

## 2. Weekly backup file (GitHub Actions)

### What the workflow does

- Runs **every Sunday at 19:00 UTC** = **22:00 Romania summer time** /
  **21:00 Romania winter time** (GitHub can start a few minutes late).
  You can also start it by hand: **Actions** tab → **D1 weekly backup** →
  **Run workflow**.
- Exports the live D1 database to a `.sql` file (`wrangler d1 export --remote`).
  The export blocks the database for a few seconds — that is why it runs on
  Sunday night.
- Checks the file is not empty / too small, and prints a table with the
  **row count per table** (numbers only, no data) on the run page.
- Compresses it (`gzip`) and **encrypts** it with AES-256 using the secret
  `BACKUP_PASSPHRASE`, then checks that it decrypts back correctly.
- Uploads only the encrypted file as an **artifact**, kept **90 days**.

Why encrypted: the repo is **public**. On a public repo, **any logged-in
GitHub user can download the artifacts**. The file contains the `users` table
(password hashes) and all business data. Without the passphrase, the file is
useless to them.

> **Keep `BACKUP_PASSPHRASE` somewhere safe outside GitHub** (password manager,
> or on paper in a safe place). GitHub never shows a secret again after you
> save it. **Without the passphrase, the backups cannot be opened — by anyone,
> including you.**

> Note: GitHub pauses scheduled workflows in a public repo if the repo has
> **no activity for 60 days**. If you see a yellow banner in the Actions tab
> saying the workflow was disabled, click **Enable workflow**. It is also a
> good idea to look at the Actions tab once a month and check the last run is
> green.

### 2a. Download a backup

1. Open the repo on GitHub → **Actions** tab.
2. On the left click **D1 weekly backup**.
3. Click a run (green check = OK).
4. At the bottom of the page, section **Artifacts**, click the name
   (like `d1-backup-depozit-bt-2026-09-27_2200-run12`). A `.zip` downloads.
   You must be logged in to GitHub.
5. Unzip it (Windows: right-click → **Extract All**). Inside are two files:
   - `depozit-bt-2026-09-27_2200.sql.gz.enc` — the encrypted backup
   - `depozit-bt-2026-09-27_2200.sql.gz.enc.sha256` — a checksum

### 2b. Decrypt the backup

**Windows:** use **Git Bash** (it comes with Git for Windows and already has
`openssl`, `gzip` and `sha256sum`). Right-click in the folder → *Open Git Bash
here*, or `cd ~/Downloads/<folder>`.
**Linux:** a normal terminal (openssl and gzip are installed by default).

The commands are the same on both:

```bash
# go to the folder with the extracted files, for example:
cd ~/Downloads/d1-backup-depozit-bt-2026-09-27_2200-run12

# (optional) check the file is complete — should print ": OK"
sha256sum -c depozit-bt-2026-09-27_2200.sql.gz.enc.sha256

# type the passphrase when asked (nothing is shown while you type — normal)
read -r -s -p "Backup passphrase: " BP; echo; export BP

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BP \
  -in  depozit-bt-2026-09-27_2200.sql.gz.enc \
  -out backup.sql.gz

unset BP

# un-compress -> gives backup.sql
gzip -d backup.sql.gz
```

- Wrong passphrase → you get `bad decrypt` and no usable file. Try again.
- The numbers `-aes-256-cbc -pbkdf2 -iter 200000 -md sha256` must stay exactly
  like this (they match the workflow).
- `backup.sql` is **NOT encrypted**. It contains password hashes and all
  data. Do not email it, do not put it in the repo, and delete it when done.

### 2c. Just look inside the backup (no Cloudflare needed)

Easiest for browsing: install **DB Browser for SQLite** (free,
sqlitebrowser.org) → *File → Import → Database from SQL file…* → choose
`backup.sql` → save as a new `.sqlite` file. Now you can browse tables like in
FoxPro BROWSE. This does not touch the live system at all.

### 2d. Restore into a NEW D1 database (safe — for checking)

This creates a second database next to the live one. The live app is not
touched.

```bash
# 1) create an empty database (pick any new name)
npx wrangler d1 create depozit-bt-restore-test

# 2) import the backup into it (takes a minute; --yes answers the prompt)
npx wrangler d1 execute depozit-bt-restore-test --remote --yes --file=backup.sql

# 3) check some counts and compare with the table on the GitHub run page
npx wrangler d1 execute depozit-bt-restore-test --remote --command "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM stock_items) AS stock_items, (SELECT count(*) FROM tickets) AS tickets, (SELECT count(*) FROM smiss_catalog) AS smiss_catalog"

# 4) when you are finished, delete the test database
npx wrangler d1 delete depozit-bt-restore-test
```

(The Free plan allows 10 databases per account, so delete test copies.)

### 2e. Restore into the LIVE database (last resort)

> **Only do this if Time Travel cannot help** (for example the problem is
> older than 30/7 days). The app will not work between step 4 and step 5.
> Tell users to stop working.

You cannot import the backup on top of existing tables — you get
`table ... already exists`. The tables must be dropped first. Safe order:

```bash
# 1) Decrypt the backup (section 2b) and, ideally, test it in a NEW
#    database first (section 2d).

# 2) Save the undo point — copy the bookmark into Notepad!
npx wrangler d1 time-travel info depozit-bt

# 3) See which tables exist now
npx wrangler d1 execute depozit-bt --remote --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"
#    Expected: activity_logs, d1_migrations, smiss_catalog, sqlite_sequence,
#    stock_items, stock_movements, ticket_history, ticket_info, ticket_items,
#    ticket_scans, tickets, users (maybe also _cf_KV / _cf_METADATA — ignore
#    those, they belong to Cloudflare). If you see OTHER tables, stop and add
#    them to docs/d1-drop-all-tables.sql first.

# 4) Drop all app tables (children first). DELETES ALL LIVE DATA.
npx wrangler d1 execute depozit-bt --remote --file=docs/d1-drop-all-tables.sql

# 5) Import the backup
npx wrangler d1 execute depozit-bt --remote --yes --file=backup.sql

# 6) Check counts (compare with the table on the GitHub run page)
npx wrangler d1 execute depozit-bt --remote --command "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM stock_items) AS stock_items, (SELECT count(*) FROM tickets) AS tickets, (SELECT count(*) FROM smiss_catalog) AS smiss_catalog"

# 7) Open the app and log in to check it works.

# If ANYTHING went wrong in steps 4-6, go back to the saved bookmark:
npx wrangler d1 time-travel restore depozit-bt --bookmark=<bookmark from step 2>
```

Finally delete `backup.sql` and `backup.sql.gz` from your PC.

---

## 3. One-time setup: Cloudflare token + GitHub secrets

The workflow needs three secrets. Without them it fails with a red X and a
clear message ("Repository secret ... is not set").

### 3a. Create the Cloudflare API token

1. Log in to https://dash.cloudflare.com.
2. Go to **Manage Account → Account API Tokens** (or top-right profile icon →
   **My Profile → API Tokens**) → **Create Token**.
3. At the bottom choose **Custom token → Get started**.
4. Token name: `github-d1-backup`.
5. **Permissions:** one line only:
   **Account** | **D1** | **Edit**
   - Use **Edit**, not Read. `wrangler d1 export` calls the D1 export API
     (`POST .../d1/database/<id>/export`), which Cloudflare does not list
     under the read-only "D1 Read" permission (only under D1 Edit/Write);
     read-only tokens fail with an authentication error.
6. **Account Resources:** *Include* → your account
   (id `6ce6feabe9fe6a75709ff372dd0b359a`).
7. Client IP filtering: leave empty (GitHub runners use changing IPs).
   TTL: optional (if you set an end date, remember to renew the token).
8. **Continue to summary → Create Token.** Copy the token now — Cloudflare
   shows it only once.

This token can change D1 data, so treat it like a password. It is only stored
as a GitHub secret (encrypted, never shown in logs).

### 3b. Add the secrets in GitHub

Repo on GitHub → **Settings → Secrets and variables → Actions →
New repository secret**. Add these three (names must match exactly):

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 3a |
| `CLOUDFLARE_ACCOUNT_ID` | `6ce6feabe9fe6a75709ff372dd0b359a` |
| `BACKUP_PASSPHRASE` | a long random passphrase, **at least 16 characters** (for example 5–6 random words). **Save a copy outside GitHub!** |

### 3c. Test it

**Actions** tab → **D1 weekly backup** → **Run workflow** → *Run workflow*.
After 1–2 minutes the run should be green, show the row-count table, and have
one artifact at the bottom. Download it and try section 2b once, so you know
the passphrase works.

If the run fails at "Export D1 database": usually the token is wrong or does
not have **D1 → Edit** on the right account.

### Changing the passphrase later

Just update the `BACKUP_PASSPHRASE` secret. New backups use the new
passphrase; **old backups still need the old passphrase** — keep both until the
old artifacts expire (90 days).
