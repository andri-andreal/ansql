import { useState } from "react";
import type { ExportTextOptions } from "../../lib/exportFormats";
import { useTranslation } from "../../i18n";

interface ExportOptionsDialogProps {
  /** Which delimited format the dialog is configuring (affects the title only). */
  format: "csv" | "txt";
  /** Confirm — receives the chosen text options. */
  onConfirm: (options: ExportTextOptions) => void;
  /** Cancel / dismiss without exporting. */
  onClose: () => void;
}

/** Preset delimiter choices; "custom" reveals a free-text field. */
type DelimiterPreset = "comma" | "tab" | "semicolon" | "pipe" | "custom";

const DELIMITER_PRESETS: { value: DelimiterPreset; labelKey: string; char: string }[] = [
  { value: "comma", labelKey: "io.delimiterComma", char: "," },
  { value: "tab", labelKey: "io.delimiterTab", char: "\t" },
  { value: "semicolon", labelKey: "io.delimiterSemicolon", char: ";" },
  { value: "pipe", labelKey: "io.delimiterPipe", char: "|" },
  { value: "custom", labelKey: "io.delimiterCustom", char: "" },
];

const QUOTE_PRESETS: { value: string; labelKey: string }[] = [
  { value: '"', labelKey: "io.quoteDouble" },
  { value: "'", labelKey: "io.quoteSingle" },
  { value: "", labelKey: "io.quoteNone" },
];

/**
 * Small dialog to configure delimiter / quote char / headers / NULL token for a
 * CSV or TXT export before the save dialog opens. Defaults match
 * {@link ExportTextOptions} (comma, double-quote, headers on, empty NULL token).
 * For TXT the default delimiter starts as Tab, which is the more useful default
 * for a generic "text" export.
 */
function ExportOptionsDialog({ format, onConfirm, onClose }: ExportOptionsDialogProps) {
  const { t } = useTranslation();
  const isCsv = format === "csv";

  const [delimiterPreset, setDelimiterPreset] = useState<DelimiterPreset>(
    isCsv ? "comma" : "tab"
  );
  const [customDelimiter, setCustomDelimiter] = useState(",");
  const [quoteChar, setQuoteChar] = useState('"');
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [nullToken, setNullToken] = useState("");

  const resolveDelimiter = (): string => {
    if (delimiterPreset === "custom") return customDelimiter;
    return DELIMITER_PRESETS.find((p) => p.value === delimiterPreset)?.char ?? ",";
  };

  const handleConfirm = () => {
    onConfirm({
      delimiter: resolveDelimiter(),
      quoteChar,
      includeHeaders,
      nullToken,
    });
  };

  const inputClass =
    "px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg p-6 shadow-xl max-w-md w-full mx-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-1">
          {isCsv ? t("io.exportCsv") : t("io.exportText")}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {t("io.configureDelimitedOutput")}
        </p>

        <div className="space-y-4">
          {/* Delimiter */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-muted-foreground">{t("io.delimiter")}</label>
            <div className="flex items-center gap-2">
              {delimiterPreset === "custom" && (
                <input
                  type="text"
                  value={customDelimiter}
                  onChange={(e) => setCustomDelimiter(e.target.value)}
                  placeholder=","
                  className={`${inputClass} w-12 text-center`}
                />
              )}
              <select
                value={delimiterPreset}
                onChange={(e) => setDelimiterPreset(e.target.value as DelimiterPreset)}
                className={`${inputClass} min-w-[160px]`}
              >
                {DELIMITER_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quote char */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-muted-foreground">{t("io.textQualifier")}</label>
            <select
              value={quoteChar}
              onChange={(e) => setQuoteChar(e.target.value)}
              className={`${inputClass} min-w-[160px]`}
            >
              {QUOTE_PRESETS.map((p) => (
                <option key={p.labelKey} value={p.value}>
                  {t(p.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* NULL token */}
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-muted-foreground">{t("io.nullValueAs")}</label>
            <input
              type="text"
              value={nullToken}
              onChange={(e) => setNullToken(e.target.value)}
              placeholder={t("io.emptyPlaceholder")}
              className={`${inputClass} min-w-[160px]`}
            />
          </div>

          {/* Headers */}
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm text-muted-foreground">{t("io.includeHeaderRow")}</span>
            <input
              type="checkbox"
              checked={includeHeaders}
              onChange={(e) => setIncludeHeaders(e.target.checked)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
          >
            {t("io.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("io.export")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportOptionsDialog;
