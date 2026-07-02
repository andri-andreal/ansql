import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button is rendered in a destructive style. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small confirmation dialog built on top of <Modal>. Used wherever a yes/no
 * decision is needed (Time Machine snapshot-cap warning, "clear timeline", …).
 * Replaces the native `window.confirm` that was used in TimelinePanel and
 * elsewhere — native confirms are jarring in a Tauri desktop app.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle
            className={`w-5 h-5 ${danger ? "text-red-500" : "text-amber-500"}`}
          />
          {title}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm text-foreground hover:bg-accent transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={[
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              danger
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            ].join(" ")}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-foreground">{message}</div>
    </Modal>
  );
}
