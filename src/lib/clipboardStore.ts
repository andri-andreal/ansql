import type { AnsqlClipboard } from "../types";

export interface ClipboardEntry {
  payload: AnsqlClipboard;
  seq: number;
}

type Listener = () => void;

/**
 * Module-level internal clipboard. Holds the structured cross-DB payload; the OS
 * clipboard separately carries TSV (written by the copy sites). `seq` increases
 * on every set so consumers can detect a fresh copy, and `isStale` reports when
 * the payload's source session is no longer open.
 */
class ClipboardStore {
  private entry: ClipboardEntry | null = null;
  private seq = 0;
  private listeners = new Set<Listener>();

  set(payload: AnsqlClipboard): void {
    this.seq += 1;
    this.entry = { payload, seq: this.seq };
    this.emit();
  }

  /** The current payload, or null if empty. */
  get(): AnsqlClipboard | null {
    return this.entry?.payload ?? null;
  }

  /** The current entry (payload + seq) without unwrapping. */
  peek(): ClipboardEntry | null {
    return this.entry;
  }

  clear(): void {
    if (this.entry === null) return;
    this.entry = null;
    this.emit();
  }

  /** True when there is no payload, or its source session id is not in `openSessionIds`. */
  isStale(openSessionIds: string[]): boolean {
    if (!this.entry) return true;
    return !openSessionIds.includes(this.entry.payload.source.sessionId);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const clipboardStore = new ClipboardStore();
