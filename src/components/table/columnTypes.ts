export type DateInputType = "datetime-local" | "date" | "time";

/** Map a SQL column data_type to the appropriate HTML date-input type, or null. */
export function getDateInputType(dataType: string): DateInputType | null {
  const t = dataType.toLowerCase();
  if (t.includes("timestamp") || t.includes("datetime")) return "datetime-local";
  if (t === "date") return "date";
  if (t.startsWith("time")) return "time";
  return null;
}
