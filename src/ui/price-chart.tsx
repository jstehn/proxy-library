// A small price-history chart, drawn as SVG on the server (design doc 07, section 10): one line
// per finish, and markers for the player's own buys (▲) and sells (▼). No chart library.

export type ChartSeries = Readonly<{
  label: string;
  color: string; // a CSS color
  points: ReadonlyArray<{ day: string; cents: number }>; // oldest first
}>;

export type ChartMarker = Readonly<{
  day: string; // "2026-09-27"
  cents: number;
  kind: "buy" | "sell";
  label: string;
}>;

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 12, right: 12, bottom: 28, left: 56 };

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function PriceChart(props: {
  series: readonly ChartSeries[];
  markers?: readonly ChartMarker[];
}) {
  const markers = props.markers ?? [];
  const allPoints = [
    ...props.series.flatMap((series) => series.points),
    ...markers.map((marker) => ({ day: marker.day, cents: marker.cents })),
  ];
  if (allPoints.length === 0) {
    return <p className="text-sm text-zinc-500">No price history yet.</p>;
  }

  const days = allPoints.map((point) => dayNumber(point.day));
  const firstDay = Math.min(...days);
  const lastDay = Math.max(...days, firstDay + 1); // a one-day history still gets a width
  const maxCents = Math.max(...allPoints.map((point) => point.cents), 1);
  const x = (day: string) =>
    PADDING.left +
    ((dayNumber(day) - firstDay) / (lastDay - firstDay)) * (WIDTH - PADDING.left - PADDING.right);
  const y = (cents: number) =>
    HEIGHT - PADDING.bottom - (cents / maxCents) * (HEIGHT - PADDING.top - PADDING.bottom);
  const firstLabel = allPoints.reduce((a, b) => (a.day < b.day ? a : b)).day;
  const lastLabel = allPoints.reduce((a, b) => (a.day > b.day ? a : b)).day;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-2xl text-zinc-400"
        role="img"
        aria-label="Price history"
      >
        {/* Axes: $0 and the highest price, first and last day. */}
        <line
          x1={PADDING.left}
          y1={y(0)}
          x2={WIDTH - PADDING.right}
          y2={y(0)}
          stroke="currentColor"
        />
        <line
          x1={PADDING.left}
          y1={y(maxCents)}
          x2={WIDTH - PADDING.right}
          y2={y(maxCents)}
          stroke="currentColor"
          strokeDasharray="3 4"
        />
        <text
          x={PADDING.left - 6}
          y={y(maxCents) + 4}
          textAnchor="end"
          fontSize="11"
          fill="currentColor"
        >
          {dollars(maxCents)}
        </text>
        <text x={PADDING.left - 6} y={y(0) + 4} textAnchor="end" fontSize="11" fill="currentColor">
          $0
        </text>
        <text x={PADDING.left} y={HEIGHT - 8} fontSize="11" fill="currentColor">
          {firstLabel}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 8}
          textAnchor="end"
          fontSize="11"
          fill="currentColor"
        >
          {lastLabel}
        </text>

        {props.series.map((series) =>
          series.points.length === 1 ? (
            <circle
              key={series.label}
              cx={x(series.points[0].day)}
              cy={y(series.points[0].cents)}
              r="3"
              fill={series.color}
            />
          ) : (
            <polyline
              key={series.label}
              fill="none"
              stroke={series.color}
              strokeWidth="2"
              points={series.points.map((point) => `${x(point.day)},${y(point.cents)}`).join(" ")}
            />
          ),
        )}

        {markers.map((marker, index) => {
          const cx = x(marker.day);
          const cy = y(marker.cents);
          const tip =
            marker.kind === "buy"
              ? `${cx},${cy - 7} ${cx - 6},${cy + 4} ${cx + 6},${cy + 4}`
              : `${cx},${cy + 7} ${cx - 6},${cy - 4} ${cx + 6},${cy - 4}`;
          return (
            <polygon key={index} points={tip} fill={marker.kind === "buy" ? "#16a34a" : "#dc2626"}>
              <title>{marker.label}</title>
            </polygon>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {props.series.map((series) => (
          <span key={series.label} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4" style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
        {markers.length > 0 && <span>▲ you bought · ▼ you sold</span>}
      </figcaption>
    </figure>
  );
}
