import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  aiChat,
  aiChatStream,
  DEFAULT_MODELS,
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  type AiConfig,
  type AiMessage,
} from "./aiProviders";

/** Build a Response-like stub that vi-mocked fetch returns. */
function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function errResponse(status: number, statusText: string, body: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

/** Build a streaming Response-like stub whose body emits the given string
 * chunks (encoded as UTF-8) via a ReadableStream, the way fetch() does. */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(chunks[i++]) };
        },
        releaseLock() {},
      };
    },
  };
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body,
  } as unknown as Response;
}

/** Parse the most recent fetch call into { url, init, body }. */
function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  const headers = (init.headers ?? {}) as Record<string, string>;
  const body = init.body ? JSON.parse(init.body as string) : undefined;
  return { url, init, headers, body };
}

const SYSTEM: AiMessage = { role: "system", content: "You are a SQL expert." };
const USER: AiMessage = { role: "user", content: "Explain SELECT 1" };

describe("aiProviders constants", () => {
  it("exposes the documented default models", () => {
    expect(DEFAULT_MODELS.anthropic).toBe("claude-opus-4-8");
    expect(DEFAULT_MODELS.openai).toBe("gpt-4o");
    expect(DEFAULT_MODELS.ollama).toBe("llama3.1");
  });

  it("exposes suggested provider models", () => {
    expect(PROVIDER_MODELS.anthropic).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(PROVIDER_MODELS.openai).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(PROVIDER_MODELS.ollama).toEqual([]);
  });

  it("exposes provider labels", () => {
    expect(PROVIDER_LABELS.anthropic).toBe("Anthropic (Claude)");
    expect(PROVIDER_LABELS.openai).toBe("OpenAI");
    expect(PROVIDER_LABELS.ollama).toBe("Ollama (local)");
  });
});

