const AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);

export function loginHref(returnTo: string): string {
  const params = new URLSearchParams({ next: returnTo });
  return `/login?${params.toString()}`;
}

export function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  const destination = new URL(value, "https://studyfy.invalid");
  if (destination.origin !== "https://studyfy.invalid" || AUTH_PATHS.has(destination.pathname)) {
    return null;
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
