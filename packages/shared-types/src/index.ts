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
} from "./plans.js";

// Shared envelope per spec §10: { success, data, error, meta }.
export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
  meta: null | { page?: unknown };
}

export interface ApiFailure {
  success: false;
  data: null;
  error: { code: string; message: string };
  meta: null;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