describe("aiChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("anthropic", () => {
    const config: AiConfig = {
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "sk-ant-test",
      maxTokens: 1024,
    };

    it("posts to the messages endpoint with the documented headers", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ content: [{ type: "text", text: "hi" }] }),
      );

      await aiChat(config, [SYSTEM, USER]);

      const { url, headers } = lastCall(fetchMock);
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
      expect(headers["content-type"]).toBe("application/json");
    });

    it("hoists system messages to the top-level system field", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ content: [{ type: "text", text: "hi" }] }),
      );

      await aiChat(config, [SYSTEM, USER]);

      const { body } = lastCall(fetchMock);
      expect(body.system).toBe("You are a SQL expert.");
      // System must NOT appear in the messages array.
      expect(body.messages).toEqual([{ role: "user", content: "Explain SELECT 1" }]);
      expect(body.max_tokens).toBe(1024);
    });

    it("joins multiple system messages and keeps user/assistant order", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ content: [{ type: "text", text: "ok" }] }),
      );

      await aiChat(config, [
        { role: "system", content: "A" },
        USER,
        { role: "assistant", content: "prev" },
        { role: "system", content: "B" },
        { role: "user", content: "more" },
      ]);

      const { body } = lastCall(fetchMock);
      expect(body.system).toBe("A\n\nB");
      expect(body.messages).toEqual([
        { role: "user", content: "Explain SELECT 1" },
        { role: "assistant", content: "prev" },
        { role: "user", content: "more" },
      ]);
    });

    it("does NOT send temperature/top_p/top_k or thinking", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ content: [{ type: "text", text: "hi" }] }),
      );

      await aiChat(config, [SYSTEM, USER]);

      const { body } = lastCall(fetchMock);
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("top_p");
      expect(body).not.toHaveProperty("top_k");
      expect(body).not.toHaveProperty("thinking");
    });

    it("defaults max_tokens to 4096 when unset", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ content: [{ type: "text", text: "hi" }] }),
      );

      await aiChat({ provider: "anthropic", model: "claude-opus-4-8", apiKey: "k" }, [
        USER,
      ]);

      const { body } = lastCall(fetchMock);
      expect(body.max_tokens).toBe(4096);
      // No system messages -> no system field.
      expect(body).not.toHaveProperty("system");
    });

    it("extracts and concatenates only type:text blocks", async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        }),
      );

      const out = await aiChat(config, [USER]);
      expect(out).toBe("Hello world");
    });

    it("throws with status and provider error body on non-2xx", async () => {
      fetchMock.mockResolvedValue(
        errResponse(400, "Bad Request", '{"error":{"message":"bad model"}}'),
      );

      await expect(aiChat(config, [USER])).rejects.toThrow(/400/);
      await expect(aiChat(config, [USER])).rejects.toThrow(/bad model/);
      await expect(aiChat(config, [USER])).rejects.toThrow(/Anthropic/);
    });
  });

  describe("openai", () => {
    const config: AiConfig = {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-openai",
      maxTokens: 512,
    };

    it("posts to chat/completions with the Authorization bearer header", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ choices: [{ message: { content: "answer" } }] }),
      );

      await aiChat(config, [SYSTEM, USER]);

      const { url, headers, body } = lastCall(fetchMock);
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(headers.Authorization).toBe("Bearer sk-openai");
      expect(headers["content-type"]).toBe("application/json");
      // OpenAI keeps system in the messages array.
      expect(body.messages).toEqual([
        { role: "system", content: "You are a SQL expert." },
        { role: "user", content: "Explain SELECT 1" },
      ]);
      expect(body.max_tokens).toBe(512);
      expect(body.model).toBe("gpt-4o");
    });

    it("respects a custom baseUrl (trailing slash trimmed)", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ choices: [{ message: { content: "x" } }] }),
      );

      await aiChat({ ...config, baseUrl: "https://proxy.example.com/" }, [USER]);

      const { url } = lastCall(fetchMock);
      expect(url).toBe("https://proxy.example.com/v1/chat/completions");
    });

    it("extracts choices[0].message.content", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ choices: [{ message: { content: "the answer" } }] }),
      );

      const out = await aiChat(config, [USER]);
      expect(out).toBe("the answer");
    });

    it("throws with status and body on non-2xx", async () => {
      fetchMock.mockResolvedValue(
        errResponse(401, "Unauthorized", '{"error":{"message":"no key"}}'),
      );

      await expect(aiChat(config, [USER])).rejects.toThrow(/401/);
      await expect(aiChat(config, [USER])).rejects.toThrow(/no key/);
      await expect(aiChat(config, [USER])).rejects.toThrow(/OpenAI/);
    });
  });

  describe("ollama", () => {
    const config: AiConfig = { provider: "ollama", model: "llama3.1" };

    it("posts to the local api/chat with stream:false and no auth", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ message: { content: "local answer" } }),
      );

      await aiChat(config, [SYSTEM, USER]);

      const { url, headers, body } = lastCall(fetchMock);
      expect(url).toBe("http://localhost:11434/api/chat");
      expect(headers.Authorization).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
      expect(body.stream).toBe(false);
      expect(body.model).toBe("llama3.1");
      expect(body.messages).toEqual([
        { role: "system", content: "You are a SQL expert." },
        { role: "user", content: "Explain SELECT 1" },
      ]);
    });

    it("extracts message.content", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ message: { content: "from ollama" } }),
      );

      const out = await aiChat(config, [USER]);
      expect(out).toBe("from ollama");
    });

    it("uses a custom baseUrl when provided", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ message: { content: "x" } }),
      );

      await aiChat({ ...config, baseUrl: "http://remote:1234" }, [USER]);

      const { url } = lastCall(fetchMock);
      expect(url).toBe("http://remote:1234/api/chat");
    });

    it("throws with status and body on non-2xx", async () => {
      fetchMock.mockResolvedValue(
        errResponse(500, "Internal Server Error", "model not found"),
      );

      await expect(aiChat(config, [USER])).rejects.toThrow(/500/);
      await expect(aiChat(config, [USER])).rejects.toThrow(/model not found/);
      await expect(aiChat(config, [USER])).rejects.toThrow(/Ollama/);
    });
  });

  it("forwards the abort signal to fetch", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ content: [{ type: "text", text: "hi" }] }),
    );
    const controller = new AbortController();

    await aiChat(
      { provider: "anthropic", model: "claude-opus-4-8", apiKey: "k" },
      [USER],
      { signal: controller.signal },
    );

    const { init } = lastCall(fetchMock);
    expect(init.signal).toBe(controller.signal);
  });
});

