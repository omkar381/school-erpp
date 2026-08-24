'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartPoint } from '@erp/shared-types';
import { formatMoney, formatNumber } from '@/lib/utils';

export const SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
];

const axisProps = {
  stroke: 'var(--color-ink-faint)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

/** One tooltip style for every chart, so they read as one system. */
function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 shadow-[var(--shadow-md)]">
      {label ? (
        <p className="mb-1 text-2xs font-medium text-[var(--color-ink-muted)]">{label}</p>
      ) : null}
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-1.5 text-xs tabular">
          <span
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: entry.color }}
            aria-hidden
          />
          <span className="text-[var(--color-ink-secondary)]">{entry.name}</span>
          <span className="ml-auto font-medium text-[var(--color-ink)]">
            {formatter ? formatter(Number(entry.value)) : formatNumber(Number(entry.value))}
          </span>
        </p>
      ))}
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center text-xs text-[var(--color-ink-faint)]"
    >
      Not enough data yet
    </div>
  );
}

export function TrendChart({
  data,
  name,
  height = 200,
  format = 'number',
  color = SERIES_COLORS[0],
}: {
  data: ChartPoint[];
  name: string;
  height?: number;
  format?: 'number' | 'currency' | 'percent';
  color?: string;
}) {
  const formatter = React.useCallback(
    (value: number) =>
      format === 'currency'
        ? formatMoney(value, 'INR', { compact: true })
        : format === 'percent'
          ? `${value.toFixed(1)}%`
          : formatNumber(value),
    [format],
  );

  if (data.length < 2) return <EmptyChart height={height} />;

  const gradientId = `trend-${name.replace(/\W/g, '')}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={formatter} width={56} />
        <Tooltip content={<ChartTooltip formatter={formatter} />} />
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ColumnChart({
  data,
  name,
  height = 200,
  format = 'number',
  color = SERIES_COLORS[0],
}: {
  data: ChartPoint[];
  name: string;
  height?: number;
  format?: 'number' | 'currency' | 'percent';
  color?: string;
}) {
  const formatter = React.useCallback(
    (value: number) =>
      format === 'currency'
        ? formatMoney(value, 'INR', { compact: true })
        : format === 'percent'
          ? `${value.toFixed(1)}%`
          : formatNumber(value),
    [format],
  );

  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={formatter} width={56} />
        <Tooltip
          cursor={{ fill: 'var(--color-surface-sunken)' }}
          content={<ChartTooltip formatter={formatter} />}
        />
        <Bar dataKey="value" name={name} fill={color} radius={[3, 3, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineSeriesChart({
  data,
  name,
  height = 200,
  format = 'percent',
  color = SERIES_COLORS[1],
}: {
  data: ChartPoint[];
  name: string;
  height?: number;
  format?: 'number' | 'currency' | 'percent';
  color?: string;
}) {
  const formatter = React.useCallback(
    (value: number) =>
      format === 'currency'
        ? formatMoney(value, 'INR', { compact: true })
        : format === 'percent'
          ? `${value.toFixed(1)}%`
          : formatNumber(value),
    [format],
  );

  if (data.length < 2) return <EmptyChart height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={24} />
        <YAxis
          {...axisProps}
          tickFormatter={formatter}
          width={44}
          domain={format === 'percent' ? [0, 100] : undefined}
        />
        <Tooltip content={<ChartTooltip formatter={formatter} />} />
        <Line
          type="monotone"
          dataKey="value"
          name={name}
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  height = 200,
  format = 'number',
}: {
  data: ChartPoint[];
  height?: number;
  format?: 'number' | 'currency';
}) {
  const formatter = React.useCallback(
    (value: number) =>
      format === 'currency' ? formatMoney(value, 'INR', { compact: true }) : formatNumber(value),
    [format],
  );

  if (data.length === 0) return <EmptyChart height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((entry, index) => (
            <Cell key={entry.label} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip formatter={formatter} />} />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={7}
          formatter={(value) => (
            <span className="text-2xs text-[var(--color-ink-secondary)]">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
