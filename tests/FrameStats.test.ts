import { describe, expect, it } from 'vitest';
import {
  analyzeFrameTimes,
  FrameStatsCollector,
} from '../src/telemetry/FrameStats.ts';

describe('FrameStats', () => {
  it('discards warmup frames during the first 1500ms', () => {
    const collector = new FrameStatsCollector(1500);
    // 3 huge shader-compile spikes totaling 1400ms
    expect(collector.record(500)).toBe(false);
    expect(collector.record(500)).toBe(false);
    expect(collector.record(400)).toBe(false);
    // Crossing 1500ms boundary
    expect(collector.record(100)).toBe(false);
    // Post-warmup steady 10ms frames
    for (let i = 0; i < 40; i++) {
      expect(collector.record(10)).toBe(true);
    }

    const summary = collector.summarize();
    expect(summary.warmupDiscardedCount).toBe(4);
    expect(summary.sampleCount).toBe(40);
    expect(summary.medianFps).toBe(100);
    expect(summary.confidence).toBe('high');
  });

  it('rates steady non-vsync-pinned frames as high confidence', () => {
    // ~95 FPS (10.53ms) with tiny natural variance
    const samples = Array.from({ length: 60 }, (_, i) => 10.5 + (i % 3) * 0.15);
    const summary = analyzeFrameTimes(samples);

    expect(summary.medianFps).toBeGreaterThan(93);
    expect(summary.medianFps).toBeLessThan(96);
    expect(summary.throttled).toBe(false);
    expect(summary.vsyncPinned).toBe(false);
    expect(summary.stutterCount).toBe(0);
    expect(summary.confidence).toBe('high');
    expect(summary.warnings).toHaveLength(0);
  });

  it('detects thermal/power throttling between first third and last third', () => {
    const firstThird = Array.from({ length: 20 }, () => 10.0); // 100 fps
    const midThird = Array.from({ length: 20 }, () => 11.5);
    const lastThird = Array.from({ length: 20 }, () => 14.0); // ~71 fps (+40% frame time)
    const summary = analyzeFrameTimes([...firstThird, ...midThird, ...lastThird]);

    expect(summary.throttled).toBe(true);
    expect(summary.throttleRatio).toBeGreaterThanOrEqual(1.12);
    expect(summary.confidence).toBe('medium');
    expect(summary.warnings.some((w) => w.toLowerCase().includes('throttling'))).toBe(true);
  });

  it('detects VSync / refresh-cap pinning at 60Hz and 144Hz', () => {
    const samples60 = Array.from({ length: 60 }, () => 16.67);
    const res60 = analyzeFrameTimes(samples60);
    expect(res60.vsyncPinned).toBe(true);
    expect(res60.vsyncTargetHz).toBe(60);
    expect(res60.confidence).toBe('low');

    const samples144 = Array.from({ length: 60 }, () => 6.94);
    const res144 = analyzeFrameTimes(samples144);
    expect(res144.vsyncPinned).toBe(true);
    expect(res144.vsyncTargetHz).toBe(144);
    expect(res144.confidence).toBe('low');
  });

  it('detects stuttery runs and degrades confidence', () => {
    const samples = Array.from({ length: 50 }, () => 11.0);
    // Inject 6 severe stutters (> 2x median and > median + 16.67ms)
    for (let i = 5; i < 35; i += 5) {
      samples[i] = 65.0;
    }
    const summary = analyzeFrameTimes(samples);

    expect(summary.stutterCount).toBe(6);
    expect(summary.confidence).not.toBe('high');
    expect(summary.warnings.some((w) => w.toLowerCase().includes('stutter'))).toBe(true);
  });
});
