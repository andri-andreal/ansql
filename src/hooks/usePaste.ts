import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AnsqlClipboard } from "../types";
import { clipboardStore } from "../lib/clipboardStore";

/** Where a paste landed. `null` means "unknown" — the modal must ask. */
export type PasteTarget =
  | { kind: "grid"; sessionId: string; database: string; table: string; schema?: string | null }
  | { kind: "node"; sessionId: string; database: string; table?: string; schema?: string | null }
  | { kind: "picker" };

export type PasteDecision =
  | { action: "none" }
  | { action: "grid-fast-path" }
  | { action: "open-modal"; clip: AnsqlClipboard; target: PasteTarget | null };

/**
 * Decide how a paste should be handled. Same-DB cell/snapshot pastes stay on the
 * existing instant in-grid path; everything cross-DB or table-level opens the
 * configurable modal. Pure — no React, no side effects.
 */
export function decidePaste(
  clip: AnsqlClipboard | null,
  target: PasteTarget | null
): PasteDecision {
  if (!clip) return { action: "none" };

  const isCellKind = clip.kind === "row-snapshot";
  const sameDb =
    !!target &&
    (target.kind === "grid" || target.kind === "node") &&
    target.sessionId === clip.source.sessionId &&
    target.database === clip.source.database;

  if (isCellKind && sameDb && target.kind === "grid") {
    return { action: "grid-fast-path" };
  }
  return { action: "open-modal", clip, target };
}

interface PasteRequest {
  clip: AnsqlClipboard;
  target: PasteTarget | null;
}

interface PasteController {
  /** Run the dispatch decision for a target; opens the modal when appropriate.
   *  Returns true if the caller should suppress its own (legacy) paste. */
  requestPaste: (target: PasteTarget | null) => boolean;
  pending: PasteRequest | null;
  close: () => void;
}

const Ctx = createContext<PasteController | null>(null);

export function PasteProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PasteRequest | null>(null);

  const requestPaste = useCallback((target: PasteTarget | null): boolean => {
    const decision = decidePaste(clipboardStore.get(), target);
    if (decision.action === "open-modal") {
      setPending({ clip: decision.clip, target: decision.target });
      return true;
    }
    // "none" or "grid-fast-path": let the caller handle it.
    return false;
  }, []);

  const close = useCallback(() => setPending(null), []);

  const value = useMemo(() => ({ requestPaste, pending, close }), [requestPaste, pending, close]);
  return createElement(Ctx.Provider, { value }, children);
}

export function usePasteController(): PasteController {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePasteController must be used within PasteProvider");
  return ctx;
}
