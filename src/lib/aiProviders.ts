// Provider-agnostic AI chat client. Calls the provider HTTP APIs directly from
// the Tauri webview via fetch, so the tauri.conf.json CSP must allow the
// provider hosts in `connect-src` (it permits https: and localhost for Ollama).

export type AiProvider = "anthropic" | "openai" | "ollama";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  ollama: "llama3.1",
};

export const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  ollama: [],
};

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  ollama: "Ollama (local)",
};

const ANTHROPIC_VERSION = "2023-06-01";

/** Strip trailing slashes so we can safely append a path. */
function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Build a useful Error message from a non-2xx response, including the status,
 * the provider name, and whatever error text the provider returned. */
async function buildHttpError(provider: AiProvider, res: Response): Promise<Error> {
  let body: string;
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  const label = PROVIDER_LABELS[provider];
  const detail = body ? `: ${body}` : "";
  return new Error(`${label} request failed (${res.status} ${res.statusText})${detail}`);
}

async function chatAnthropic(
  config: AiConfig,
  messages: AiMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = config.baseUrl ? trimBase(config.baseUrl) : "https://api.anthropic.com";

  // The Anthropic messages array does NOT accept role:"system" — hoist all
  // system text to the top-level "system" string field.
  const systemParts: string[] = [];
  const convo: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      convo.push({ role: m.role, content: m.content });
    }
  }

  // Do NOT send temperature/top_p/top_k (they 400 on claude-opus-4-8) and omit
  // the "thinking" field.
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    messages: convo,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      // Required to call from the Tauri webview / browser (bypasses CORS).
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) throw await buildHttpError("anthropic", res);

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const blocks = data.content ?? [];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

async function chatOpenai(
  config: AiConfig,
  messages: AiMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = config.baseUrl ? trimBase(config.baseUrl) : "https://api.openai.com";

  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (typeof config.maxTokens === "number") {
    body.max_tokens = config.maxTokens;
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) throw await buildHttpError("openai", res);

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function chatOllama(
  config: AiConfig,
  messages: AiMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = config.baseUrl ? trimBase(config.baseUrl) : "http://localhost:11434";

  const body = {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) throw await buildHttpError("ollama", res);

  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

/** Send a chat completion to the configured provider and return the assistant
 * text. Throws an Error (with status + provider error body) on non-2xx. */
export async function aiChat(
  config: AiConfig,
  messages: AiMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  switch (config.provider) {
    case "anthropic":
      return chatAnthropic(config, messages, opts);
    case "openai":
      return chatOpenai(config, messages, opts);
    case "ollama":
      return chatOllama(config, messages, opts);
    default: {
      const never: never = config.provider;
      throw new Error(`Unknown AI provider: ${String(never)}`);
    }
  }
}

/** Read a streaming response body line-by-line. Buffers across reads and yields
 * complete lines (newline-delimited); flushes any trailing partial at the end.
 * Used for both SSE ("data:" lines) and Ollama NDJSON. */
async function* readLines(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

async function streamAnthropic(
  config: AiConfig,
  messages: AiMessage[],
  onChunk: (text: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = config.baseUrl ? trimBase(config.baseUrl) : "https://api.anthropic.com";

  const systemParts: string[] = [];
  const convo: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      convo.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    messages: convo,
    stream: true,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) throw await buildHttpError("anthropic", res);

  let full = "";
  for await (const line of readLines(res, opts?.signal)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data) continue;
    let event: { type?: string; delta?: { type?: string; text?: string } };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === "content_block_delta" && typeof event.delta?.text === "string") {
      full += event.delta.text;
      onChunk(event.delta.text);
    }
  }
  return full;
}

async function streamOpenai(
  config: AiConfig,
  messages: AiMessage[],
  onChunk: (text: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = config.baseUrl ? trimBase(config.baseUrl) : "https://api.openai.com";

  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (typeof config.maxTokens === "number") {
    body.max_tokens = config.maxTokens;
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) throw await buildHttpError("openai", res);

  let full = "";
  for await (const line of readLines(res, opts?.signal)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") break;
    let event: { choices?: Array<{ delta?: { content?: string } }> };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const piece = event.choices?.[0]?.delta?.content;
    if (typeof piece === "string" && piece.length > 0) {
      full += piece;
      onChunk(piece);
    }
  }
  return full;
}

async function streamOllama(
  config: AiConfig,
  messages: AiMessage[],
  onChunk: (text: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = config.baseUrl ? trimBase(config.baseUrl) : "http://localhost:11434";

  const body = {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) throw await buildHttpError("ollama", res);

  let full = "";
  for await (const line of readLines(res, opts?.signal)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: { message?: { content?: string }; done?: boolean };
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const piece = event.message?.content;
    if (typeof piece === "string" && piece.length > 0) {
      full += piece;
      onChunk(piece);
    }
    if (event.done) break;
  }
  return full;
}

/** Stream a chat completion from the configured provider. Calls onChunk with
 * each incremental text delta as it arrives and resolves with the full
 * concatenated text. Throws an Error (with status + provider error body) on
 * non-2xx, exactly like aiChat. Honors opts.signal for cancellation. */
export async function aiChatStream(
  config: AiConfig,
  messages: AiMessage[],
  onChunk: (text: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  switch (config.provider) {
    case "anthropic":
      return streamAnthropic(config, messages, onChunk, opts);
    case "openai":
      return streamOpenai(config, messages, onChunk, opts);
    case "ollama":
      return streamOllama(config, messages, onChunk, opts);
    default: {
      const never: never = config.provider;
      throw new Error(`Unknown AI provider: ${String(never)}`);
    }
  }
}
