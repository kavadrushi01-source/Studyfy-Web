const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// Cold-start insurance: the first full-parallel burst after a fresh
// `next build` + server boot makes Windows re-read (and Defender rescan)
// every new chunk while all workers launch Chromium at once - observed
// stalls of 9-30s on static chunks and API queries timed tests out at
// 45s. Warming the HTML routes (pulls their chunks) and a few API queries
// (opens the Prisma pool) before any worker starts removes the burst.
// Never touches forgot/reset/register: those share a 10/hour/IP limiter
// that back-to-back runs would exhaust.

const WEB_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/enquiry",
  "/dashboard",
  "/dashboard/accountant",
  "/dashboard/teacher",
  "/homework",
  "/students",
  "/sections",
  "/teachers",
  "/fees",
  "/attendance/mark",
  "/timetable",
  "/exams/results",
  "/notices",
  "/messages",
  "/profile",
];

async function waitFor(url: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  let lastError = "";
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() > deadline) {
      throw new Error(`Warm-up: ${url} not reachable after ${ms}ms (${lastError})`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function warmWeb(): Promise<void> {
  await waitFor(`${WEB}/login`, 20000);
  for (const route of WEB_ROUTES) {
    try {
      const res = await fetch(`${WEB}${route}`, { redirect: "manual" });
      void res.status;
    } catch {
      // A single missing route must not block the suite; readiness
      // already passed above.
    }
  }
}

async function warmApi(): Promise<void> {
  await waitFor(`${API}/api/v1/auth/login`, 20000);
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolSlug: "school-of-science",
      email: "kavita.rao@schoolofscience.demo",
      password: "Demo@1234",
    }),
  });
  if (!login.ok) {
    throw new Error(`Warm-up: API login failed with HTTP ${login.status}`);
  }
  const body = (await login.json()) as { data: { accessToken: string; user: { schoolId: string } } };
  const token = body.data.accessToken;
  const schoolId = body.data.user.schoolId;
  const headers = { Authorization: `Bearer ${token}` };
  const hot = [
    `/api/v1/auth/me`,
    `/api/v1/schools/${schoolId}/sections`,
    `/api/v1/schools/${schoolId}/subjects`,
    `/api/v1/schools/${schoolId}/homework`,
    `/api/v1/schools/${schoolId}/students`,
    `/api/v1/schools/${schoolId}/notices`,
  ];
  for (const path of hot) {
    try {
      const res = await fetch(`${API}${path}`, { headers });
      void res.status;
    } catch {
      // Non-fatal: only the pool/Node path needed warming.
    }
  }
}

export default async function globalSetup(): Promise<void> {
  await Promise.all([warmWeb(), warmApi()]);
}
