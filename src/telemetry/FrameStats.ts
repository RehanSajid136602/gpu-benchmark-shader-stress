export type ConfidenceRating = 'high' | 'medium' | 'low';

export const DEFAULT_WARMUP_MS = 1500;
export const REFRESH_TARGETS_HZ = [60, 75, 90, 120, 144, 165, 240] as const;

export interface FrameStatsOptions {
  isFallbackGpu?: boolean;
  tabHidden?: boolean;
  contextLost?: boolean;
  dprChanged?: boolean;
  warmupDiscardedCount?: number;
}

export interface FrameStatsSummary {
  sampleCount: number;
  warmupDiscardedCount: number;
  medianFrameTimeMs: number;
  medianFps: number;
  avgFrameTimeMs: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  onePercentLowFps: number;
  madMs: number;
  cv: number;
  stutterCount: number;
  throttled: boolean;
  throttleRatio: number;
  vsyncPinned: boolean;
  vsyncTargetHz: number | null;
  confidence: ConfidenceRating;
  warnings: string[];
}

/**
 * Accumulates per-stage frame times with automatic warmup discard
 * (eliminating shader compile & first-frame spikes) and computes robust
 * median/percentile/MAD statistics, throttle detection, vsync detection,
 * and confidence ratings.
 */
export class FrameStatsCollector {
  private readonly warmupMs: number;
  private elapsedMs = 0;
  private warmupDiscardedCount = 0;
  private readonly samplesMs: number[] = [];

  constructor(warmupMs = DEFAULT_WARMUP_MS, expectedStageDurationMs?: number) {
    if (
      typeof expectedStageDurationMs === 'number' &&
      Number.isFinite(expectedStageDurationMs) &&
      expectedStageDurationMs > 0
    ) {
      // Never discard more than 25% of a short custom stage duration
      this.warmupMs = Math.min(warmupMs, expectedStageDurationMs * 0.25);
    } else {
      this.warmupMs = Math.max(0, warmupMs);
    }
  }

  public record(frameTimeMs: number): boolean {
    const clamped = Math.max(0.1, Math.min(frameTimeMs, 10_000));
    this.elapsedMs += clamped;
    if (this.elapsedMs <= this.warmupMs) {
      this.warmupDiscardedCount += 1;
      return false;
    }
    this.samplesMs.push(clamped);
    return true;
  }

  public getSamples(): readonly number[] {
    return this.samplesMs;
  }

  public getWarmupDiscardedCount(): number {
    return this.warmupDiscardedCount;
  }

  public summarize(options?: FrameStatsOptions): FrameStatsSummary {
    return analyzeFrameTimes(this.samplesMs, {
      ...options,
      warmupDiscardedCount: options?.warmupDiscardedCount ?? this.warmupDiscardedCount,
    });
  }
}

export function computePercentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const clampedP = Math.max(0, Math.min(1, p));
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil(clampedP * sortedAsc.length) - 1),
  );
  return sortedAsc[idx]!;
}

export function computeMedian(sortedAsc: readonly number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sortedAsc[mid]!;
  }
  return (sortedAsc[mid - 1]! + sortedAsc[mid]!) * 0.5;
}

/**
 * Pure statistical analyzer over post-warmup frame times (ms).
 * Used both by live benchmark runs and unit tests.
 */
