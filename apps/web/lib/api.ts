// Shared API-envelope check for every board page.
//
// The API always returns the envelope `{ data, error, meta }` with
// `error: null` on success — so `"error" in body` is TRUE even when the
// call succeeded, and reading `body.error.message` off it crashes the
// page (this exact bug broke login and every board at once: the red
// "Cannot read properties of null (reading 'message')" on success).
// ALWAYS go through isFailure() below — never `in`-check the body.
//
// It is a type guard: inside the `if` you get the failure member
// (`body.error?.message`), past it TypeScript sees the data member
// (`body.data...`) — same narrowing the old `in`-check gave, but with
// correct runtime semantics (value check, not key presence).
//
// The parameter is deliberately just `object`: every call site casts to
// its own `{ data } | { error }` shape and all of those keep working.
export function isFailure(res: Response, body: object): body is { error: { message?: string } } {
  if (!res.ok) {
    return true;
  }
  if (typeof body !== "object" || body === null) {
    return false;
  }
  return "error" in body && !!(body as { error?: unknown }).error;
}

// Plan-gate locked state (§16.1): when the API refuses with
// PLAN_UPGRADE_REQUIRED, the page renders the locked card (UpgradeLocked)
// instead of its content or a bare error — the module stays visible, never
// hidden. Returns the server's upgrade message, or null for anything else.
export function upgradeLockedMessage(body: object): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== "PLAN_UPGRADE_REQUIRED" || typeof message !== "string" || message === "") {
    return null;
  }
  return message;
}
