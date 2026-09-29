import Razorpay from "razorpay";
import { AuthError } from "../modules/auth/auth.service.js";

// Razorpay client factory (§13.8, Phase 2 TEST MODE only).
//
// Key discipline (spec §1 — never live keys in this project):
// - Keys come ONLY from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env. Nothing
//   is hardcoded here and there is deliberately no fallback value.
// - TEST-prefix guard: the Key ID must start with `rzp_test_`. A live key
//   anywhere near this project is a security incident, so construction
//   refuses loudly instead of silently spending real money.
// - Missing keys throw at INITIATION time, never at boot: Render must stay
//   up (health checks green) even before keys are configured — only the
//   pay-order endpoint itself reports unconfigured.
export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  keyId: string;
}

export function razorpayKeys(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (!keyId || !keySecret) {
    throw new AuthError(503, "PAYMENTS_UNCONFIGURED", "Online payments are not configured yet.");
  }
  if (!keyId.startsWith("rzp_test_")) {
    throw new AuthError(500, "PAYMENTS_MISCONFIGURED", "Refusing non-test Razorpay key (spec §1: test keys only).");
  }
  return { keyId, keySecret };
}

export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  const { keyId, keySecret } = razorpayKeys();
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = (await client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes,
  })) as { id: string; amount: number; currency: string; receipt: string; status: string };
  return { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt, status: order.status, keyId };
}
