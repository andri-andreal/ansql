import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

// Imperative, promise-based replacements for the native window.prompt /
// window.confirm / window.alert — which render a jarring browser chrome dialog
// ("JavaScript - http://localhost…") in the Tauri webview. These resolve a
// promise so call sites stay nearly identical:
//   const name = await dialogs.prompt({ title: "New group name" });
//   if (await dialogs.confirm({ title: "Delete?", danger: true })) { … }

export interface PromptOptions {
  title: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button destructively (red). */
  danger?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: ReactNode;
  closeLabel?: string;
  danger?: boolean;
}

export interface DialogApi {
  /** Ask for a line of text. Resolves the trimmed value, or null if cancelled. */
  prompt: (opts: PromptOptions) => Promise<string | null>;
  /** Ask yes/no. Resolves true if confirmed. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Show a message with a single dismiss button. Resolves when closed. */
  alert: (opts: AlertOptions) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used within a <DialogProvider>");
  return ctx;
}

type DialogState =
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | null;

const INPUT_CLASS =
  "w-full px-3 py-2 bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary transition-all";

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Stable api object so consumers don't re-render on each dialog.
  const api = useRef<DialogApi>({
    prompt: (opts) =>
      new Promise((resolve) => {
        setValue(opts.defaultValue ?? "");
        setState({ kind: "prompt", opts, resolve });
      }),
    confirm: (opts) => new Promise((resolve) => setState({ kind: "confirm", opts, resolve })),
    alert: (opts) => new Promise((resolve) => setState({ kind: "alert", opts, resolve })),
  }).current;

  // Focus + select the prompt input when it opens.
  useEffect(() => {
    if (state?.kind === "prompt") {
      const id = window.setTimeout(() => inputRef.current?.select(), 0);
      return () => window.clearTimeout(id);
    }
  }, [state]);

  const settle = useCallback((fn: () => void) => {
    fn();
    setState(null);
  }, []);

  if (!state) {
    return <DialogContext.Provider value={api}>{children}</DialogContext.Provider>;
  }

  let dialog: ReactNode;

  if (state.kind === "prompt") {
    const { opts, resolve } = state;
    const submit = () => settle(() => resolve(value.trim() ? value.trim() : value));
    const cancel = () => settle(() => resolve(null));
    dialog = (
      <Modal
        open
        onClose={cancel}
        size="sm"
        title={opts.title}
        footer={
          <>
            <button
              type="button"
              onClick={cancel}
              className="px-3 py-1.5 rounded-md text-sm text-foreground hover:bg-accent transition-colors"
            >
              {opts.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              onClick={submit}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {opts.confirmLabel ?? "OK"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {opts.message && (
            <p className="text-sm text-muted-foreground mb-2">{opts.message}</p>
          )}
          <input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={opts.placeholder}
            className={INPUT_CLASS}
          />
        </form>
      </Modal>
    );
  } else if (state.kind === "confirm") {
    const { opts, resolve } = state;
    dialog = (
      <Modal
        open
        onClose={() => settle(() => resolve(false))}
        size="md"
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle
              className={`w-5 h-5 ${opts.danger ? "text-red-500" : "text-amber-500"}`}
            />
            {opts.title}
          </span>
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => settle(() => resolve(false))}
              className="px-3 py-1.5 rounded-md text-sm text-foreground hover:bg-accent transition-colors"
            >
              {opts.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => settle(() => resolve(true))}
              className={[
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                opts.danger
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              ].join(" ")}
            >
              {opts.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        {opts.message && <div className="text-sm text-foreground">{opts.message}</div>}
      </Modal>
    );
  } else {
    const { opts, resolve } = state;
    dialog = (
      <Modal
        open
        onClose={() => settle(resolve)}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle
              className={`w-5 h-5 ${opts.danger ? "text-red-500" : "text-amber-500"}`}
            />
            {opts.title}
          </span>
        }
        footer={
          <button
            type="button"
            autoFocus
            onClick={() => settle(resolve)}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {opts.closeLabel ?? "OK"}
          </button>
        }
      >
        {opts.message && <div className="text-sm text-foreground">{opts.message}</div>}
      </Modal>
    );
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog}
    </DialogContext.Provider>
  );
}
