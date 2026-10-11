// Single plan definition (§16.1) — price, student cap, and feature list in
// ONE place, consumed by the pricing cards (§8.3), cap enforcement, feature
// gating, and invoice generation. Never copied into each.
// Decisions (§16.1 "recommended defaults", adopted as-is — founder
// overrides welcome, but the code never hardcodes a second opinion):
// - Prices are GST-EXCLUSIVE (+18% GST at invoice time).
// - Trial = Standard-level cap (1500) + every Phase 2 feature.
// - Basic = Phase 1 modules; Standard = + Phase 2; Premium = + Phase 3.
// - Grace after a missed payment: 7 days PAST_DUE with full access.
// - No proration: plan changes apply from the next period (cap raises apply
//   immediately — blocking admissions mid-day over paperwork helps nobody).

export type SchoolPlan = "BASIC" | "STANDARD" | "PREMIUM";

// Cumulative feature tiers: a tier unlocks its own phase plus every lower
// one. Routes check ONE feature key via planAllows() → 403
// PLAN_UPGRADE_REQUIRED (§16.1); never role-if/else, never string compares.
export type FeatureKey = "phase1" | "phase2" | "phase3";

export interface PlanDef {
  plan: SchoolPlan;
  // Monthly price in integer paise, EXCLUDING GST.
  pricePaise: number;
  // Max pupils, enforced server-side at admission. null = unlimited.
  studentCap: number | null;
  features: FeatureKey[];
  support: string;
  // Pricing-card bullets, generated FROM this config so marketing claims
  // are literally true (§16.1) — the day these drift, the cards lie.
  bullets: string[];
}

export const PLANS: Record<SchoolPlan, PlanDef> = {
  BASIC: {
    plan: "BASIC",
    pricePaise: 299900,
    studentCap: 500,
    features: ["phase1"],
    support: "Email",
    bullets: ["Up to 500 students", "Core features", "Email support"],
  },
  STANDARD: {
    plan: "STANDARD",
    pricePaise: 599900,
    studentCap: 1500,
    features: ["phase1", "phase2"],
    support: "Priority",
    bullets: ["Up to 1,500 students", "All core features", "Priority support"],
  },
  PREMIUM: {
    plan: "PREMIUM",
    pricePaise: 999900,
    studentCap: null,
    features: ["phase1", "phase2", "phase3"],
    support: "24/7",
    bullets: ["Unlimited students", "Advanced features", "24/7 support"],
  },
};

export const TRIAL_PLAN: SchoolPlan = "STANDARD";
export const GRACE_DAYS = 7;
export const GST_PERCENT = 18;

// Effective tier for gating: trial schools ride the trial tier; everyone
// else rides their paid plan (unpaid/unknown → BASIC, fail-closed toward
// fewer features, never more). Demo schools carry real plans from seed, so
// no demo bypass exists here — SOS PREMIUM shows everything, RK STANDARD
// gates Phase 3, exactly as the side-by-side demo intends.
export function effectivePlan(status: string, plan: SchoolPlan | null): SchoolPlan {
  if (status === "TRIAL") {
    return TRIAL_PLAN;
  }
  if (plan === "BASIC" || plan === "STANDARD" || plan === "PREMIUM") {
    return plan;
  }
  return "BASIC";
}

export function planAllows(status: string, plan: SchoolPlan | null, feature: FeatureKey): boolean {
  return PLANS[effectivePlan(status, plan)].features.includes(feature);
}

// Module → feature tier (§16.1 "which modules each tier unlocks"). Phase 1
// modules are intentionally absent: everything ungated is Phase 1.
export const MODULE_FEATURES = {
  library: "phase2",
  transport: "phase2",
  payroll: "phase2",
  crm: "phase2",
  certificates: "phase2",
  feesOnline: "phase2",
  aiRemarks: "phase3",
  anomalies: "phase3",
  analytics: "phase3",
  biometric: "phase3",
  inventory: "phase3",
} as const satisfies Record<string, FeatureKey>;

export type ModuleKey = keyof typeof MODULE_FEATURES;
