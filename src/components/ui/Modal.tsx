import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Optional secondary content rendered in the header next to the close button. */
  headerActions?: ReactNode;
  /** Body content. */
  children: ReactNode;
  /** Footer content (e.g. action buttons). Stays sticky at the bottom. */
  footer?: ReactNode;
  size?: ModalSize;
  /** When false, the user cannot dismiss the modal with Escape / click outside. */
  dismissable?: boolean;
}

// Fixed widths (capped at 90vw) rather than `w-full max-w-*`: WebKitGTK (the
// Tauri Linux webview) collapses a flex item whose width is a *percentage*
// (`w-full`) when that item is itself a flex container, so the dialog renders
// zero-width / blank. An explicit length width sidesteps that quirk.
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "w-[24rem] max-w-[90vw]",
  md: "w-[28rem] max-w-[90vw]",
  lg: "w-[32rem] max-w-[90vw]",
  xl: "w-[42rem] max-w-[90vw]",
};

// Focusable element selector. Excludes elements with tabindex="-1" and disabled.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Accessible modal dialog. Renders into a portal, traps focus, locks body scroll,
 * closes on Escape (unless `dismissable` is false), and restores focus to the
 * previously focused element on close.
 */
export function Modal({
  open,
  onClose,
  title,
  headerActions,
  children,
  footer,
  size = "md",
  dismissable = true,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Body scroll lock + restore previous focus. Capture the active element on
  // open and restore it on close so keyboard users don't lose their place.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape to close. Attached to document so it works regardless of focus.
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  // Initial focus + focus trap. On open, focus the first focusable element
  // (or the panel itself). While open, intercept Tab/Shift+Tab to wrap focus
  // inside the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
      );
    // Defer to next tick so the modal is in the DOM.
    const initial = focusables()[0] ?? panel;
    initial.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center animate-fade-in p-4"
      onClick={() => {
        if (dismissable) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`bg-card rounded-lg shadow-xl ${SIZE_CLASS[size]} max-h-[90vh] flex flex-col animate-slide-up outline-none`}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <h2 id={titleId} className="text-lg font-semibold truncate">
            {title}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {headerActions}
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
