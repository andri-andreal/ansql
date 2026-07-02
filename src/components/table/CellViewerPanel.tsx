import { useMemo, useState } from "react";
import { X, FileText, Braces, Binary, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "../../i18n";

/**
 * A dockable right-side cell inspector. Given an already-decoded cell value it
 * offers Text / JSON / Hex / Image views over the same data with no backend
 * fetch — best-effort over whatever we already hold. Text is editable (when
 * `editable`); the other tabs are read-only. Styled to match the existing
 * review-changes sidebar in TableData.
 */
export interface CellViewerPanelProps {
  columnName: string;
  /** Already-decoded cell value. */
  value: unknown;
  editable?: boolean;
  /** When editable, commit edits back to the host. */
  onChange?: (value: unknown) => void;
  onClose: () => void;
}

type ViewerTab = "text" | "json" | "hex" | "image";

const TABS: { id: ViewerTab; labelKey: string; icon: typeof FileText }[] = [
  { id: "text", labelKey: "table.viewerText", icon: FileText },
  { id: "json", labelKey: "table.viewerJson", icon: Braces },
  { id: "hex", labelKey: "table.viewerHex", icon: Binary },
  { id: "image", labelKey: "table.viewerImage", icon: ImageIcon },
];

/** Render a value as a plain string ("" for null/undefined, JSON for objects). */
function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Heuristic: does a string look like base64 (length/charset, no whitespace)? */
function looksLikeBase64(s: string): boolean {
  const t = s.trim();
  if (t.length < 8 || t.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

/** Decode a string to bytes — base64 first if it looks like it, else UTF-8. */
function valueToBytes(value: unknown): Uint8Array {
  const str = toText(value);
  if (looksLikeBase64(str)) {
    try {
      const bin = atob(str.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch {
      // fall through to UTF-8 encoding
    }
  }
  return new TextEncoder().encode(str);
}

/** Classic 16-byte-per-row hex + ASCII dump. */
function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const slice = bytes.subarray(off, off + 16);
    const hexCols: string[] = [];
    let ascii = "";
    for (let i = 0; i < 16; i++) {
      if (i < slice.length) {
        const b = slice[i];
        hexCols.push(b.toString(16).padStart(2, "0"));
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
      } else {
        hexCols.push("  ");
        ascii += " ";
      }
      if (i === 7) hexCols.push("");
    }
    const offsetHex = off.toString(16).padStart(8, "0");
    lines.push(`${offsetHex}  ${hexCols.join(" ")}  |${ascii}|`);
  }
  return lines.length ? lines.join("\n") : "(empty)";
}

const IMAGE_SIGNATURES: { ext: string; mime: string; bytes: number[] }[] = [
  { ext: "png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "jpg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: "gif", mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: "bmp", mime: "image/bmp", bytes: [0x42, 0x4d] },
  { ext: "webp", mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

/** Best-effort: produce an <img> src for the value, or null if not an image. */
function toImageSrc(value: unknown): string | null {
  const str = toText(value).trim();
  if (!str) return null;
  // (a) Already a data: URL for an image.
  if (/^data:image\//i.test(str)) return str;
  // (c) Raw bytes whose signature matches a known image format.
  const bytes = valueToBytes(value);
  for (const { mime, bytes: sig } of IMAGE_SIGNATURES) {
    if (startsWith(bytes, sig)) {
      // (b) base64 image data → wrap as a data URL.
      const b64 = looksLikeBase64(str) ? str.trim() : bytesToBase64(bytes);
      return `data:${mime};base64,${b64}`;
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  try {
    return btoa(bin);
  } catch {
    return "";
  }
}

export function CellViewerPanel({
  columnName,
  value,
  editable = false,
  onChange,
  onClose,
}: CellViewerPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ViewerTab>("text");

  const text = useMemo(() => toText(value), [value]);

  const json = useMemo<{ pretty: string; error: string | null }>(() => {
    if (value !== null && typeof value === "object") {
      try {
        return { pretty: JSON.stringify(value, null, 2), error: null };
      } catch (e) {
        return { pretty: "", error: e instanceof Error ? e.message : String(e) };
      }
    }
    const raw = text.trim();
    if (!raw) return { pretty: "", error: t("table.emptyValue") };
    try {
      return { pretty: JSON.stringify(JSON.parse(raw), null, 2), error: null };
    } catch (e) {
      return { pretty: "", error: e instanceof Error ? e.message : t("table.invalidJson") };
    }
  }, [value, text, t]);

  const hex = useMemo(() => hexDump(valueToBytes(value)), [value]);

  const imageSrc = useMemo(() => toImageSrc(value), [value]);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{columnName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t("table.cellViewer")}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors shrink-0"
            title={t("table.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-border bg-secondary/10">
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
              tab === id
                ? "bg-card border border-b-0 border-border text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {tab === "text" && (
          <textarea
            value={text}
            readOnly={!editable}
            spellCheck={false}
            onChange={(e) => editable && onChange?.(e.target.value)}
            placeholder={value === null || value === undefined ? "(null)" : ""}
            className="w-full h-full min-h-[200px] resize-none bg-background border border-border rounded-lg p-3 text-sm font-mono text-foreground outline-none focus:border-primary/60 transition-colors"
          />
        )}

        {tab === "json" &&
          (json.error ? (
            <div className="text-xs text-muted-foreground">
              <div className="text-amber-500 font-medium mb-2">{t("table.notValidJson")}</div>
              <div className="font-mono break-all">{json.error}</div>
              <pre className="mt-3 whitespace-pre-wrap break-all bg-background border border-border rounded-lg p-3 text-foreground">
                {text}
              </pre>
            </div>
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-background border border-border rounded-lg p-3 text-foreground">
              {json.pretty}
            </pre>
          ))}

        {tab === "hex" && (
          <pre className="text-xs font-mono whitespace-pre overflow-x-auto bg-background border border-border rounded-lg p-3 text-foreground leading-relaxed">
            {hex}
          </pre>
        )}

        {tab === "image" &&
          (imageSrc ? (
            <div className="flex items-center justify-center">
              <img
                src={imageSrc}
                alt={columnName}
                className="max-w-full h-auto rounded-lg border border-border bg-background"
              />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">{t("table.notAnImage")}</div>
          ))}
      </div>
    </div>
  );
}

export default CellViewerPanel;
