import type { MetricStatus } from "../lib/api";
import { longMonth, shortMonth } from "../lib/dates";

/**
 * The chart marks used on the dashboard.
 *
 * All inline SVG. This system is deployed on premise with no route to the
 * internet, so a charting library from a CDN is not an option and bundling one
 * to draw four shapes would cost more than it returns.
 *
 * Two rules from the design system govern everything here, and they point the
 * same way as good chart practice:
 *
 * Colour is never the only carrier of meaning. Every mark below is accompanied
 * by a figure and a word, so the screen survives greyscale and a reader with a
 * colour vision deficiency loses nothing.
 *
 * Marks do not use the caution amber that pills use for text. Measured against
 * the breach red, that amber separates by ΔE 12.7 with full colour vision and
 * 3.8 under deuteranopia, which is hard to tell apart for everyone and nearly
 * identical for some. --caution-mark is a lighter goldenrod chosen for marks
 * only: it clears the separation checks against both neighbours and keeps 3:1
 * contrast with the surface. Text keeps --caution, which is dark enough to read.
 *
 * KMC red is brand chrome and never appears in a mark. Status uses the status
 * tokens, which are deliberately not the brand red.
 */

const statusColour: Record<MetricStatus, string> = {
  within: "var(--ok)",
  approaching: "var(--caution-mark)",
  outside: "var(--breach)",
  "no-data": "var(--neutral)",
};

/**
 * A share of a bounded whole, as a ring.
 *
 * A ring is a meter closed into a circle, and it is only honest when the full
 * circle means something: everyone scheduled was assessed, every reading was
 * within its limit. The gap in the ring is then the shortfall. A count has no
 * whole to fill, a value that can run past its target would be capped at a full
 * ring, and a rate in days per person has no circle at all, so those get a
 * figure or a straight track instead (see markFor on the dashboard).
 *
 * Angle is read less precisely than length, and 92% and 95% look almost the
 * same as arcs. The ring is for the glance; the figure in the middle and the
 * distance to target printed beside it carry the precision.
 *
 * The arc ends square. A round cap extends the arc by half the stroke width at
 * each end, which on this ring overstates the value by about three points.
 */
export function RadialMeter({
  value,
  target,
  status,
  label,
}: {
  /** Percentage 0–100, or null where there is no figure. */
  value: number | null;
  /** The target as a percentage, drawn as a tick across the track. */
  target?: number;
  status: MetricStatus;
  /** Announced to a screen reader in place of the drawing. */
  label: string;
}) {
  const radius = 40;
  const stroke = 9;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const filled = (clamped / 100) * circumference;

  // Radians clockwise from twelve o'clock.
  const targetAngle =
    target === undefined ? null : (Math.max(0, Math.min(100, target)) / 100) * 2 * Math.PI - Math.PI / 2;
  const onTargetAngle = (distance: number) =>
    targetAngle === null
      ? { x: 50, y: 50 }
      : { x: 50 + distance * Math.cos(targetAngle), y: 50 + distance * Math.sin(targetAngle) };
  const tickFrom = onTargetAngle(radius - stroke / 2 - 3);
  const tickTo = onTargetAngle(radius + stroke / 2 + 3);

  return (
    <svg viewBox="0 0 100 100" className="radial-meter" role="img" aria-label={label}>
      {/* The track. One shade off the surface, so it reads as the container
          for the value rather than as a second value. */}
      <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--rule)" strokeWidth={stroke} />

      {value !== null && clamped > 0 ? (
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={statusColour[status]}
          strokeWidth={stroke}
          strokeDasharray={`${filled} ${circumference}`}
          // Start at twelve o'clock rather than three.
          transform="rotate(-90 50 50)"
        />
      ) : null}

      {/* The target, across the track. The surface-coloured halo keeps it
          visible where the arc has already passed it. */}
      {targetAngle !== null ? (
        <g strokeLinecap="round">
          <line x1={tickFrom.x} y1={tickFrom.y} x2={tickTo.x} y2={tickTo.y} stroke="var(--surface)" strokeWidth="6" />
          <line x1={tickFrom.x} y1={tickFrom.y} x2={tickTo.x} y2={tickTo.y} stroke="var(--ink)" strokeWidth="2.5" />
        </g>
      ) : null}

      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        className="radial-meter-value"
        fill={value === null ? "var(--ink-faint)" : "var(--ink)"}
      >
        {value === null ? (
          "—"
        ) : (
          <>
            {value.toFixed(1)}
            <tspan className="radial-meter-unit">%</tspan>
          </>
        )}
      </text>
    </svg>
  );
}

/**
 * A value against a threshold, on a straight track.
 *
 * Used where a ring would mislead. Reportable near misses have a target of "at
 * least 200" and no ceiling: a ring capped at 100% would show a month of 260
 * as identical to a month of 200, hiding exactly the good news the indicator
 * exists to surface. A straight track can run past its target and show it.
 *
 * Drawn in HTML rather than SVG so the track can stretch to the card without
 * distorting its rounded end or the target marker.
 */
export function LinearMeter({
  value,
  target,
  status,
  higherIsBetter,
  label,
}: {
  value: number | null;
  target: number;
  status: MetricStatus;
  higherIsBetter: boolean;
  label: string;
}) {
  // The scale runs to whichever is larger, so a value beyond target stays on
  // the track and visibly beyond the marker.
  const ceiling = Math.max(target * (higherIsBetter ? 1.35 : 2), value ?? 0) || 1;
  const proportion = value === null ? 0 : Math.max(0, Math.min(1, value / ceiling));
  const targetAt = Math.max(0, Math.min(1, target / ceiling));

  return (
    <div className="linear-meter" role="img" aria-label={label}>
      <div className="linear-meter-track">
        {value !== null ? (
          <div
            className="linear-meter-fill"
            style={{ width: `${proportion * 100}%`, background: statusColour[status] }}
          />
        ) : null}
      </div>
      {/* The threshold. A solid marker, never dashed: dashing reads as a
          projection when it is a hard limit. */}
      <span className="linear-meter-target" style={{ left: `${targetAt * 100}%` }} />
    </div>
  );
}

