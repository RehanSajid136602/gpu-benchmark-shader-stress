import { describe, expect, it } from 'vitest';
import { ScorecardCalculator } from '../src/engine/ScorecardCalculator.ts';
import { RunHistoryStorage } from '../src/storage/RunHistoryStorage.ts';
import type { WebGLGPUInfo } from '../src/types.ts';

const MOCK_GPU: WebGLGPUInfo = {
  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)',
  vendor: 'Google Inc. (NVIDIA)',
  webglVersion: 'WebGL 2.0',
  maxTextureSize: 16384,
  isFallback: false,
  timerQueryAvailable: true,
};

describe('ScorecardCalculator & Normalization', () => {
  it('normalizes arbitrary stage weights to sum to 1.0', () => {
    const normalized = ScorecardCalculator.normalizeWeights([0.25, 0.30, 0.25, 0.25]);
    const sum = normalized.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
    expect(normalized[0]).toBeCloseTo(0.25 / 1.05, 5);
  });

  it('scores stages using median FPS rather than mean FPS', () => {
    const acc = ScorecardCalculator.createAccumulator('instanced', 'Instanced', 0.25, 15000, 0);
    // 39 steady 10ms (100 fps) frames + 1 extreme 500ms outlier
    for (let i = 0; i < 39; i++) {
      ScorecardCalculator.recordSample(acc, 10.0, 10, 1000);
    }
    ScorecardCalculator.recordSample(acc, 500.0, 10, 1000);

    const metrics = ScorecardCalculator.computeStageMetrics(acc, 1.0, false, 0.25);
    expect(metrics.medianFps).toBe(100);
    expect(metrics.avgFps).toBeLessThan(55);
    // Score should reflect median ~100 FPS (~6266), not the outlier-dragged mean (~2843)
    expect(metrics.stageScore).toBeGreaterThan(6000);
  });

  it('never promotes low-confidence runs to Personal Best in history migration', () => {
    const accHigh = ScorecardCalculator.createAccumulator('instanced', 'Instanced', 1.0, 15000, 0);
    for (let i = 0; i < 40; i++) ScorecardCalculator.recordSample(accHigh, 10.5, 5, 1000);
    const highResult = ScorecardCalculator.buildResult([accHigh], 15, 1.0, MOCK_GPU, {
      seed: 42,
      presetId: 'desktop',
      instanceScale: 1.0,
    });

    const accLow = ScorecardCalculator.createAccumulator('instanced', 'Instanced', 1.0, 15000, 0);
    for (let i = 0; i < 40; i++) ScorecardCalculator.recordSample(accLow, 16.67, 5, 1000); // VSync pinned -> low
    const lowResult = ScorecardCalculator.buildResult([accLow], 15, 1.0, MOCK_GPU, {
      seed: 43,
      presetId: 'desktop',
      instanceScale: 1.0,
    });
    lowResult.compositeScore = 99999; // Even with higher score, low confidence must not become PB

    const migrated = RunHistoryStorage.migrate({
      version: 0,
      personalBestId: lowResult.id,
      runs: [lowResult, highResult],
    });

    expect(migrated.version).toBe(1);
    expect(migrated.personalBestId).toBe(highResult.id);
  });
});
