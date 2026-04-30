"use client";

type TrendChartProps = {
  data: { date: string; value: number }[];
  valuePrefix?: string;
  valueSuffix?: string;
  color?: string;
};

export function TrendChart({
  data,
  valuePrefix = "",
  valueSuffix = "",
  color = "#818cf8",
}: TrendChartProps) {
  if (data.length === 0) return null;

  const width = 600;
  const height = 120;
  const padding = 24;

  const maxVal = Math.max(...data.map((d) => d.value), 1);

  const points = data
    .map((d, i) => {
      const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - (d.value / maxVal) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const firstX = padding;
  const lastX =
    padding + ((data.length - 1) / Math.max(data.length - 1, 1)) * (width - padding * 2);
  const areaPoints = `${firstX},${height - padding} ${points} ${lastX},${height - padding}`;

  const gradientId = `areaGradient-${color.replace("#", "")}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = height - padding - pct * (height - padding * 2);
        return (
          <g key={pct}>
            <line
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="#1f2937"
              strokeWidth={1}
            />
            <text
              x={padding - 4}
              y={y + 3}
              textAnchor="end"
              className="fill-gray-600 text-[8px]"
            >
              {valuePrefix}
              {(maxVal * pct).toFixed(0)}
              {valueSuffix}
            </text>
          </g>
        );
      })}
      {/* Area */}
      <polygon points={areaPoints} fill={`url(#${gradientId})`} opacity={0.3} />
      {/* Line */}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      {/* Dots */}
      {data.map((_, i) => {
        const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
        const y = height - padding - (data[i]!.value / maxVal) * (height - padding * 2);
        return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
      })}
      {/* Date labels */}
      {[0, Math.floor(data.length / 2), data.length - 1]
        .filter((idx, i, arr) => arr.indexOf(idx) === i)
        .map((idx) => {
          const x = padding + (idx / Math.max(data.length - 1, 1)) * (width - padding * 2);
          const label = data[idx]?.date?.slice(5) ?? "";
          return (
            <text
              key={idx}
              x={x}
              y={height - 4}
              textAnchor="middle"
              className="fill-gray-600 text-[8px]"
            >
              {label}
            </text>
          );
        })}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}
