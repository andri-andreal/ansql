import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Square,
  X,
  Settings2,
  Paperclip,
  ClipboardCopy,
  Replace,
  Trash2,
  AlertCircle,
} from "lucide-react";
import {
  aiChat,
  aiChatStream,
  type AiConfig,
  type AiMessage,
} from "../../lib/aiProviders";
import { useTranslation } from "../../i18n";

export interface AiAssistantPaneProps {
  config: AiConfig;
  isConfigured: boolean;
  /** When not configured, a button routes here. */
  onOpenSettings: () => void;
  /** Optional: build a schema summary for the active session (used by an "Attach schema" toggle). */
  getSchemaContext?: () => Promise<string | null>;
  /** Optional: when set (e.g. from an Ask AI action), prefill + auto-send these. */
  seedMessages?: AiMessage[];
  /** "Insert into editor" on an assistant message (extract fenced sql if present). */
  onInsertSql?: (sql: string) => void;
  /** "Replace selection" on an assistant message — replaces the editor's current
   * selection with the fenced SQL (extract fenced sql if present). */
  onReplaceSelection?: (sql: string) => void;
  onClose: () => void;
}

/** A chat turn we actually render (system messages are kept out of the visible thread). */
interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** localStorage key for persisting the visible chat thread across pane close / restart. */
const CHAT_STORAGE_KEY = "ansql.aiChat";

/** Load the persisted thread (defensively — bad/empty storage yields []). */
function loadStoredTurns(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is ChatTurn =>
        !!t &&
        typeof t === "object" &&
        (((t as ChatTurn).role === "user") || ((t as ChatTurn).role === "assistant")) &&
        typeof (t as ChatTurn).content === "string",
    );
  } catch {
    return [];
  }
}

/** Pull the first ```sql fenced block out of a message (fallback to any fenced block). */
function extractSql(text: string): string | null {
  const sqlFence = text.match(/```sql\s*\n?([\s\S]*?)```/i);
  if (sqlFence) return sqlFence[1].trim();
  const anyFence = text.match(/```[a-z]*\s*\n?([\s\S]*?)```/i);
  if (anyFence) return anyFence[1].trim();
  return null;
}

