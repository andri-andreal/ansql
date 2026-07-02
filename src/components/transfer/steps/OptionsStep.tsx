import type { ErrorPolicy, TransferOptions } from "../../../types";
import { useTranslation } from "../../../i18n";

const POLICIES: { value: ErrorPolicy; labelKey: string }[] = [
  { value: "table_atomic_continue", labelKey: "io.policyTableAtomicContinue" },
  { value: "stop_on_error", labelKey: "io.policyStopOnError" },
  { value: "skip_row_continue", labelKey: "io.policySkipRowContinue" },
];

const COPY_LABEL_KEY: Record<
  "copy_structure" | "copy_data" | "copy_indexes" | "copy_fks",
  string
> = {
  copy_structure: "io.copyStructure",
  copy_data: "io.copyData",
  copy_indexes: "io.copyIndexes",
  copy_fks: "io.copyFks",
};

export function OptionsStep({
  value,
  onChange,
}: {
  value: TransferOptions;
  onChange: (o: TransferOptions) => void;
}) {
  const { t } = useTranslation();
  const toggle = (key: keyof TransferOptions) =>
    onChange({ ...value, [key]: !value[key] });

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">{t("io.stepOptions")}</h3>

      <div className="space-y-2 text-sm">
        {(["copy_structure", "copy_data", "copy_indexes", "copy_fks"] as const).map(
          (k) => (
            <label key={k} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value[k] as boolean}
                onChange={() => toggle(k)}
              />
              {t(COPY_LABEL_KEY[k])}
            </label>
          )
        )}
      </div>

      <label className="block text-sm font-medium">
        {t("io.errorPolicy")}
        <select
          className="mt-1 w-full rounded-lg border border-input bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          value={value.error_policy}
          onChange={(e) =>
            onChange({ ...value, error_policy: e.target.value as ErrorPolicy })
          }
        >
          {POLICIES.map((p) => (
            <option key={p.value} value={p.value}>
              {t(p.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium">
        {t("io.batchSize")}
        <input
          type="number"
          min={1}
          className="mt-1 w-32 rounded-lg border border-input bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          value={value.batch_size}
          onChange={(e) =>
            onChange({ ...value, batch_size: Math.max(1, Number(e.target.value) || 500) })
          }
        />
      </label>
    </div>
  );
}
