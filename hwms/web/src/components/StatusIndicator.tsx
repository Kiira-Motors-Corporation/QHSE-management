/**
 * The only way to render a status in this system.
 *
 * Every status carries three signals in this order of importance: a glyph, a
 * text label, then a colour. Roughly one in twelve men has a colour vision
 * deficiency, red and green are the pair most commonly confused, and a screen
 * reader announces no colour at all.
 *
 * Two states here deserve their reasoning stated, because both are routinely
 * got wrong:
 *
 * "No data" is not a failure state and must never be styled as one. A month
 * with no data is a different problem from a month that failed, and merging
 * them produces exactly the wrong management response.
 *
 * "Informational" exists for counts that are not pass or fail. Showing a
 * recordable-incident count against an invented threshold would imply KMC has
 * set one when it has not.
 *
 * Test before shipping any screen: apply filter: grayscale(100%). If any
 * status becomes ambiguous, the screen is not finished.
 */
export type Status =
  | "within"
  | "approaching"
  | "breach"
  | "no-data"
  | "informational"
  | "not-applicable"
  | "provisional";

const presentation: Record<
  Status,
  { glyph: string; label: string; fg: string; bg: string; border: string }
> = {
  within: {
    glyph: "✓",
    label: "Within target",
    fg: "var(--ok)",
    bg: "var(--ok-wash)",
    border: "rgba(13, 122, 95, 0.25)",
  },
  approaching: {
    glyph: "~",
    label: "Approaching limit",
    fg: "var(--caution)",
    bg: "var(--caution-wash)",
    border: "rgba(180, 83, 9, 0.25)",
  },
  breach: {
    glyph: "✗",
    label: "Outside limit",
    fg: "var(--breach)",
    bg: "var(--breach-wash)",
    border: "rgba(185, 28, 28, 0.25)",
  },
  "no-data": {
    glyph: "—",
    label: "No data",
    fg: "var(--neutral)",
    bg: "var(--neutral-wash)",
    border: "rgba(100, 116, 139, 0.22)",
  },
  informational: {
    glyph: "i",
    label: "Informational",
    fg: "var(--info)",
    bg: "var(--info-wash)",
    border: "rgba(29, 78, 216, 0.25)",
  },
  "not-applicable": {
    glyph: "·",
    label: "Not applicable",
    fg: "var(--neutral)",
    bg: "var(--neutral-wash)",
    border: "rgba(100, 116, 139, 0.22)",
  },
  provisional: {
    glyph: "~",
    label: "Provisional",
    fg: "var(--caution)",
    bg: "var(--caution-wash)",
    border: "rgba(180, 83, 9, 0.25)",
  },
};

interface StatusIndicatorProps {
  status: Status;
  /** Overrides the default label. The glyph and colour are never overridable. */
  label?: string;
  className?: string;
}

export function StatusIndicator({ status, label, className = "" }: StatusIndicatorProps) {
  const shown = presentation[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold ${className}`}
      style={{
        color: shown.fg,
        backgroundColor: shown.bg,
        border: `1px solid ${shown.border}`,
        borderRadius: "var(--radius)",
      }}
    >
      <span
        aria-hidden="true"
        className="data-value font-mono text-[11px] font-bold leading-none"
        style={{ minWidth: "10px", textAlign: "center" }}
      >
        {shown.glyph}
      </span>
      <span>{label ?? shown.label}</span>
    </span>
  );
}
