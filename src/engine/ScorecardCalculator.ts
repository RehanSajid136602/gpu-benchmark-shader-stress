import type {
  BenchmarkResult,
  HardwareTier,
  StageId,
  StageMetrics,
  WebGLGPUInfo,
} from '../types.ts';

export interface StageSampleAccumulator {
  id: StageId;
  name: string;
  weight: number;
  frameTimesMs: number[];
  drawCallsSum: number;
  trianglesSum: number;
}

export class ScorecardCalculator {
  public static createAccumulator(id: StageId, name: string, weight: number): StageSampleAccumulator {
    return {
      id,
      name,
      weight,
      frameTimesMs: [],
      drawCallsSum: 0,
      trianglesSum: 0,
    };
  }

  public static recordSample(
    acc: StageSampleAccumulator,
    frameTimeMs: number,
    drawCalls: number,
    triangles: number,
  ): void {
    // Clamp pathological zero/negative durations while preserving genuine slow frames
    const clampedMs = Math.max(0.1, Math.min(frameTimeMs, 10_000));
    acc.frameTimesMs.push(clampedMs);
    acc.drawCallsSum += drawCalls;
    acc.trianglesSum += triangles;
  }

  public static computeOnePercentLowFps(frameTimesMs: readonly number[]): number {
    if (frameTimesMs.length === 0) return 0;
    const sorted = [...frameTimesMs].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(0.99 * sorted.length) - 1),
    );
    const p99Ms = sorted[idx] ?? 0;
    return p99Ms > 0 ? 1000 / p99Ms : 0;
  }

  public static computeStageMetrics(
    acc: StageSampleAccumulator,
    resolutionScale: number,
  ): StageMetrics {
    const sampleCount = acc.frameTimesMs.length;
    if (sampleCount === 0) {
      return {
        id: acc.id,
        name: acc.name,
        weight: acc.weight,
        avgFps: 0,
        minFps: 0,
        maxFps: 0,
        onePercentLowFps: 0,
        avgFrameTimeMs: 0,
        avgDrawCalls: 0,
        avgTriangles: 0,
        stageScore: 0,
        sampleCount: 0,
      };
    }

    let totalMs = 0;
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;

    for (let i = 0; i < sampleCount; i++) {
      const ms = acc.frameTimesMs[i]!;
      totalMs += ms;
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    }

    const avgFrameTimeMs = totalMs / sampleCount;
    const avgFps = avgFrameTimeMs > 0 ? 1000 / avgFrameTimeMs : 0;
    const minFps = maxMs > 0 ? 1000 / maxMs : 0;
    const maxFps = minMs > 0 ? 1000 / minMs : 0;
    const onePercentLowFps = ScorecardCalculator.computeOnePercentLowFps(acc.frameTimesMs);

    const avgDrawCalls = Math.round(acc.drawCallsSum / sampleCount);
    const avgTriangles = Math.round(acc.trianglesSum / sampleCount);

    // Weighted FPS emphasizing frame-time consistency (1% low) and resolution scale load
    const effectiveFps = avgFps * 0.65 + onePercentLowFps * 0.35;
    const stabilityRatio = avgFps > 0 ? Math.min(1, Math.max(0.25, onePercentLowFps / avgFps)) : 0.25;
    const stabilityMultiplier = 0.85 + 0.15 * stabilityRatio;
    const scaleFactor = Math.pow(Math.max(0.5, resolutionScale), 1.15);
    const stageScore = Math.round(effectiveFps * 100 * stabilityMultiplier * scaleFactor);

    return {
      id: acc.id,
      name: acc.name,
      weight: acc.weight,
      avgFps: round2(avgFps),
      minFps: round2(minFps),
      maxFps: round2(maxFps),
      onePercentLowFps: round2(onePercentLowFps),
      avgFrameTimeMs: round2(avgFrameTimeMs),
      avgDrawCalls,
      avgTriangles,
      stageScore,
      sampleCount,
    };
  }

  public static assignHardwareTier(compositeScore: number, gpu: WebGLGPUInfo): HardwareTier {
    if (gpu.isFallback && compositeScore < 1800) {
      return {
        badge: 'ENTRY',
        label: 'Software / Fallback Rasterizer',
        color: '#ef4444',
        summary:
          'Software WebGL rasterizer detected (SwiftShader/llvmpipe). Hardware GPU acceleration is recommended for high-FPS shader stress workloads.',
      };
    }

    if (compositeScore >= 9000) {
      return {
        badge: 'TIER S',
        label: 'Enthusiast / Flagship GPU',
        color: '#f59e0b',
        summary:
          'Exceptional rasterization and fragment throughput across 500k instanced meshes, deep raymarching, multi-pass water, and bloom.',
      };
    }

    if (compositeScore >= 6000) {
      return {
        badge: 'TIER A',
        label: 'Performance / High-End GPU',
        color: '#22c55e',
        summary:
          'Sustained 60+ FPS class rendering under intense volumetric shaders, dynamic reflections, and post-processing.',
      };
    }

    if (compositeScore >= 3800) {
      return {
        badge: 'TIER B',
        label: 'Mainstream / Balanced GPU',
        color: '#38bdf8',
        summary:
          'Solid real-time WebGL2 throughput with consistent frame pacing across geometry and fragment workloads.',
      };
    }

    if (compositeScore >= 1800) {
      return {
        badge: 'TIER C',
        label: 'Baseline / Integrated GPU',
        color: '#a855f7',
        summary:
          'Capable of real-time WebGL2 rendering; lowering resolution scale to 0.75x improves shader-bound headroom.',
      };
    }

    return {
      badge: 'ENTRY',
      label: 'Entry / Constrained GPU',
      color: '#ef4444',
      summary:
        'Limited shader fill-rate or fallback rendering detected; use lower resolution scales in Sandbox mode for smoother exploration.',
    };
  }

  public static buildResult(
    accumulators: readonly StageSampleAccumulator[],
    durationSec: number,
    resolutionScale: number,
    gpu: WebGLGPUInfo,
  ): BenchmarkResult {
    const stages = accumulators.map((acc) =>
      ScorecardCalculator.computeStageMetrics(acc, resolutionScale),
    );

    let totalWeight = 0;
    let weightedScoreSum = 0;
    const allFrameTimes: number[] = [];
    let totalFrameTimeMs = 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      const acc = accumulators[i]!;
      totalWeight += stage.weight;
      weightedScoreSum += stage.stageScore * stage.weight;
      for (let j = 0; j < acc.frameTimesMs.length; j++) {
        const ms = acc.frameTimesMs[j]!;
        allFrameTimes.push(ms);
        totalFrameTimeMs += ms;
      }
    }

    const compositeScore = totalWeight > 0 ? Math.round(weightedScoreSum / totalWeight) : 0;
    const overallAvgFps =
      allFrameTimes.length > 0 && totalFrameTimeMs > 0
        ? round2(1000 / (totalFrameTimeMs / allFrameTimes.length))
        : 0;
    const overallOnePercentLowFps = round2(
      ScorecardCalculator.computeOnePercentLowFps(allFrameTimes),
    );
    const tier = ScorecardCalculator.assignHardwareTier(compositeScore, gpu);

    const timestamp = new Date().toISOString();
    const id = `bench-${Date.now().toString(36)}`;

    return {
      id,
      timestamp,
      durationSec: round2(durationSec),
      resolutionScale: round2(resolutionScale),
      gpu,
      compositeScore,
      tier,
      stages,
      overallAvgFps,
      overallOnePercentLowFps,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