export function analyzeFrameTimes(
  samplesMs: readonly number[],
  options: FrameStatsOptions = {},
): FrameStatsSummary {
  const warmupDiscardedCount = options.warmupDiscardedCount ?? 0;
  const n = samplesMs.length;

  if (n === 0) {
    const warnings: string[] = ['Insufficient post-warmup samples collected.'];
    if (options.contextLost) warnings.push('WebGL2 context lost during stage.');
    if (options.tabHidden) warnings.push('Browser tab was hidden during stage.');
    return {
      sampleCount: 0,
      warmupDiscardedCount,
      medianFrameTimeMs: 0,
      medianFps: 0,
      avgFrameTimeMs: 0,
      avgFps: 0,
      minFps: 0,
      maxFps: 0,
      p95FrameTimeMs: 0,
      p99FrameTimeMs: 0,
      onePercentLowFps: 0,
      madMs: 0,
      cv: 0,
      stutterCount: 0,
      throttled: false,
      throttleRatio: 1,
      vsyncPinned: false,
      vsyncTargetHz: null,
      confidence: 'low',
      warnings,
    };
  }

  let sum = 0;
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = 0;
  const clean: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const v = Math.max(0.1, Math.min(samplesMs[i]!, 10_000));
    clean[i] = v;
    sum += v;
    if (v < minMs) minMs = v;
    if (v > maxMs) maxMs = v;
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const medianFrameTimeMs = computeMedian(sorted);
  const medianFps = medianFrameTimeMs > 0 ? 1000 / medianFrameTimeMs : 0;
  const avgFrameTimeMs = sum / n;
  const avgFps = avgFrameTimeMs > 0 ? 1000 / avgFrameTimeMs : 0;
  const minFps = maxMs > 0 ? 1000 / maxMs : 0;
  const maxFps = minMs > 0 ? 1000 / minMs : 0;

  const p95FrameTimeMs = computePercentile(sorted, 0.95);
  const p99FrameTimeMs = computePercentile(sorted, 0.99);
  const onePercentLowFps = p99FrameTimeMs > 0 ? 1000 / p99FrameTimeMs : 0;

  // MAD (Median Absolute Deviation) and Coefficient of Variation (CV)
  const absDevs: number[] = new Array(n);
  let sqDiffSum = 0;
  for (let i = 0; i < n; i++) {
    const v = clean[i]!;
    absDevs[i] = Math.abs(v - medianFrameTimeMs);
    const diff = v - avgFrameTimeMs;
    sqDiffSum += diff * diff;
  }
  absDevs.sort((a, b) => a - b);
  const madMs = computeMedian(absDevs);
  const stdDevMs = Math.sqrt(sqDiffSum / n);
  const cv = avgFrameTimeMs > 0 ? stdDevMs / avgFrameTimeMs : 0;

  // Stutter count: frames > max(2 * median, median + 16.67ms)
  const stutterThresholdMs = Math.max(medianFrameTimeMs * 2, medianFrameTimeMs + 16.67);
  let stutterCount = 0;
  for (let i = 0; i < n; i++) {
    if (clean[i]! > stutterThresholdMs) {
      stutterCount += 1;
    }
  }

  // Throttle detection: compare first-third median vs last-third median
  let throttled = false;
  let throttleRatio = 1;
  if (n >= 30) {
    const third = Math.floor(n / 3);
    const firstThird = clean.slice(0, third).sort((a, b) => a - b);
    const lastThird = clean.slice(n - third).sort((a, b) => a - b);
    const firstMed = computeMedian(firstThird);
    const lastMed = computeMedian(lastThird);
    if (firstMed > 0) {
      throttleRatio = lastMed / firstMed;
      if (throttleRatio >= 1.12) {
        throttled = true;
      }
    }
  }

  // VSync / refresh-cap detection: median FPS near a standard refresh target AND low CV
  let vsyncPinned = false;
  let vsyncTargetHz: number | null = null;
  if (n >= 15 && cv < 0.06) {
    for (const targetHz of REFRESH_TARGETS_HZ) {
      const relDiff = Math.abs(medianFps - targetHz) / targetHz;
      if (relDiff <= 0.025) {
        vsyncPinned = true;
        vsyncTargetHz = targetHz;
        break;
      }
    }
  }

  // Confidence rating & warnings
  const warnings: string[] = [];
  let confidence: ConfidenceRating = 'high';

  const degrade = (level: ConfidenceRating): void => {
    if (level === 'low') {
      confidence = 'low';
    } else if (level === 'medium' && confidence === 'high') {
      confidence = 'medium';
    }
  };

  if (options.contextLost) {
    degrade('low');
    warnings.push('WebGL2 context was lost during measurement.');
  }
  if (options.tabHidden) {
    degrade('low');
    warnings.push('Browser tab was hidden; background rAF throttling invalidates timing.');
  }
  if (options.isFallbackGpu) {
    degrade('low');
    warnings.push('Software rasterizer detected (SwiftShader/llvmpipe); not representative of hardware GPU.');
  }
  if (n < 20) {
    degrade('low');
    warnings.push(`Low sample count (${n} post-warmup frames).`);
  }
  if (vsyncPinned && vsyncTargetHz !== null) {
    degrade('low');
    warnings.push(
      `Display VSync/refresh cap detected (~${vsyncTargetHz} Hz, CV ${(cv * 100).toFixed(1)}%). Score reflects a display floor, not GPU ceiling.`,
    );
  }
  if (cv >= 0.25) {
    degrade('low');
    warnings.push(`High frame-time variance (CV ${(cv * 100).toFixed(1)}%).`);
  } else if (cv >= 0.12) {
    degrade('medium');
    warnings.push(`Moderate frame-time variance (CV ${(cv * 100).toFixed(1)}%).`);
  }

  if (throttled) {
    degrade('medium');
    const pct = Math.round((throttleRatio - 1) * 100);
    warnings.push(`Thermal/power throttling suspected: frame time slowed ${pct}% over stage.`);
  }
  if (stutterCount >= 5) {
    degrade('medium');
    warnings.push(`${stutterCount} frame stutters detected (> ${stutterThresholdMs.toFixed(1)} ms).`);
  }
  if (options.dprChanged) {
    degrade('medium');
    warnings.push('Display pixel ratio changed mid-stage.');
  }

  return {
    sampleCount: n,
    warmupDiscardedCount,
    medianFrameTimeMs: round2(medianFrameTimeMs),
    medianFps: round2(medianFps),
    avgFrameTimeMs: round2(avgFrameTimeMs),
    avgFps: round2(avgFps),
    minFps: round2(minFps),
    maxFps: round2(maxFps),
    p95FrameTimeMs: round2(p95FrameTimeMs),
    p99FrameTimeMs: round2(p99FrameTimeMs),
    onePercentLowFps: round2(onePercentLowFps),
    madMs: round2(madMs),
    cv: round4(cv),
    stutterCount,
    throttled,
    throttleRatio: round3(throttleRatio),
    vsyncPinned,
    vsyncTargetHz,
    confidence,
    warnings,
  };
}

export function combineConfidence(ratings: readonly ConfidenceRating[]): ConfidenceRating {
  let result: ConfidenceRating = 'high';
  for (const r of ratings) {
    if (r === 'low') return 'low';
    if (r === 'medium') result = 'medium';
  }
  return result;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
