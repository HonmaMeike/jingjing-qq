import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppSettings } from '../shared/types';
import { EventBus } from '../electron/core/event-bus';
import { ObservabilityService } from '../electron/services/observability';

let dir = '';
let obs: ObservabilityService;
let bus: EventBus;

function makeSettings(): AppSettings {
  return {
    billing: {
      monthlyBudgetCny: 100, deepseekInputPerMillion: 2, deepseekOutputPerMillion: 8,
      deepseekReasonerInputPerMillion: 4, deepseekReasonerOutputPerMillion: 16,
      breezePerKChar: 0.1, minimaxImage: 0.2, minimaxVideoSecond: 0.5, sunoTrack: 0.2, serperSearch: 0.005,
    },
    models: { deepseekChat: 'deepseek-chat' },
  } as AppSettings;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jingjing-obs-'));
  bus = new EventBus();
  obs = await ObservabilityService.create({ file: path.join(dir, 'usage.json'), events: bus, getSettings: makeSettings });
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('可观测性与真实用量', () => {
  it('记录 DeepSeek token 并按设置单价计算费用', async () => {
    const entry = await obs.recordUsage({ provider: 'deepseek', service: 'DeepSeek Chat', kind: 'llm', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 100_000, totalTokens: 1_100_000, units: 1_100_000, unit: 'tokens' });
    expect(entry.costCny).toBeCloseTo(2 + 0.8, 5);
    const summary = obs.usageSummary();
    expect(summary.today.calls).toBe(1);
    expect(summary.today.totalTokens).toBe(1_100_000);
    expect(summary.byProvider[0].provider).toBe('deepseek');
    expect(summary.budget.usedCny).toBeGreaterThan(0);
  });

  it('不同供应商费用与预算统计', async () => {
    await obs.recordUsage({ provider: 'breezeblue', service: 'TTS', kind: 'tts', units: 1000, unit: 'characters' });
    await obs.recordUsage({ provider: 'minimax', service: 'Image', kind: 'image', units: 2, unit: 'images' });
    await obs.recordUsage({ provider: 'minimax', service: 'Video', kind: 'video', units: 6, unit: 'seconds' });
    await obs.recordUsage({ provider: 'suno', service: 'Music', kind: 'music', units: 2, unit: 'tracks' });
    await obs.recordUsage({ provider: 'serper', service: 'Search', kind: 'search', units: 3, unit: 'requests' });
    const summary = obs.usageSummary();
    expect(summary.today.costCny).toBeCloseTo(0.1 + 0.4 + 3 + 0.4 + 0.015, 4);
    expect(summary.byProvider.length).toBe(4);
    expect(summary.byDay.length).toBe(30);
    expect(summary.recent.length).toBe(5);
  });

  it('神经事件与阶段进展可观测，清空只影响视图与账本', async () => {
    const seen: string[] = [];
    bus.on('neural:event', (event) => seen.push((event as { type: string }).type));
    obs.beginTurn('c1', '接收消息');
    obs.phase('DeepSeek 推理', 0.5, { node: 'deepseek', detail: 'thinking' });
    obs.recordNeural({ type: 'reply', node: 'core', target: 'user', label: '回复' });
    const snap = obs.snapshot();
    expect(snap.events.length).toBeGreaterThan(0);
    expect(seen).toContain('thought');
    obs.endTurn('c1');
    expect(obs.snapshot().stats.thinking).toBe(false);
    obs.clearEvents();
    expect(obs.snapshot().events.length).toBe(0);
    await obs.recordUsage({ provider: 'serper', service: 'search', kind: 'search', units: 1, unit: 'requests' });
    await obs.clearUsage();
    expect(obs.usageSummary().all.calls).toBe(0);
  });
});
