# Backup & restore — Studyfy on Aiven free MySQL

Short file, three parts: what Aiven itself provides, how to restore, and the
proof it works. Facts below are from the official Aiven docs (read
2026-10-14; links inline) — anything not verifiable from here is marked OPEN.

## 1. What the free plan provides

- **Automatic encrypted backups**: full backup daily + binary logs recorded
  continuously, combinable into a point-in-time recovery (PITR).
  (https://aiven.io/docs/products/mysql/concepts/mysql-backups)
- **Free-plan retention: a SINGLE backup, disaster-recovery only.** Paid
  plans keep 2 / 14 / 30 days of PITR; free keeps one backup for disaster
  recovery. (https://aiven.io/pricing/mysql — "Restore to any point in
  time" row.)
- **Backups are NOT downloadable.** Restore/fork happens in the Console
  (service → Backups), or via API/CLI/Terraform. Backups live in the
  region's object storage; powering a service on from off restores the
  latest automatically; backups die 30 days after service deletion.
  (https://aiven.io/docs/platform/concepts/service_backups)
- **Own backups via mysqldump** (the documented path — same flags we use):
  `mysqldump -p DEFAULTDB -P PORT -h HOST --single-transaction -u USER
  --set-gtid-purged=OFF --password > backup.sql`, restore with
  `mysql -p DEFAULTDB -P PORT -h HOST -u USER --password < backup.sql`.
  Connection values come from the service Overview page.
  (https://aiven.io/docs/products/mysql/howto/migrate-database-mysqldump)
- Free tier shape for context: 1 CPU, 1 GB RAM, 8 GB storage.

## 2. Restore steps

**A. From an Aiven backup (disaster):** Console → service → Backups →
restore (or fork to a new service first to inspect before overwriting).
Verify with the count queries in §3, then `migrate status` must read
in-sync before traffic returns.

**B. From a mysqldump file:** `mysql -p DEFAULTDB -P PORT -h HOST -u USER
--password < backup.sql` against the target (empty database or scratch
service), then the same verification. Password at the prompt — never in
the command line, never in chat.

**C. Verify any restore:** row counts must match exactly across
`schools`, `users`, `tickets`, `subscription_invoices` (extend as needed):
`SELECT (SELECT COUNT(*) FROM live.schools) AS a, (SELECT COUNT(*) FROM
restored.schools) AS b;` — then log in (admin + owner) and open one
paid-gated page before calling it done.

## 3. Proof it works (local, 2026-10-14)

mysqldump of the live-shaped e2e DB (7.3 MB, `--single-transaction`) →
restored into scratch `studyfy_restore` → counts **exact**: schools
376/376, users 1097/1097, tickets 90/90, subscription invoices 128/128.
Scratch DB dropped and the dump file deleted right after (it held password
hashes — dumps are never kept, never committed).

## OPEN (founder, console)

Exact free-plan wording/retention visible on OUR service's Backups page,
and one real fork-restore drill before relying on it for production.