function AiAssistantPane({
  config,
  isConfigured,
  onOpenSettings,
  getSchemaContext,
  seedMessages,
  onInsertSql,
  onReplaceSelection,
  onClose,
}: AiAssistantPaneProps) {
  const { t } = useTranslation();
  // Restore the persisted thread on mount so chat survives pane close / restart.
  const [turns, setTurns] = useState<ChatTurn[]>(loadStoredTurns);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachSchema, setAttachSchema] = useState(false);
  // The assistant message currently being streamed (null = none in flight).
  const [streaming, setStreaming] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const seededRef = useRef(false);
  // Mirror of `streaming` so the runChat catch can commit partial text without a
  // stale closure value.
  const streamingRef = useRef<string | null>(null);
  streamingRef.current = streaming;

  // Persist the visible thread whenever it changes (skip the live streaming
  // buffer — only committed turns are written).
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(turns));
    } catch {
      // Storage may be unavailable / full — chat persistence is best-effort.
    }
  }, [turns]);

  // Auto-scroll the message list as turns/streaming change.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, streaming]);

  // Abort any in-flight request on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /**
   * Send `nextTurns` to the model. The visible thread is already updated to
   * `nextTurns`; this builds the wire messages (optionally prepending a schema
   * system message) and appends the assistant reply.
   */
  const runChat = useCallback(
    async (nextTurns: ChatTurn[]) => {
      setError(null);
      setBusy(true);
      setStreaming("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const wire: AiMessage[] = [];

        if (attachSchema && getSchemaContext) {
          const schema = await getSchemaContext();
          if (schema && schema.trim()) {
            wire.push({
              role: "system",
              content: `Relevant database schema:\n${schema}`,
            });
          }
        }

        for (const t of nextTurns) wire.push({ role: t.role, content: t.content });

        // Stream the reply, appending each incremental delta to the live buffer.
        let reply: string;
        try {
          let acc = "";
          reply = await aiChatStream(
            config,
            wire,
            (chunk) => {
              acc += chunk;
              setStreaming(acc);
            },
            { signal: controller.signal },
          );
        } catch (streamErr) {
          // If the stream failed before delivering any text (and we weren't
          // aborted), fall back to a non-streaming completion.
          if (controller.signal.aborted) throw streamErr;
          reply = await aiChat(config, wire, { signal: controller.signal });
        }
        setStreaming(null);
        setTurns((prev) => [...prev, { role: "assistant", content: reply }]);
      } catch (e) {
        // A user-initiated abort isn't an error worth surfacing loudly. Commit
        // whatever partial text was streamed so it isn't lost.
        const partial = streamingRef.current;
        setStreaming(null);
        if (controller.signal.aborted) {
          if (partial && partial.trim()) {
            setTurns((prev) => [...prev, { role: "assistant", content: partial }]);
          }
          setError(t("io.stopped"));
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [attachSchema, getSchemaContext, config, t],
  );

  // One-shot: when seedMessages is provided, prefill the visible thread and auto-send.
  useEffect(() => {
    if (seededRef.current) return;
    if (!seedMessages || seedMessages.length === 0) return;
    if (!isConfigured) return;
    seededRef.current = true;

    const visible: ChatTurn[] = seedMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    // A new Ask AI / Fix-with-AI seed starts a fresh thread (replacing any
    // restored history) so the seeded context isn't confused with prior chat.
    setTurns(visible);

    // Send the seed messages verbatim (including any system prompt) without
    // routing through attachSchema, so Ask AI actions keep their own context.
    setBusy(true);
    setError(null);
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    (async () => {
      let reply: string;
      try {
        let acc = "";
        reply = await aiChatStream(
          config,
          seedMessages,
          (chunk) => {
            acc += chunk;
            setStreaming(acc);
          },
          { signal: controller.signal },
        );
      } catch (streamErr) {
        if (controller.signal.aborted) throw streamErr;
        reply = await aiChat(config, seedMessages, { signal: controller.signal });
      }
      return reply;
    })()
      .then((reply) => {
        setStreaming(null);
        setTurns((prev) => [...prev, { role: "assistant", content: reply }]);
      })
      .catch((e) => {
        const partial = streamingRef.current;
        setStreaming(null);
        if (controller.signal.aborted) {
          if (partial && partial.trim()) {
            setTurns((prev) => [...prev, { role: "assistant", content: partial }]);
          }
          setError(t("io.stopped"));
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMessages, isConfigured]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: text }];
    setTurns(nextTurns);
    setInput("");
    void runChat(nextTurns);
  }, [input, busy, turns, runChat]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Clear the visible thread + persisted history (abort any in-flight request).
  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setStreaming(null);
    setError(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ── Not-configured empty state ─────────────────────────────────────────────
  if (!isConfigured) {
    return (
      <div className="w-[380px] h-full bg-card border-l border-border flex flex-col">
        <PaneHeader config={config} onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="p-3 rounded-full bg-secondary">
            <Sparkles className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">{t("io.aiNotConfiguredTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("io.aiNotConfiguredHint")}
            </p>
          </div>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Settings2 className="w-4 h-4" />
            {t("io.configureAi")}
          </button>
        </div>
      </div>
    );
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  return (
    <div className="w-[380px] h-full bg-card border-l border-border flex flex-col">
      <PaneHeader
        config={config}
        onClose={onClose}
        onClear={turns.length > 0 ? handleClear : undefined}
      />

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {turns.length === 0 && !busy && (
          <div className="text-xs text-muted-foreground text-center py-8 px-4">
            {t("io.aiEmptyHint", { provider: config.provider })}
          </div>
        )}

        {turns.map((turn, i) => (
          <MessageBubble
            key={i}
            turn={turn}
            onInsertSql={onInsertSql}
            onReplaceSelection={onReplaceSelection}
          />
        ))}

        {/* Live streaming assistant bubble (rendered while text arrives). */}
        {streaming !== null && streaming.length > 0 && (
          <div className="flex justify-start">
            <div className="max-w-[88%] bg-secondary text-foreground rounded-lg rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words">
              {streaming}
              <span className="ml-0.5 inline-block w-1.5 h-3 align-middle bg-current animate-pulse" />
            </div>
          </div>
        )}

        {/* Pre-first-token spinner (only before any streamed text). */}
        {busy && (streaming === null || streaming.length === 0) && (
          <div className="flex justify-start">
            <div className="bg-secondary text-foreground rounded-lg rounded-bl-sm px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
              </span>
              {t("io.thinking")}
            </div>
          </div>
        )}
      </div>

      {/* Error strip */}
      {error && (
        <div className="px-3 py-2 border-t border-border bg-destructive/10 flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="break-words min-w-0">{error}</span>
        </div>
      )}

      {/* Input row */}
      <div className="border-t border-border p-2 space-y-2">
        {getSchemaContext && (
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={attachSchema}
              onChange={(e) => setAttachSchema(e.target.checked)}
              className="accent-primary"
            />
            <Paperclip className="w-3 h-3" />
            {t("io.attachSchema")}
          </label>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={t("io.askAssistantPlaceholder")}
            className="flex-1 resize-none bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 transition-colors max-h-40"
          />
          {busy ? (
            <button
              onClick={handleStop}
              title={t("io.stop")}
              className="p-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors shrink-0"
            >
              <Square className="w-4 h-4" fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              title={t("io.send")}
              className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shared header: title + provider/model chip + optional clear + close. */
function PaneHeader({
  config,
  onClose,
  onClear,
}: {
  config: AiConfig;
  onClose: () => void;
  /** When set, renders a "Clear chat" button (omitted when there's nothing to clear). */
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium">{t("io.aiAssistant")}</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground truncate max-w-[140px]"
          title={`${config.provider} · ${config.model}`}
        >
          {config.model}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onClear && (
          <button
            onClick={onClear}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title={t("io.clearChat")}
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-secondary rounded transition-colors"
          title={t("io.close")}
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

/** A single user/assistant bubble; assistant bubbles offer "Insert into editor"
 * and "Replace selection" for fenced SQL. */
function MessageBubble({
  turn,
  onInsertSql,
  onReplaceSelection,
}: {
  turn: ChatTurn;
  onInsertSql?: (sql: string) => void;
  onReplaceSelection?: (sql: string) => void;
}) {
  const { t } = useTranslation();
  const isUser = turn.role === "user";
  const sql = !isUser ? extractSql(turn.content) : null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-secondary text-foreground rounded-bl-sm"
        }`}
      >
        {turn.content}
        {sql && (onInsertSql || onReplaceSelection) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {onInsertSql && (
              <button
                onClick={() => onInsertSql(sql)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs bg-background/60 text-foreground border border-border rounded hover:bg-background transition-colors"
              >
                <ClipboardCopy className="w-3 h-3" />
                {t("io.insertIntoEditor")}
              </button>
            )}
            {onReplaceSelection && (
              <button
                onClick={() => onReplaceSelection(sql)}
                title={t("io.replaceSelectionTitle")}
                className="flex items-center gap-1.5 px-2 py-1 text-xs bg-background/60 text-foreground border border-border rounded hover:bg-background transition-colors"
              >
                <Replace className="w-3 h-3" />
                {t("io.replaceSelection")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { AiAssistantPane };
export default AiAssistantPane;
