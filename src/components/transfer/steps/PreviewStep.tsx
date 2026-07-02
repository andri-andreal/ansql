import { useEffect, useState } from "react";
import { useTransfer } from "../../../hooks/useTransfer";
import type { TablePreview, TransferJob, TransferOptions } from "../../../types";
import { useTranslation } from "../../../i18n";

export function PreviewStep({
  sourceSession,
  targetSession,
  jobs,
  options,
}: {
  sourceSession: string;
  targetSession: string;
  jobs: TransferJob[];
  options: TransferOptions;
}) {
  const { t } = useTranslation();
  const { preview, error } = useTransfer();
  const [previews, setPreviews] = useState<TablePreview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    preview(sourceSession, targetSession, jobs, options).then((p) => {
      if (!cancelled) {
        setPreviews(p);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{t("io.previewTitle")}</h3>
      {loading && <p className="text-sm text-muted-foreground">{t("io.generating")}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="space-y-4">
        {previews.map((p) => (
          <div key={p.table}>
            <div className="mb-1 text-sm font-medium">{p.table}</div>
            <pre className="overflow-auto rounded-lg bg-secondary p-2 text-xs">
              {p.ddl}
              {"\n\n"}
              {p.sample_insert}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
