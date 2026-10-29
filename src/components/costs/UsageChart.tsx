import { useMemo, useState } from 'react';
import type { UsageDay } from '@shared/types';
import { formatNumber } from '@/lib/format';
import { dateLabel, formatCompactCny, formatCny } from './costs-utils';

interface UsageChartProps {
  days: UsageDay[];
}

const WIDTH = 920;
const HEIGHT = 320;
const PADDING = { left: 54, right: 20, top: 18, bottom: 38 };

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0.01;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / power;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * power;
}

export function UsageChart({ days }: UsageChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const columnWidth = plotWidth / Math.max(1, days.length);
  const maxCost = Math.max(0.0001, ...days.map((day) => day.costCny));
  const maxCalls = Math.max(1, ...days.map((day) => day.calls));
  const niceMax = niceCeil(maxCost);
  const barWidth = Math.max(4, columnWidth * 0.54);
  const isEmpty = days.every((day) => day.costCny === 0 && day.calls === 0);

  const points = useMemo(() => days.map((day, index) => {
    const center = PADDING.left + columnWidth * index + columnWidth / 2;
    const value = PADDING.top + plotHeight - (day.calls / maxCalls) * plotHeight * 0.9;
    return center + ',' + Math.max(PADDING.top, value);
  }).join(' '), [days, columnWidth, maxCalls, plotHeight]);

  const hoveredDay = hovered !== null ? days[hovered] : null;
  const hoveredLeft = hovered !== null ? ((PADDING.left + columnWidth * hovered + columnWidth / 2) / WIDTH) * 100 : 0;

  return (
    <div className="costs-chart">
      <svg className="costs-chart__svg" viewBox={'0 0 ' + WIDTH + ' ' + HEIGHT} role="img" aria-label="最近 30 天费用与调用量趋势">
        <defs>
          <linearGradient id="costs-bar-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="costs-chart__stop-a" />
            <stop offset="100%" className="costs-chart__stop-b" />
          </linearGradient>
          <linearGradient id="costs-line-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" className="costs-chart__stop-c" />
            <stop offset="100%" className="costs-chart__stop-d" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((index) => {
          const y = PADDING.top + (plotHeight / 4) * index;
          const value = niceMax - (niceMax / 4) * index;
          return (
            <g key={index}>
              <line className="costs-chart__grid" x1={PADDING.left} y1={y} x2={WIDTH - PADDING.right} y2={y} />
              <text className="costs-chart__axis" x={PADDING.left - 10} y={y + 4} textAnchor="end">{formatCompactCny(value)}</text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const x = PADDING.left + columnWidth * index + (columnWidth - barWidth) / 2;
          const height = Math.max(day.costCny > 0 ? 2 : 0, (day.costCny / niceMax) * plotHeight);
          return (
            <g key={day.date}>
              {height > 0 && (
                <rect
                  className={'costs-chart__bar' + (hovered === index ? ' is-hovered' : '')}
                  x={x}
                  y={PADDING.top + plotHeight - height}
                  width={barWidth}
                  height={height}
                  rx={Math.min(4, barWidth / 2)}
                  fill="url(#costs-bar-gradient)"
                />
              )}
              <rect
                className="costs-chart__hit"
                x={PADDING.left + columnWidth * index}
                y={PADDING.top}
                width={columnWidth}
                height={plotHeight}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              />
            </g>
          );
        })}
        {maxCalls > 0 && !isEmpty && <polyline className="costs-chart__line" points={points} fill="none" stroke="url(#costs-line-gradient)" />}
        {days.filter((_, index) => index % 5 === 0 || index === days.length - 1).map((day) => {
          const index = days.findIndex((item) => item.date === day.date);
          const x = PADDING.left + columnWidth * index + columnWidth / 2;
          return (
            <text key={day.date} className="costs-chart__axis" x={x} y={HEIGHT - 14} textAnchor="middle">{dateLabel(day.date)}</text>
          );
        })}
      </svg>
      {hoveredDay && (
        <div className="costs-chart__tip" style={{ left: 'clamp(92px, ' + hoveredLeft + '%, calc(100% - 92px))' }}>
          <div className="costs-chart__tip-date">{hoveredDay.date}</div>
          <div className="costs-chart__tip-row"><span>费用</span><strong>{formatCny(hoveredDay.costCny, 4)}</strong></div>
          <div className="costs-chart__tip-row"><span>调用</span><strong>{formatNumber(hoveredDay.calls)} 次</strong></div>
          <div className="costs-chart__tip-row"><span>Token</span><strong>{formatNumber(hoveredDay.tokens)}</strong></div>
        </div>
      )}
      <div className="costs-chart__legend">
        <span><i className="costs-chart__legend-bar" /> 每日费用</span>
        <span><i className="costs-chart__legend-line" /> 每日调用量</span>
        <span className="costs-chart__legend-note">最近 30 天 · 悬停查看明细</span>
      </div>
      {isEmpty && (
        <div className="costs-chart__empty">
          <strong>最近 30 天还没有调用记录</strong>
          <span>和鲸鲸聊一句，或生成一次语音 / 图像，这里就会开始生长。</span>
        </div>
      )}
    </div>
  );
}
