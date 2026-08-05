import { cn } from "@/lib/utils";

interface ProgressProps {
  /** 0-100, clamped internally. */
  value: number;
  className?: string;
  indicatorClassName?: string;
}

/**
 * Generic progress bar — replaces the ~4 hand-copied `<div
 * style={{width}}>` bars scattered across the app (broadcasts,
 * evolution-config-form) with one accessible component. None of the
 * existing copies had role="progressbar"/aria-value*; this one does.
 */
export function Progress({ value, className, indicatorClassName }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-all duration-300", indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
