import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Optional Tailwind class for the wrapper (size, padding). */
  className?: string;
}

/**
 * Centered empty state: large icon + title + optional description + optional
 * action button. Used for "no data" / "no connections" / "no results" UIs.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center p-6 ${className}`}
    >
      <div className="mb-4 text-muted-foreground/40 motion-reduce:animate-none">{icon}</div>
      <h3 className="text-lg font-medium text-muted-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground/70 w-[22rem] max-w-[90%]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