export interface TrendPoint {
  period: string;
  value?: number;
  status: MetricStatus;
}

/**
 * The months of the year to date, as a sparkline.
 *
 * A month with no figure breaks the line rather than being interpolated
 * across. A line that closes over a gap asserts a value nobody recorded, which
 * is the same failure as showing missing data as zero, and on a chart it is
 * far less obvious.
 *
 * The target is drawn as a hairline and included in the vertical scale, so the
 * line is read against the target rather than against its own range: a series
 * that wanders between 84% and 91% looks dramatic on its own and is plainly
 * short of 95% once the target is in view.
 *
 * Only the last point is marked. A number against every month is chaos and
 * goes unread; each month's figure is in the hover title and, for keyboard and
 * screen reader users, in the card's calculation details.
 */
export function Sparkline({
  points,
  label,
  target,
  formatValue,
}: {
  points: TrendPoint[];
  label: string;
  target?: number;
  formatValue: (value: number) => string;
}) {
  const width = 100;
  const height = 36;
  const values = points.map((point) => point.value).filter((v): v is number => v !== undefined);

  if (points.length < 2 || values.length === 0) {
    return <div className="sparkline-empty">Not enough history to show a trend</div>;
  }

  const domain = target === undefined ? values : [...values, target];
  const min = Math.min(...domain);
  const max = Math.max(...domain);

  const step = width / points.length;
  const x = (index: number) => step / 2 + index * step;
  // A flat series sits on the centre line rather than on an edge of the box.
  const y = (value: number) => (max === min ? height / 2 : height - 4 - ((value - min) / (max - min)) * (height - 8));

  // Contiguous runs, so gaps stay gaps.
  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  points.forEach((point, index) => {
    if (point.value === undefined) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ index, value: point.value });
  });
  if (run.length > 0) runs.push(run);

  const last = points[points.length - 1];
  const missing = points.length - values.length;

  // The SVG stretches to the card's width, so round things are drawn as
  // zero-length lines with round caps and non-scaling strokes: they stay round
  // at any aspect ratio, where a <circle> would become an ellipse.
  const dot = (index: number, value: number, colour: string, size: number, key?: string | number) => (
    <line
      key={key}
      x1={x(index)}
      y1={y(value)}
      x2={x(index)}
      y2={y(value)}
      stroke={colour}
      strokeWidth={size}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );

  return (
    <figure className="sparkline">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="sparkline-svg"
        role="img"
        aria-label={label}
      >
        {target !== undefined && max !== min ? (
          <line
            x1="0"
            x2={width}
            y1={y(target)}
            y2={y(target)}
            stroke="var(--rule-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {runs.map((segment, index) =>
          segment.length === 1 ? (
            dot(segment[0].index, segment[0].value, "var(--ink-faint)", 4, index)
          ) : (
            <polyline
              key={index}
              points={segment.map((p) => `${x(p.index)},${y(p.value)}`).join(" ")}
              fill="none"
              stroke="var(--ink-faint)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
        {/* The endpoint carries the current status, so the sparkline agrees
            with the headline figure above it rather than reading as a second,
            differently-coloured opinion. */}
        {last.value !== undefined ? (
          <>
            {dot(points.length - 1, last.value, "var(--surface)", 11)}
            {dot(points.length - 1, last.value, statusColour[last.status], 7)}
          </>
        ) : null}
        {/* One hover target per month, the full height of the chart. */}
        {points.map((point, index) => (
          <rect key={point.period} x={index * step} y="0" width={step} height={height} fill="transparent">
            <title>
              {longMonth(point.period)}: {point.value === undefined ? "no figure" : formatValue(point.value)}
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className="sparkline-axis">
        <span>{shortMonth(points[0].period)}</span>
        {missing > 0 ? (
          <span>
            {missing} month{missing === 1 ? "" : "s"} missing
          </span>
        ) : null}
        <span>{shortMonth(last.period)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * The nine indicators split by status, as one stacked track.
 *
 * Part-to-whole with four classes, which is the one case a stacked bar answers
 * better than the numbers alone: the reader sees the shape of the month before
 * reading anything. A segmented ring could show the same split, but its
 * segments are compared by angle and the bar's by length, which is read more
 * accurately.
 *
 * Segments are separated by a two-pixel surface gap and every one is named in
 * the legend beneath with its glyph, word and count, so no segment carries its
 * meaning by colour alone.
 */
export function StatusBar({
  counts,
  total,
}: {
  counts: { status: MetricStatus; glyph: string; label: string; count: number }[];
  total: number;
}) {
  if (total === 0) return null;
  const present = counts.filter((entry) => entry.count > 0);

  return (
    <div>
      <div className="status-bar" aria-hidden="true">
        {present.map((entry) => (
          <span
            key={entry.status}
            style={{
              width: `${(entry.count / total) * 100}%`,
              background: statusColour[entry.status],
            }}
          />
        ))}
      </div>

      <ul className="status-legend">
        {counts.map((entry) => (
          <li key={entry.status}>
            <span aria-hidden="true" className="status-legend-swatch" style={{ background: statusColour[entry.status] }} />
            <span aria-hidden="true" className="data-value">
              {entry.glyph}
            </span>
            <span className="text-ink-muted">{entry.label}</span>
            <span className="status-legend-count">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
