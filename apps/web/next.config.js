/** @type {import('next').NextConfig} */
// transpilePackages: the landing pricing cards import the plan config from
// @studyfy/shared-types (§16.1 single source of truth).
//
// headers(): Layer 2 live finding — the deployed frontend served only Vercel's
// default HSTS. The API sets nosniff / frame-options / referrer / CSP, but the
// web app set none of them, so responses shipped without clickjacking, MIME
// sniffing, or referrer-leak protection. Deliberately NOT setting
// Content-Security-Policy here: Next.js emits inline bootstrap/hydration
// scripts, so a CSP needs a per-route inventory and a report-only rollout
// first — a wrong policy white-screens the app. Tracked as an open S3 finding.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // `payment` is deliberately NOT denied: Razorpay Checkout runs in an
    // iframe and denying the payment feature set is a real risk of breaking
    // the checkout flow, which this test pass cannot verify.
    value: "camera=(), microphone=(), geolocation=(), usb=()",
  },
];

const nextConfig = {
  transpilePackages: ["@studyfy/shared-types"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
