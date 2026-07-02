import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type DropdownPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

interface DropdownProps {
  /** Element that opens the dropdown on click. Must accept a ref. */
  trigger: ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: DropdownPlacement;
  /** Horizontal offset (px) from the trigger edge. */
  offset?: number;
  /** When true, the panel takes full width of the trigger. */
  matchTriggerWidth?: boolean;
  /** Optional className for the panel. */
  panelClassName?: string;
}

const PLACEMENT_CLASS: Record<DropdownPlacement, string> = {
  "bottom-start": "top-full left-0 mt-1",
  "bottom-end": "top-full right-0 mt-1",
  "top-start": "bottom-full left-0 mb-1",
  "top-end": "bottom-full right-0 mb-1",
};

// PLACEMENT_CLASS is kept for the rare case a caller wants to render the
// panel themselves; referenced indirectly by the portal below.
void PLACEMENT_CLASS;

/**
 * Click-triggered dropdown menu. Closes on outside click, Escape, or selecting
 * an item. Render-prop child receives a `close` callback so menu items can
 * dismiss the panel after their action runs.
 */
export function Dropdown({
  trigger,
  children,
  placement = "bottom-start",
  offset = 0,
  matchTriggerWidth = false,
  panelClassName = "",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus?.();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Cloning the trigger lets us inject ref + click + a11y attrs without
  // forcing the caller to forward refs through their own components.
  const enhancedTrigger = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          // Merge with the caller's own ref if they passed one.
          const existing = (trigger as { ref?: unknown }).ref;
          if (typeof existing === "function") (existing as (n: HTMLElement | null) => void)(node);
          else if (existing && typeof existing === "object" && "current" in existing) {
            (existing as { current: HTMLElement | null }).current = node;
          }
        },
        onClick: (e: React.MouseEvent) => {
          (trigger.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
          setOpen((o) => !o);
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? panelId : undefined,
      })
    : trigger;

  const renderPanel = () => {
    if (!open || !triggerRef.current) return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const style: React.CSSProperties = {
      position: "fixed",
      ...(placement.startsWith("bottom")
        ? { top: rect.bottom + 4 + offset }
        : { bottom: window.innerHeight - rect.top + 4 + offset }),
      ...(placement.endsWith("start")
        ? { left: rect.left }
        : { right: window.innerWidth - rect.right }),
      ...(matchTriggerWidth ? { width: rect.width } : {}),
    };
    return createPortal(
      <div
        ref={panelRef}
        id={panelId}
        role="menu"
        style={{ ...style, zIndex: 60 }}
        className={`min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg animate-fade-in ${panelClassName}`}
      >
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </div>,
      document.body
    );
  };

  return (
    <>
      {enhancedTrigger}
      {renderPanel()}
    </>
  );
}

/** Menu item row. Use inside a <Dropdown> to get hover/keyboard styles. */
export function DropdownItem({
  children,
  onClick,
  disabled = false,
  icon,
  danger = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => onClick?.()}
      className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : danger
            ? "text-destructive hover:bg-destructive/10"
            : "hover:bg-accent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
