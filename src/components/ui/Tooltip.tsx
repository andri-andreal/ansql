import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: TooltipPlacement;
  /** Delay in ms before the tooltip appears. Default 300. */
  delay?: number;
  /** When true, the tooltip is not rendered. */
  disabled?: boolean;
}

const PLACEMENT_CLASS: Record<TooltipPlacement, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * Accessible tooltip. Shows on focus + hover, hides on blur + mouseleave.
 * Uses aria-describedby to link the tooltip to its trigger for screen readers.
 */
export function Tooltip({
  content,
  children,
  placement = "top",
  delay = 300,
  disabled = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const show = () => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setCoords({
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
        });
        setVisible(true);
      }
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={(node) => {
          triggerRef.current = node;
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={visible ? tooltipId : undefined}
        className="inline-flex"
      >
        {children}
      </span>
      {visible &&
        coords &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{ position: "absolute", top: coords.top, left: coords.left }}
            className={`z-[80] px-2 py-1 text-xs font-medium text-foreground bg-popover border border-border rounded shadow-md whitespace-nowrap pointer-events-none animate-fade-in ${PLACEMENT_CLASS[placement]}`}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
