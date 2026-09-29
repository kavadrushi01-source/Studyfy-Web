import crypto from "node:crypto";
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

// Webhook trust root (§13.8): the HMAC-SHA256 of the RAW request bytes,
// keyed with the webhook secret, must equal Razorpay's signature header -
// compared in constant time. Anything else (missing secret, missing or
// wrong signature) fails closed: the payload is never even parsed for
// decisions. Missing secret is a 503 (can't verify = can't process),
// wrong signature is for the caller to treat as 401.
export function webhookSecret(): string {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!secret) {
    throw new AuthError(503, "PAYMENTS_UNCONFIGURED", "Online payments are not configured yet.");
  }
  return secret;
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!signature) {
    return false;
  }
  const expected = crypto.createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
