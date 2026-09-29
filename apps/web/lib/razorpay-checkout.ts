// Razorpay hosted checkout (§13.8, Phase 2 TEST MODE only).
//
// Deliberately thin: we NEVER build a card-input form (Razorpay hosts
// card entry — raw card numbers must never touch our server or database,
// test mode or not). This module only loads Razorpay's own checkout.js
// on demand and opens it with a server-created order id.
//
// TEST MODE is a UI-level promise too: every surface that opens this
// checkout carries its own TEST MODE indicator (see the fees page),
// because nobody should ever wonder whether money just moved.

export interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutInstance {
  open: () => void;
  close: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

interface RazorpayFactory {
  new (options: Record<string, unknown>): RazorpayCheckoutInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayFactory;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let loading: Promise<void> | null = null;

export function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout needs a browser."));
  }
  if (window.Razorpay) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        reject(new Error("Could not load the payment window. Check your connection and try again."));
      };
      document.body.appendChild(script);
    });
  }
  return loading;
}

export interface OpenCheckoutOptions {
  key: string;
  orderId: string;
  amountPaise: number;
  description: string;
  onSuccess: (payment: CheckoutSuccess) => void;
  onDismiss: () => void;
}

export function openCheckout(options: OpenCheckoutOptions): void {
  if (typeof window === "undefined" || !window.Razorpay) {
    throw new Error("Payment window is not ready. Try again.");
  }
  const checkout = new window.Razorpay({
    key: options.key,
    order_id: options.orderId,
    amount: options.amountPaise,
    currency: "INR",
    name: "Studyfy School Fees",
    description: options.description,
    theme: { color: "#2563EB" },
    modal: { ondismiss: options.onDismiss },
    handler: (response: unknown) => {
      options.onSuccess(response as CheckoutSuccess);
    },
  });
  checkout.open();
}