describe("aiChatStream", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("anthropic", () => {
    const config: AiConfig = {
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "sk-ant-test",
    };

    it("sends stream:true and parses content_block_delta SSE events", async () => {
      // Split deltas across read boundaries to exercise line buffering.
      fetchMock.mockResolvedValue(
        streamResponse([
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel',
          'lo "}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
      );

      const chunks: string[] = [];
      const full = await aiChatStream(config, [USER], (t) => chunks.push(t));

      const { body } = lastCall(fetchMock);
      expect(body.stream).toBe(true);
      // Only the text deltas surface as chunks; non-delta events are ignored.
      expect(chunks).toEqual(["Hello ", "world"]);
      expect(full).toBe("Hello world");
    });

    it("hoists system messages and posts the documented headers", async () => {
      fetchMock.mockResolvedValue(
        streamResponse([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
        ]),
      );

      await aiChatStream(config, [SYSTEM, USER], () => {});

      const { url, headers, body } = lastCall(fetchMock);
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
      expect(body.system).toBe("You are a SQL expert.");
      expect(body.messages).toEqual([{ role: "user", content: "Explain SELECT 1" }]);
    });

    it("throws with status and provider error body on non-2xx", async () => {
      fetchMock.mockResolvedValue(
        errResponse(400, "Bad Request", '{"error":{"message":"bad model"}}'),
      );

      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/400/);
      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/bad model/);
      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/Anthropic/);
    });
  });

  describe("openai", () => {
    const config: AiConfig = {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-openai",
    };

    it("sends stream:true, parses delta.content and stops at [DONE]", async () => {
      fetchMock.mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"the "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
          "data: [DONE]\n\n",
          // Anything after [DONE] must be ignored.
          'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
        ]),
      );

      const chunks: string[] = [];
      const full = await aiChatStream(config, [USER], (t) => chunks.push(t));

      const { url, body } = lastCall(fetchMock);
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(body.stream).toBe(true);
      expect(chunks).toEqual(["the ", "answer"]);
      expect(full).toBe("the answer");
    });

    it("throws with status and body on non-2xx", async () => {
      fetchMock.mockResolvedValue(
        errResponse(401, "Unauthorized", '{"error":{"message":"no key"}}'),
      );

      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/401/);
      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/OpenAI/);
    });
  });

  describe("ollama", () => {
    const config: AiConfig = { provider: "ollama", model: "llama3.1" };

    it("sends stream:true and parses NDJSON message.content lines", async () => {
      fetchMock.mockResolvedValue(
        streamResponse([
          '{"message":{"content":"from "},"done":false}\n',
          // A line split across two reads.
          '{"message":{"content":"oll',
          'ama"},"done":false}\n',
          '{"message":{"content":""},"done":true}\n',
        ]),
      );

      const chunks: string[] = [];
      const full = await aiChatStream(config, [USER], (t) => chunks.push(t));

      const { url, body } = lastCall(fetchMock);
      expect(url).toBe("http://localhost:11434/api/chat");
      expect(body.stream).toBe(true);
      expect(chunks).toEqual(["from ", "ollama"]);
      expect(full).toBe("from ollama");
    });

    it("throws with status and body on non-2xx", async () => {
      fetchMock.mockResolvedValue(
        errResponse(500, "Internal Server Error", "model not found"),
      );

      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/500/);
      await expect(aiChatStream(config, [USER], () => {})).rejects.toThrow(/Ollama/);
    });
  });

  it("forwards the abort signal to fetch", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
      ]),
    );
    const controller = new AbortController();

    await aiChatStream(
      { provider: "anthropic", model: "claude-opus-4-8", apiKey: "k" },
      [USER],
      () => {},
      { signal: controller.signal },
    );

    const { init } = lastCall(fetchMock);
    expect(init.signal).toBe(controller.signal);
  });
});
