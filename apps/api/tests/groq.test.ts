import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GROQ_API_URL,
  GROQ_DEFAULT_MODEL,
  GroqApiError,
  GroqUnconfiguredError,
  groq,
  groqModel,
  isGroqConfigured,
  minimizePii,
  setGroqClient,
  stubGroqClient,
} from "../src/lib/groq.js";

// Groq wrapper (§7 Phase 3 #18): the single choke point for model choice
// and PII minimization. Pure unit tests — global fetch is stubbed, so no
// key and no network are ever needed. Env mutations are saved/restored
// per test (parallel workers never touch GROQ_* vars).
const savedKey = process.env.GROQ_API_KEY;
const savedModel = process.env.GROQ_MODEL;

afterEach(() => {
  vi.unstubAllGlobals();
  setGroqClient(null);
  if (savedKey === undefined) {
    delete process.env.GROQ_API_KEY;
  } else {
    process.env.GROQ_API_KEY = savedKey;
  }
  if (savedModel === undefined) {
    delete process.env.GROQ_MODEL;
  } else {
    process.env.GROQ_MODEL = savedModel;
  }
});

function setKey(): void {
  process.env.GROQ_API_KEY = "gsk-test-dummy-key";
}

function clearKey(): void {
  delete process.env.GROQ_API_KEY;
}

function stubFetchJson(status: number, payload: unknown): { seen: { url: unknown; init: RequestInit | undefined }[] } {
  const seen: { url: unknown; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string | URL, init?: RequestInit): Promise<Response> => {
      seen.push({ url, init });
      return new Response(JSON.stringify(payload), { status });
    },
  );
  return { seen };
}

describe("Groq wrapper — configuration (fail-closed, §1)", () => {
  it("reports unconfigured with no key and refuses to call", async () => {
    clearKey();
    expect(isGroqConfigured()).toBe(false);
    expect(() => groq()).toThrow(GroqUnconfiguredError);
    // Even the factory refusal must not touch the network.
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called without a key");
    });
    // groq() itself throws synchronously — no promise, no network.
    expect(() => groq().generateText({ prompt: "hello" })).toThrow(GroqUnconfiguredError);
  });

  it("uses one default model, overridable only via env", () => {
    delete process.env.GROQ_MODEL;
    expect(groqModel()).toBe(GROQ_DEFAULT_MODEL);
    process.env.GROQ_MODEL = "llama-3.1-8b-instant";
    expect(groqModel()).toBe("llama-3.1-8b-instant");
  });
});

describe("Groq wrapper — PII minimization (§7 #18, minors' data)", () => {
  it("redacts emails, phone-like numbers, and long numeric ids", () => {
    const out = minimizePii("Contact adi@example.com or +91 98765 43210, admission 202617 about this student.");
    expect(out).not.toContain("adi@example.com");
    expect(out).not.toContain("98765 43210");
    expect(out).not.toContain("202617");
    expect(out).toContain("[redacted-email]");
    expect(out).toContain("[redacted-phone]");
    expect(out).toContain("[redacted-id]");
  });

  it("leaves ordinary remark context (marks, years, dates, prose) intact", () => {
    const text = "This student scored 85 in Mathematics in 2026, attendance 92%. Keep up the good work.";
    expect(minimizePii(text)).toBe(text);
  });
});

describe("Groq wrapper — the single Groq call site", () => {
  it("POSTs the OpenAI-compatible endpoint with bearer auth, the single model, and the SCRUBBED prompt", async () => {
    setKey();
    delete process.env.GROQ_MODEL;
    const { seen } = stubFetchJson(200, { choices: [{ message: { content: "  Steady progress.  " } }] });

    const result = await groq().generateText({ prompt: "Remark for this student. Guardian adi@example.com, phone 9876543210." });

    expect(result).toBe("Steady progress.");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(GROQ_API_URL);
    const init = seen[0]?.init;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer gsk-test-dummy-key");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe(GROQ_DEFAULT_MODEL);
    const userContent = body.messages.find((m) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("[redacted-email]");
    expect(userContent).toContain("[redacted-phone]");
    expect(userContent).not.toContain("adi@example.com");
  });

  it("throws GroqApiError (no secret, no body in the message) on non-2xx", async () => {
    setKey();
    stubFetchJson(429, { error: { message: "rate limited" } });
    const err = await groq().generateText({ prompt: "hi" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroqApiError);
    expect((err as GroqApiError).status).toBe(429);
    expect((err as Error).message).not.toContain("gsk-test-dummy-key");
  });

  it("throws GroqApiError on empty or malformed responses", async () => {
    setKey();
    stubFetchJson(200, { choices: [] });
    await expect(groq().generateText({ prompt: "hi" })).rejects.toThrow(GroqApiError);
    stubFetchJson(200, { nonsense: true });
    await expect(groq().generateText({ prompt: "hi" })).rejects.toThrow(GroqApiError);
  });

  it("maps an aborted (timed-out) request to GroqApiError, not a raw DOMException", async () => {
    setKey();
    vi.stubGlobal("fetch", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const err = await groq().generateText({ prompt: "hi" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroqApiError);
    expect((err as GroqApiError).status).toBe(504);
  });
});

describe("Groq wrapper — test seam (mailer.ts shape)", () => {
  it("records calls and returns canned text without network", async () => {
    clearKey();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called through the stub");
    });
    const stub = stubGroqClient("Canned remark.");
    setGroqClient(stub);
    const result = await groq().generateText({ prompt: "anything" });
    expect(result).toBe("Canned remark.");
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.prompt).toBe("anything");
  });
});
