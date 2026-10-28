import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusIndicator, type Status } from "../components/StatusIndicator";
import { Icon } from "../components/Icon";
import { LinearMeter, RadialMeter, Sparkline, StatusBar } from "../components/charts";
import {
  ApiError,
  metricsApi,
  type DashboardMetric,
  type DashboardSnapshot,
  type MetricStatus,
} from "../lib/api";
import { primaryRole, useSession } from "../lib/session";
import { currentPeriod, longMonth } from "../lib/dates";

const statusFor: Record<MetricStatus, Status> = {
  within: "within",
  approaching: "approaching",
  outside: "breach",
  "no-data": "no-data",
};

const statusLabel: Record<MetricStatus, string> = {
  within: "On target",
  approaching: "Approaching",
  outside: "Off target",
  "no-data": "No data",
};

const statusGlyph: Record<MetricStatus, string> = {
  within: "✓",
  approaching: "~",
  outside: "✗",
  "no-data": "—",
};

/**
 * Which mark an indicator gets.
 *
 * A ring only for a share of a bounded whole, where a full ring means
 * everything was done. A count with a target of zero has no whole to fill and
 * gets the figure alone. Anything else runs on a straight track, which can show
 * a value past its target where a ring would stop at full.
 */
function markFor(metric: DashboardMetric): "ring" | "track" | "figure" {
  if (metric.format === "percent-1") return "ring";
  if (metric.targetValue === 0) return "figure";
  return "track";
}

/** Mirrors Format in the metrics service, for figures the page works out itself. */
function formatValue(value: number, format: string): string {
  switch (format) {
    case "integer":
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    case "decimal-2":
      return value.toFixed(2);
    case "percent-1":
      return `${value.toFixed(1)}%`;
    default:
      return value.toFixed(1);
  }
}

/**
 * How far the month sits from its target, in words.
 *
 * Marks are read at a glance and imprecisely, so the distance is stated rather
 * than left to the eye. Whether that distance is good or bad is the status
 * label's job; this only measures it.
 */
function distanceFromTarget(metric: DashboardMetric): string | null {
  const value = metric.month.numericValue;
  if (value === undefined || !metric.direction) return null;
  const difference = value - metric.targetValue;
  if (difference === 0) return null;
  const amount = Math.abs(difference);
  const shown = metric.format === "percent-1" ? `${amount.toFixed(1)} pts` : formatValue(amount, metric.format);
  return `${shown} ${difference > 0 ? "above" : "below"} target`;
}

/**
 * Spreads a group's cards over rows of near-equal length, so no card is left
 * alone at the end of a row: five cards lay out as three and two, not four and
 * one. Returned as column spans of a twelve-column grid.
 */
function rowSpans(count: number, perRow: number): number[] {
  const rows = Math.ceil(count / perRow);
  const spans: number[] = [];
  let remaining = count;
  for (let row = 0; row < rows; row += 1) {
    const inRow = Math.ceil(remaining / (rows - row));
    for (let i = 0; i < inRow; i += 1) spans.push(12 / inRow);
    remaining -= inRow;
  }
  return spans;
}

/** Brings an indicator's card into view from the summary and focuses it. */
function jumpToCard(event: MouseEvent<HTMLAnchorElement>, metricId: string) {
  const card = document.getElementById(`metric-${metricId}`);
  if (!card) return;
  event.preventDefault();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  card.focus({ preventScroll: true });
}

/**
 * The dashboard answers three questions in order. How did the month go, what
 * needs somebody's attention, and what does each indicator say. The first two
 * share one summary card, so every count appears once; the indicators follow,
 * one card each, all built the same way so they can be scanned side by side.
 * Missing data never masquerades as poor performance.
 */
