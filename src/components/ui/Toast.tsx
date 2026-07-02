import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastInput {
  message: ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. 0 = sticky (no auto-dismiss). Default 4000. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, "duration">> {
  id: number;
  duration: number;
}

interface ToastContextValue {
  show: (toast: ToastInput) => number;
  success: (message: ReactNode, duration?: number) => number;
  error: (message: ReactNode, duration?: number) => number;
  info: (message: ReactNode, duration?: number) => number;
  warning: (message: ReactNode, duration?: number) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

const ICON_CLASS: Record<ToastVariant, string> = {
  success: "text-green-500",
  info: "text-blue-500",
  warning: "text-amber-500",
  error: "text-red-500",
};

const DEFAULT_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seqRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    seqRef.current += 1;
    const id = seqRef.current;
    const item: ToastItem = {
      id,
      message: toast.message,
      variant: toast.variant ?? "info",
      duration: toast.duration ?? DEFAULT_DURATION,
    };
    setToasts((list) => [...list, item]);
    if (item.duration > 0) {
      setTimeout(() => dismiss(id), item.duration);
    }
    return id;
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message, duration) => show({ message, variant: "success", duration }),
      error: (message, duration) => show({ message, variant: "error", duration }),
      info: (message, duration) => show({ message, variant: "info", duration }),
      warning: (message, duration) => show({ message, variant: "warning", duration }),
      dismiss,
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(<ToastStack toasts={toasts} onDismiss={dismiss} />, document.body)}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-auto pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = ICONS[toast.variant];
  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className="pointer-events-auto flex items-start gap-3 px-4 py-3 bg-card text-card-foreground border border-border rounded-lg shadow-lg animate-slide-in-right"
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${ICON_CLASS[toast.variant]}`} />
      <div className="text-sm flex-1 break-words">{toast.message}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 -mt-0.5 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Re-export createElement for callers that need the JSX namespace shim.
export { createElement };
