# Platform Owner board (reference)

- **Badge:** "Platform Owner" — navy `#0F172A`, amber `#F59E0B` accent, Shield icon.
- **Sidebar:** navy `#0F172A`, Inter, blue `#2563EB` active states.
- **Nav (§8.4 order):** Dashboard (`/dashboard/owner`) · Schools
  (`/owner/schools`) · Subscriptions & Billing (`/owner/billing`) ·
  Platform Analytics (Soon) · Users Management (`/owner/users`) · Support &
  Impersonation (`/owner/support`; impersonation UI arrives with §13.9) ·
  Audit Logs (`/owner/audit-logs`) · Settings (`/owner/settings`, live: env/test-mode/plan matrix/tax/demo pills + read-only demo mint).
- **Dashboard (`/dashboard/owner`):** greeting header; 4 KPI cards (Total
  Schools, Active Schools, Trial/Pending, Total Revenue with MANUAL/TEST
  split); searchable schools table (newest-first); signups-per-month chart;
  Subscription Plans donut.
- **Schools (`/owner/schools`):** cross-tenant roster (plan column, counts).
- **Subscriptions & Billing (`/owner/billing`):** revenue, per-school
  invoices, issue + mark-paid, online captures.
- **Users Management (`/owner/users`):** account roster; deactivate /
  reactivate / role change with guardrails (owner untouchable, no self-harm).
- **Support (`/owner/support`):** all threads with INTERNAL pills; reply
  (visible/internal), move status, close.
- **Audit Logs (`/owner/audit-logs`):** platform-wide trail incl. NULL-actor rows.
- **API:** every `/api/v1/platform/*` route behind `platformOnlyMiddleware`
  (never tenant-scoped); owner `school_id` is NULL.