export function DashboardPage() {
  const { user } = useSession();
  const isDirector = primaryRole(user) === "hwms-director";

  const [period, setPeriod] = useState(currentPeriod);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const body = await metricsApi.dashboard(period);
        if (!cancelled) {
          setSnapshot(body);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSnapshot(null);
          setError(
            err instanceof ApiError ? err.message : "The dashboard could not be read. Try again.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const groups = snapshot
    ? [
        {
          label: "Occupational health",
          metrics: snapshot.metrics.filter((metric) => metric.group === "Occupational health"),
        },
        {
          label: "Health and safety summary",
          metrics: snapshot.metrics.filter((metric) => metric.group !== "Occupational health"),
        },
      ].filter((group) => group.metrics.length > 0)
    : [];

  const counted = (status: MetricStatus) =>
    snapshot?.metrics.filter((metric) => metric.month.status === status).length ?? 0;

  const exceptions = snapshot
    ? [
        ...snapshot.metrics.filter((metric) => metric.month.status === "outside"),
        ...snapshot.metrics.filter((metric) => metric.month.status === "approaching"),
      ]
    : [];
  const awaiting = snapshot?.metrics.filter((metric) => metric.month.status === "no-data") ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Reporting dashboard"
        title="Health and wellness overview"
        description={
          isDirector
            ? "A concise view of the reporting month. Unit-level clinical detail remains with the manager and officer."
            : "See the month at a glance, then open an indicator only when you need its calculation or source."
        }
        actions={
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
            Reporting month
            <input
              type="month"
              className="field w-auto text-sm"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </label>
        }
      />

      {error ? (
        <div
          className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--breach)", background: "var(--breach-wash)", color: "var(--breach)" }}
          role="alert"
        >
          <Icon name="error" size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : snapshot ? (
        // A month change keeps the previous month on screen, dimmed, until the
        // new one arrives, rather than collapsing the page to a loading line.
        <div className="dashboard-content" aria-busy={loading} data-loading={loading || undefined}>
          <section className="panel dashboard-summary" aria-labelledby="summary-heading">
            <div className="summary-overview">
              <h2 id="summary-heading" className="summary-title">
                {snapshot.periodLabel} at a glance
              </h2>
              <p className="summary-hero">
                <strong>{snapshot.onTarget}</strong>
                <span>
                  of {snapshot.totalMetrics} indicators on target
                </span>
              </p>
              <StatusBar
                total={snapshot.totalMetrics}
                counts={(["within", "approaching", "outside", "no-data"] as MetricStatus[]).map(
                  (status) => ({
                    status,
                    glyph: statusGlyph[status],
                    label: statusLabel[status],
                    count: counted(status),
                  }),
                )}
              />
              <p className="summary-note">
                {snapshot.monthsInYearToDate === 1
                  ? `Year-to-date figures cover ${snapshot.periodLabel} only.`
                  : `Year-to-date figures cover January to ${snapshot.periodLabel}, ${snapshot.monthsInYearToDate} months.`}
              </p>
            </div>

            <div className="summary-lists">
              {exceptions.length === 0 && awaiting.length === 0 ? (
                <p className="summary-clear">
                  Nothing needs attention in {snapshot.periodLabel}. Every figure is in, and every
                  indicator is on target.
                </p>
              ) : null}

              {exceptions.length > 0 ? (
                <div>
                  <h3 className="summary-subtitle">
                    Needs attention <span className="summary-count">{exceptions.length}</span>
                  </h3>
                  <ul className="summary-list">
                    {exceptions.map((metric) => (
                      <SummaryRow key={metric.id} metric={metric} detail={`Target ${metric.target}`} />
                    ))}
                  </ul>
                </div>
              ) : awaiting.length > 0 ? (
                <p className="summary-clear">
                  No indicator with a figure is off target or approaching its limit.
                </p>
              ) : null}

              {awaiting.length > 0 ? (
                <div>
                  <h3 className="summary-subtitle">
                    Awaiting data <span className="summary-count">{awaiting.length}</span>
                  </h3>
                  <p className="summary-hint">Reporting work outstanding, not a performance result.</p>
                  <ul className="summary-list">
                    {awaiting.map((metric) => (
                      <SummaryRow
                        key={metric.id}
                        metric={metric}
                        detail={`No figure recorded for ${snapshot.periodLabel}`}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          {groups.map((group) => {
            const wide = rowSpans(group.metrics.length, 4);
            const narrow = rowSpans(group.metrics.length, 3);
            const headingId = `group-${group.label.toLowerCase().replace(/\W+/g, "-")}`;
            return (
              <section key={group.label} className="metric-section" aria-labelledby={headingId}>
                <div className="metric-section-head">
                  <h2 id={headingId}>{group.label}</h2>
                  <span>{group.metrics.length} indicators</span>
                </div>
                <div className="metric-grid">
                  {group.metrics.map((metric, index) => (
                    <MetricCard
                      key={metric.id}
                      metric={metric}
                      periodLabel={snapshot.periodLabel}
                      layout={{ "--span-wide": wide[index], "--span-narrow": narrow[index] } as CSSProperties}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : loading ? (
        <div className="panel">
          <div className="panel-body flex items-center gap-3 text-sm text-ink-muted">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-clinical" />
            Assembling the reporting picture…
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One line of the summary's lists, linking to the indicator's card. */
function SummaryRow({ metric, detail }: { metric: DashboardMetric; detail: string }) {
  const hasFigure = metric.month.displayValue !== "";
  return (
    <li>
      <a
        className="summary-row"
        href={`#metric-${metric.id}`}
        onClick={(event) => jumpToCard(event, metric.id)}
      >
        <span className="summary-row-name">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="metric-code metric-code--subtle">{metric.id}</span>
            <strong className="truncate">{metric.name}</strong>
          </span>
          <span>{detail}</span>
        </span>
        <span className="summary-row-figure">{hasFigure ? metric.month.displayValue : "—"}</span>
        <StatusIndicator status={statusFor[metric.month.status]} label={statusLabel[metric.month.status]} />
      </a>
    </li>
  );
}

function MetricCard({
  metric,
  periodLabel,
  layout,
}: {
  metric: DashboardMetric;
  periodLabel: string;
  layout: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const mark = markFor(metric);
  const value = metric.month.numericValue ?? null;
  const hasFigure = metric.month.displayValue !== "";
  const distance = distanceFromTarget(metric);
  const description = `${metric.name}: ${metric.month.displayValue || "no data"} against a target of ${metric.target}`;
  const recorded = metric.trend.filter((point) => point.value !== undefined).length;
  const lastMonth = metric.trend[metric.trend.length - 1]?.period;

  return (
    <article
      id={`metric-${metric.id}`}
      tabIndex={-1}
      className="panel metric-card"
      style={layout}
      aria-labelledby={`metric-${metric.id}-name`}
    >
      <header className="metric-card-head">
        <div className="metric-card-topline">
          <span className="metric-code">{metric.id}</span>
          <span className="metric-meta">{metric.provenance || "No source"}</span>
        </div>
        <h3 id={`metric-${metric.id}-name`} className="metric-title">
          {metric.name}
        </h3>
      </header>

      <div className="metric-headline">
        <div className="metric-mark">
          {mark === "ring" ? (
            <RadialMeter value={value} target={metric.targetValue} status={metric.month.status} label={description} />
          ) : (
            <div className="metric-figure-dial">
              <span className="metric-figure" data-empty={hasFigure ? undefined : ""}>
                {hasFigure ? metric.month.displayValue : "—"}
              </span>
            </div>
          )}
        </div>

        <div className="metric-verdict">
          <StatusIndicator status={statusFor[metric.month.status]} label={statusLabel[metric.month.status]} />
          {metric.direction ? (
            <p className="metric-target">
              Target <strong>{metric.target}</strong>
              {metric.proposed ? (
                <span className="metric-proposed" title="This target has not yet been agreed by its owner.">
                  {" "}
                  (proposed)
                </span>
              ) : null}
              <br />
              <span className="metric-target-direction">
                {metric.direction === "higher" ? "Higher is better" : "Lower is better"}
              </span>
            </p>
          ) : (
            <p className="metric-target">No target is in force</p>
          )}
          {distance ? (
            <p className={`metric-distance metric-distance--${metric.month.status}`}>{distance}</p>
          ) : null}
          {!hasFigure ? <p className="metric-distance">No figure for {periodLabel}</p> : null}
        </div>

        {mark === "track" ? (
          <div className="metric-track">
            <LinearMeter
              value={value}
              target={metric.targetValue}
              status={metric.month.status}
              higherIsBetter={metric.direction === "higher"}
              label={description}
            />
          </div>
        ) : null}
      </div>

      <div className="metric-history">
        <div className="min-w-0">
          <span className="metric-mini-label">This year</span>
          <Sparkline
            points={metric.trend}
            target={metric.direction ? metric.targetValue : undefined}
            formatValue={(figure) => formatValue(figure, metric.format)}
            label={`${metric.name} by month, January to ${lastMonth ? longMonth(lastMonth) : "the reporting month"}`}
          />
        </div>
        <div className="metric-ytd" title={metric.aggregationLabel}>
          <span className="metric-mini-label">Year to date</span>
          {metric.yearToDate.displayValue !== "" ? (
            <span className="metric-ytd-value">{metric.yearToDate.displayValue}</span>
          ) : metric.yearToDate.completeness === "incomplete" ? (
            <span className="metric-ytd-empty">
              Incomplete
              <br />
              {recorded} of {metric.trend.length} months
            </span>
          ) : (
            <span className="metric-ytd-empty">No data</span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="metric-detail-button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Calculation and source
        <Icon name="chevron_right" size={16} />
      </button>

      <MetricDetailDialog
        metric={metric}
        periodLabel={periodLabel}
        open={open}
        onClose={() => setOpen(false)}
      />
    </article>
  );
}

/**
 * How one indicator was worked out, on request.
 *
 * A dialog rather than an expanding card: opening one card's details inside
 * the grid would stretch every card in its row. Native dialog semantics give
 * Escape handling, focus containment and focus return, as in AuthDialog.
 */
function MetricDetailDialog({
  metric,
  periodLabel,
  open,
  onClose,
}: {
  metric: DashboardMetric;
  periodLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const titleId = `metric-${metric.id}-dialog-title`;

  return (
    <dialog
      ref={dialogRef}
      className="metric-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="metric-dialog-card">
        <header className="metric-dialog-head">
          <div>
            <span className="metric-meta">
              {metric.id} · {metric.provenance || "No source"}
            </span>
            <h2 id={titleId}>{metric.name}</h2>
          </div>
          <button type="button" className="metric-dialog-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </header>

        <dl className="metric-dialog-facts">
          <div>
            <dt>{periodLabel}</dt>
            <dd>
              {metric.month.calculation ? (
                <span className="data-value">{metric.month.calculation}</span>
              ) : (
                metric.month.note ?? "No figure recorded"
              )}
            </dd>
          </div>
          <div>
            <dt>{metric.aggregationLabel}</dt>
            <dd>
              {metric.yearToDate.calculation ? (
                <span className="data-value">{metric.yearToDate.calculation}</span>
              ) : (
                metric.yearToDate.note ?? "No data"
              )}
            </dd>
          </div>
          {metric.note ? (
            <div>
              <dt>Definition</dt>
              <dd>{metric.note}</dd>
            </div>
          ) : null}
          <div>
            <dt>Target source</dt>
            <dd>
              Target {metric.target}
              {metric.proposed ? " (proposed). " : ". "}
              {metric.sourceNote}
            </dd>
          </div>
        </dl>

        {metric.trend.length > 0 ? (
          <table className="metric-dialog-table">
            <caption>Month by month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Figure</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {metric.trend.map((point) => (
                <tr key={point.period}>
                  <th scope="row">{longMonth(point.period)}</th>
                  <td className="data-value">
                    {point.value === undefined ? "—" : formatValue(point.value, metric.format)}
                  </td>
                  <td>
                    <StatusIndicator status={statusFor[point.status]} label={statusLabel[point.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </dialog>
  );
}
