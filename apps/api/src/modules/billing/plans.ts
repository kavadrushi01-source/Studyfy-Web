// Plan definitions live in @studyfy/shared-types (§16.1 single config —
// founder instruction: the landing cards read the same object the code
// enforces, so marketing cannot promise more). This module re-exports that
// object so every existing relative import keeps working; there is exactly
// ONE PlanDef/PLANS object in the process. Values, caps, tiers and the
// decision comments all live in packages/shared-types/src/plans.ts.
export {
  effectivePlan,
  GRACE_DAYS,
  GST_PERCENT,
  MODULE_FEATURES,
  PLANS,
  TRIAL_PLAN,
  planAllows,
  type FeatureKey,
  type ModuleKey,
  type PlanDef,
  type SchoolPlan,
} from "@studyfy/shared-types";
