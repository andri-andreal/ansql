import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  /** Width override (any CSS length). */
  width?: string | number;
  /** Height override (any CSS length). */
  height?: string | number;
  /** Border radius override. */
  rounded?: "none" | "sm" | "md" | "lg" | "full";
}

const ROUNDED: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

/**
 * Loading placeholder. Uses a subtle pulse animation that respects
 * prefers-reduced-motion (animation is disabled in that case).
 */
export function Skeleton({ className = "", width, height, rounded = "md" }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;
  return (
    <div
      aria-hidden="true"
      style={style}
      className={`bg-muted motion-reduce:animate-none ${ROUNDED[rounded]} ${className}`}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

const LINE_WIDTHS = ["w-full", "w-11/12", "w-5/6", "w-4/5", "w-3/4"];

/** Stack of skeleton lines for paragraph placeholders. */
export function SkeletonText({ lines = 3, className = "" }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={12}
          className={`h-3 ${LINE_WIDTHS[i % LINE_WIDTHS.length]}`}
        />
      ))}
    </div>
  );
}
