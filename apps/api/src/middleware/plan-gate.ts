import { planAllows, type FeatureKey, type SchoolPlan } from "../modules/billing/plans.js";

// Feature gating (§16.1): which URL spaces need which tier. ONE table, read
// by tenantMiddleware for every tenant route — a new route under a gated
// prefix is gated automatically (no per-route wiring to forget), and an
// ungated prefix stays Phase 1 forever. Paths are matched with the
// :schoolId segment wild-carded (see the mount-prefix note below).
//
// Deliberately gated per MODULE, not per verb: a locked feature reads 403
// too (the UI shows the locked state instead). Deliberately NOT gated:
// - the Razorpay webhook (no school context until order lookup; initiation
//   is gated, and refusing a capture AFTER money moved would strand payment
//   — the gate speaks at pay-order/verify time, §13.8);
// - device attendance-sync (machine path keyed to its own school; the
//   registry + mapping routes that create the relationship ARE gated);
// - report cards / receipts / dashboards that merely DISPLAY gated data.
// Paths arrive WITHOUT any mount prefix: inside a router mounted at
// /api/v1, Express strips the mount point from req.url (and hence
// req.path) before route middleware runs — a probe proved req.path is
// "/schools/…", not "/api/v1/schools/…". The optional prefix keeps the map
// correct if a route is ever mounted differently. This exact mistake
// (anchored on /api/v1) shipped once and left the whole gate silently
// open — the probe test below exists so it can never recur.
function gated(suffix: string, feature: FeatureKey): { match: RegExp; feature: FeatureKey } {
  return { match: new RegExp(`^(?:\\/api\\/v1)?\\/schools\\/[^/]+${suffix}`), feature };
}

const GATED_PREFIXES: { match: RegExp; feature: FeatureKey }[] = [
  // Phase 2 (§7 #11–17): Standard and up.
  gated("/library(\\/|$)", "phase2"),
  gated("/transport(\\/|$)", "phase2"),
  gated("/payroll(\\/|$)", "phase2"),
  gated("/enquiries(\\/|$)", "phase2"),
  gated("/certificates(\\/|$)", "phase2"),
  gated("/fees/invoices/[^/]+/pay-order", "phase2"),
  gated("/fees/pay-verify", "phase2"),
  // Phase 3 (§7 #18–22): Premium only.
  gated("/inventory(\\/|$)", "phase3"),
  gated("/biometric(\\/|$)", "phase3"),
  gated("/analytics/overview", "phase3"),
  gated("/attendance/anomalies", "phase3"),
  gated("/exams/[^/]+/remarks(\\/|$)", "phase3"),
];

export function featureForPath(path: string): FeatureKey | null {
  for (const { match, feature } of GATED_PREFIXES) {
    if (match.test(path)) {
      return feature;
    }
  }
  return null;
}

// Minimum tier for the upgrade message (Basic is never gated, so the
// answer is always Standard or Premium).
export function minPlanFor(feature: FeatureKey): "STANDARD" | "PREMIUM" {
  return feature === "phase3" ? "PREMIUM" : "STANDARD";
}

export function planGateMessage(feature: FeatureKey): string {
  return `This module needs the ${minPlanFor(feature) === "PREMIUM" ? "Premium" : "Standard"} plan or higher. Contact your school administrator to upgrade.`;
}

export function planGateAllows(status: string, plan: SchoolPlan | null, path: string): boolean {
  const feature = featureForPath(path);
  if (!feature) {
    return true;
  }
  return planAllows(status, plan, feature);
}
