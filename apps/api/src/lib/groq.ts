// Groq client wrapper (§7 Phase 3 #18, §1/§2 — free tier, real calls).
//
// This file is the ONE place that talks to Groq. Feature code (report-card
// remarks, attendance anomalies, anything later) calls groq().generateText()
// and never fetch()es Groq directly — so the model choice and the
// PII-minimization rule below are enforced in one spot, not re-decided at
// every call site.
//
// Key discipline (spec §1 — free tier, no card):
// - The key comes ONLY from GROQ_API_KEY env. Nothing is hardcoded here
//   and there is deliberately no fallback value.
// - Missing key throws at CALL time, never at boot: the API must stay up
//   (health checks green) even before the key is configured — only the AI
//   endpoint itself reports unconfigured. Same shape as razorpayKeys().
// - The key is never logged, never echoed in an error message, and never
//   leaves this file except as the Authorization header value.
//
// PII discipline (spec §7 #18 — this product's subjects include minors):
// - Every prompt passes through minimizePii() INSIDE generateText(), so a
//   caller cannot bypass the scrub by forgetting it.
// - The scrub redacts structural identifiers (emails, phone-like numbers,
//   long numeric IDs). It cannot redact NAMES generically — so callers MUST
//   refer to pupils as "this student" and pass de-identified context only.
//   The default system prompt instructs the model the same way.
// - No new runtime deps: global fetch only.
export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Single model choice for the whole product (short-text tasks per spec
// §2). Overridable per-environment via GROQ_MODEL; there is no per-call
// model parameter, so callers cannot fragment the choice. Default tracks
// Groq's live production list — verified 2026-10-07 against the account's
// own /models endpoint (llama-3.3-70b-versatile is NOT served anymore, so
// it 404s; gpt-oss-20b is the fast production pick for short text).
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-20b";

export function groqModel(): string {
  const override = (process.env.GROQ_MODEL ?? "").trim();
  return override.length > 0 ? override : GROQ_DEFAULT_MODEL;
}

// Short-text tasks (remarks, anomaly notes) — generous enough for a remark
// paragraph, capped so one call cannot burn the free daily quota.
export const GROQ_DEFAULT_MAX_TOKENS = 300;
export const GROQ_MAX_TOKENS_CAP = 1024;

// Bounded like the mailer timeouts: a hanging provider must fail fast,
// never hold an awaiting HTTP response hostage.
const GROQ_TIMEOUT_MS = 15000;

export class GroqUnconfiguredError extends Error {
  constructor() {
    super("AI features are not configured. Set GROQ_API_KEY (free, no card — see .env.example).");
  }
}

export class GroqApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function groqKey(): string {
  const key = (process.env.GROQ_API_KEY ?? "").trim();
  if (!key) {
    throw new GroqUnconfiguredError();
  }
  return key;
}

export function isGroqConfigured(): boolean {
  return (process.env.GROQ_API_KEY ?? "").trim().length > 0;
}

// Structural-identifier scrub (see header: names are the caller's job).
// - email addresses -> [redacted-email]
// - phone-like runs (8+ digits allowing spaces/dashes/brackets/+) ->
//   [redacted-phone]; short numbers (marks, years, counts) are untouched.
// - long bare digit runs (6+) -> [redacted-id] (years are 4 digits, marks
//   at most 3 — neither trips this).
export function minimizePii(text: string): string {
  const noEmails = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]");
  const noPhones = noEmails.replace(/\+?[\d\s().-]*\d[\d\s().-]*\d[\d\s().-]*/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 8 ? "[redacted-phone]" : m;
  });
  return noPhones.replace(/\d{6,}/g, "[redacted-id]");
}

// The model is instructed the same way the callers are: de-identified
// input, "this student", never invent personal details.
export const GROQ_DEFAULT_SYSTEM_PROMPT =
  "You are a school assistant writing short, professional remarks. " +
  "Use only the information given; refer to the pupil as 'this student'. " +
  "Never invent names, scores, or personal details.";

export interface GroqGenerateInput {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GroqClient {
  generateText(input: GroqGenerateInput): Promise<string>;
}

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

class GroqApiClient implements GroqClient {
  async generateText(input: GroqGenerateInput): Promise<string> {
    const key = groqKey();
    // The scrub lives HERE, not in callers — see header.
    const prompt = minimizePii(input.prompt);
    const system = input.system ?? GROQ_DEFAULT_SYSTEM_PROMPT;
    const maxTokens = Math.min(Math.max(input.maxTokens ?? GROQ_DEFAULT_MAX_TOKENS, 1), GROQ_MAX_TOKENS_CAP);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: groqModel(),
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          max_tokens: maxTokens,
          temperature: input.temperature ?? 0.7,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new GroqApiError(504, "Groq request timed out.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new GroqApiError(res.status, `Groq request failed with status ${res.status}.`);
    }
    const body: unknown = await res.json();
    const content =
      typeof body === "object" && body !== null
        ? (body as GroqChatResponse).choices?.[0]?.message?.content
        : undefined;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new GroqApiError(res.status, "Groq returned an empty response.");
    }
    return content.trim();
  }
}

let override: GroqClient | null = null;

// Test seam (mailer.ts shape): tests inject a recorder; production always
// hits Groq. There is no log-and-pretend fallback — §7 says AI is real.
export function setGroqClient(client: GroqClient | null): void {
  override = client;
}

// Ready-made recorder for tests: captures inputs, returns canned text.
export function stubGroqClient(reply = "Stubbed remark."): GroqClient & { calls: GroqGenerateInput[] } {
  const calls: GroqGenerateInput[] = [];
  return {
    calls,
    generateText: async (input: GroqGenerateInput) => {
      calls.push(input);
      return reply;
    },
  };
}

export function groq(): GroqClient {
  if (override) {
    return override;
  }
  if (!isGroqConfigured()) {
    throw new GroqUnconfiguredError();
  }
  return new GroqApiClient();
}
