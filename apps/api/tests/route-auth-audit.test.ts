import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_MODELS } from "../src/lib/prisma-tenant.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const modulesDir = join(srcDir, "modules");

// Deliberately public: no JWT exists yet (auth), or authentication is by
// other means (webhook signature, enquiry honeypot+limiter, health).
// FULL paths (mount prefix + route path). Anything not here and not behind
// exactly one auth middleware fails the build.
const PUBLIC_ALLOWLIST = new Set([
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/demo-session",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/forgot-password",
  "POST /api/v1/auth/reset-password",
  "POST /api/v1/public/enquiries",
  "POST /api/v1/payments/webhook",
  "GET /health",
  "GET /api/v1/hello",
]);

// AuthMiddleware alone (identity read, no tenant/platform scope): only /me.
const AUTH_ALONE_ALLOWLIST = new Set(["GET /api/v1/auth/me"]);

interface FoundRoute {
  method: string;
  path: string;
  chain: string[];
  file: string;
}

function mountMap(): Map<string, string> {
  const appSrc = readFileSync(join(srcDir, "app.ts"), "utf8");
  const map = new Map<string, string>();
  for (const line of appSrc.split("\n")) {
    const m = line.match(/app\.use\("([^"]+)",\s*(\w+)\);/);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      map.set(m[2], m[1]);
    }
  }
  return map;
}

function routerVar(fileText: string): string | null {
  const m = fileText.match(/export const (\w+Router)\b/);
  if (!m || m[1] === undefined) {
    return null;
  }
  return m[1];
}

function collectRoutes(): FoundRoute[] {
  const mounts = mountMap();
  const routes: FoundRoute[] = [];
  // app.ts-level routes (health, hello).
  const appSrc = readFileSync(join(srcDir, "app.ts"), "utf8");
  for (const line of appSrc.split("\n")) {
    const m = line.match(/app\.(get|post|put|patch|delete)\("([^"]+)"/);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], chain: [], file: "app.ts" });
    }
  }
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".router.ts")) {
        continue;
      }
      const text = readFileSync(full, "utf8");
      const router = routerVar(text);
      const prefix = (router && mounts.get(router)) ?? "";
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const decl =
          line.match(/^\s*(get|post|put|patch|delete)\s*\(\s*$/) ||
          line.match(/^\s*\w+\.(get|post|put|patch|delete)\(\s*$/);
        if (!decl) {
          continue;
        }
        const rawMethod = decl[2] ?? decl[1];
        if (rawMethod === undefined) {
          continue;
        }
        const method = rawMethod.toUpperCase();
        let rel = "";
        const chain: string[] = [];
        for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
          const rawLine = lines[j] ?? "";
          const t = rawLine.trim().replace(/,$/, "");
          const pm = t.match(/^"([^"]+)"$/);
          if (pm && !rel && pm[1] !== undefined) {
            rel = pm[1];
            continue;
          }
          const mm = t.match(
            /^(authMiddleware|tenantMiddleware|platformOnlyMiddleware|deviceAuthMiddleware|cronAuthMiddleware|studentSelfScope|teacherSelfScope|requirePermission\("[^"]+"\))$/,
          );
          if (mm && mm[1] !== undefined) {
            chain.push(mm[1]);
          }
          if (/async \(req|\(req: Request/.test(t)) {
            break;
          }
        }
        if (rel) {
          routes.push({ method, path: `${prefix}${rel}`, chain, file: full });
        }
        // Multipart fields (upload.single) and similar non-middleware lines
        // are skipped by the strict matcher above — only real middleware
        // and permission keys land in chain.
      }
    }
  };
  walk(modulesDir);
  return routes;
}

function modelsWithSchoolId(): string[] {
  const schema = readFileSync(join(srcDir, "..", "..", "..", "prisma", "schema.prisma"), "utf8");
  const found: string[] = [];
  const blocks = schema.split(/^model /m).slice(1);
  for (const block of blocks) {
    const firstLine = block.split(/[\s{]/, 2)[0] ?? "";
    const name = firstLine.trim();
    if (!name) {
      continue;
    }
    if (/^\s*schoolId\s+\w+\??\s+@/m.test(block)) {
      found.push(name);
    }
  }
  return found.sort();
}

describe("route auth audit (§13.4, fails the build)", () => {
  it("every mounted route is in exactly one auth path or the public allowlist", () => {
    const routes = collectRoutes();
    expect(routes.length).toBeGreaterThan(100);
    // The path-defining middleware: exactly one of these per route.
    // authMiddleware rides along on all of them (identity first, scope
    // second) — counting it would flag every route in the product.
    const PATH_MIDDLEWARE = new Set([
      "tenantMiddleware",
      "platformOnlyMiddleware",
      "deviceAuthMiddleware",
      "cronAuthMiddleware",
    ]);
    const offenders: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      const paths = r.chain.filter((x) => PATH_MIDDLEWARE.has(x));
      if (paths.length === 0) {
        // Either bare-auth (identity read, allowlisted) or fully public.
        if (r.chain.includes("authMiddleware")) {
          if (!AUTH_ALONE_ALLOWLIST.has(key)) {
            offenders.push(`${key} [${r.file}] — auth-only, not allowlisted`);
          }
        } else if (!PUBLIC_ALLOWLIST.has(key)) {
          offenders.push(`${key} [${r.file}] — no auth middleware and not allowlisted`);
        }
        continue;
      }
      if (paths.length > 1) {
        offenders.push(`${key} [${r.file}] — two auth paths: ${paths.join("+")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every Prisma model with a schoolId is in TENANT_MODELS (no drift)", () => {
    const models = modelsWithSchoolId();
    expect(models.length).toBeGreaterThan(20);
    const missing = models.filter((m) => !(TENANT_MODELS as readonly string[]).includes(m));
    expect(missing).toEqual([]);
  });
});
