import { AlertTriangle } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { Statement } from "../../types";

interface SqlPreviewPaneProps {
  statements: Statement[];
  warnings?: string[];
}

export function SqlPreviewPane({ statements, warnings }: SqlPreviewPaneProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {/* Warnings panel */}
      {warnings && warnings.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-destructive/40">
          <div className="flex items-center gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{t("table.warnings")}</span>
          </div>
          <ul className="divide-y divide-destructive/10 bg-destructive/5">
            {warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2 px-3 py-2 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SQL preview */}
      {statements.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("table.noChangesToApply")}</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded border border-border bg-secondary/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
          {statements.map((s) => s.sql).join("\n\n")}
        </pre>
      )}
    </div>
  );
}
