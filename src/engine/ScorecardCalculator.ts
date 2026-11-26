import {
  analyzeFrameTimes,
  combineConfidence,
  DEFAULT_WARMUP_MS,
  FrameStatsCollector,
  type FrameStatsOptions,
} from '../telemetry/FrameStats.ts';
import type { BoundVerdict, GpuTimerStats } from '../telemetry/GpuTimer.ts';
import {
  APP_VERSION,
  type BenchmarkResult,
  type ConfidenceRating,
  type HardwareTier,
  type PresetId,
  type StageId,
  type StageMetrics,
  type WebGLGPUInfo,
} from '../types.ts';

export interface StageSampleAccumulator {
  id: StageId;
  name: string;
  weight: number;
  collector: FrameStatsCollector;
  drawCallsSum: number;
  trianglesSum: number;
  renderSampleCount: number;
  gpuStats?: GpuTimerStats;
  tabHidden: boolean;
  contextLost: boolean;
  dprChanged: boolean;
}

export interface BuildResultOptions {
  seed: number;
  presetId: PresetId;
  instanceScale: number;
  invalidated?: boolean;
}

export class ScorecardCalculator {
  public static createAccumulator(
    id: StageId,
    name: string,
    weight: number,
    expectedStageDurationMs?: number,
    warmupMs = DEFAULT_WARMUP_MS,
  ): StageSampleAccumulator {
    return {
      id,
      name,
      weight,
      collector: new FrameStatsCollector(warmupMs, expectedStageDurationMs),
      drawCallsSum: 0,
      trianglesSum: 0,
      renderSampleCount: 0,
      tabHidden: false,
      contextLost: false,
      dprChanged: false,
    };
  }

  public static recordSample(
    acc: StageSampleAccumulator,
    frameTimeMs: number,
    drawCalls: number,
    triangles: number,
  ): void {
    const kept = acc.collector.record(frameTimeMs);
    if (kept) {
      acc.drawCallsSum += drawCalls;
      acc.trianglesSum += triangles;
      acc.renderSampleCount += 1;
    }
  }

  public static computeOnePercentLowFps(frameTimesMs: readonly number[]): number {
    if (frameTimesMs.length === 0) return 0;
    const summary = analyzeFrameTimes(frameTimesMs);
    return summary.onePercentLowFps;
  }

  public static normalizeWeights(weights: readonly number[]): number[] {
    const sum = weights.reduce((acc, w) => acc + (Number.isFinite(w) && w > 0 ? w : 0), 0);
    if (sum <= 0) {
      const equal = weights.length > 0 ? 1 / weights.length : 0;
      return weights.map(() => equal);
    }
    return weights.map((w) => (Number.isFinite(w) && w > 0 ? w / sum : 0));
  }

  public static computeStageMetrics(
    acc: StageSampleAccumulator,
    resolutionScale: number,
    isFallbackGpu = false,
    normalizedWeight?: number,
  ): StageMetrics {
    const options: FrameStatsOptions = {
      isFallbackGpu,
      tabHidden: acc.tabHidden,
      contextLost: acc.contextLost,
      dprChanged: acc.dprChanged,
    };
    const stats = acc.collector.summarize(options);
    const weight = normalizedWeight ?? acc.weight;

    if (stats.sampleCount === 0) {
      return {
        id: acc.id,
        name: acc.name,
        weight: round3(weight),
        avgFps: 0,
        medianFps: 0,
        minFps: 0,
        maxFps: 0,
        onePercentLowFps: 0,
        avgFrameTimeMs: 0,
        medianFrameTimeMs: 0,
        p95FrameTimeMs: 0,
        p99FrameTimeMs: 0,
        madMs: 0,
        cv: 0,
        stutterCount: 0,
        throttled: false,
        vsyncPinned: false,
        vsyncTargetHz: null,
        confidence: stats.confidence,
        warnings: stats.warnings,
        gpuTimeMs: acc.gpuStats?.medianGpuTimeMs ?? null,
        boundVerdict: acc.gpuStats?.boundVerdict ?? 'unavailable',
        avgDrawCalls: 0,
        avgTriangles: 0,
        stageScore: 0,
        sampleCount: 0,
        warmupDiscardedCount: stats.warmupDiscardedCount,
      };
    }

    const avgDrawCalls =
      acc.renderSampleCount > 0 ? Math.round(acc.drawCallsSum / acc.renderSampleCount) : 0;
    const avgTriangles =
      acc.renderSampleCount > 0 ? Math.round(acc.trianglesSum / acc.renderSampleCount) : 0;

    // Score uses MEDIAN FPS (not mean) + 1% low stability + resolution scale factor
    const effectiveFps = stats.medianFps * 0.70 + stats.onePercentLowFps * 0.30;
    const stabilityRatio =
      stats.medianFps > 0 ? Math.min(1, Math.max(0.25, stats.onePercentLowFps / stats.medianFps)) : 0.25;
    const stabilityMultiplier = 0.85 + 0.15 * stabilityRatio;
    const scaleFactor = Math.pow(Math.max(0.5, resolutionScale), 1.15);
    const stageScore = Math.round(effectiveFps * 100 * stabilityMultiplier * scaleFactor);

    return {
      id: acc.id,
      name: acc.name,
      weight: round3(weight),
      avgFps: stats.avgFps,
      medianFps: stats.medianFps,
      minFps: stats.minFps,
      maxFps: stats.maxFps,
      onePercentLowFps: stats.onePercentLowFps,
      avgFrameTimeMs: stats.avgFrameTimeMs,
      medianFrameTimeMs: stats.medianFrameTimeMs,
      p95FrameTimeMs: stats.p95FrameTimeMs,
      p99FrameTimeMs: stats.p99FrameTimeMs,
      madMs: stats.madMs,
      cv: stats.cv,
      stutterCount: stats.stutterCount,
      throttled: stats.throttled,
      vsyncPinned: stats.vsyncPinned,
      vsyncTargetHz: stats.vsyncTargetHz,
      confidence: stats.confidence,
      warnings: stats.warnings,
      gpuTimeMs: acc.gpuStats?.medianGpuTimeMs ?? null,
      boundVerdict: acc.gpuStats?.boundVerdict ?? 'unavailable',
      avgDrawCalls,
      avgTriangles,
      stageScore,
      sampleCount: stats.sampleCount,
      warmupDiscardedCount: stats.warmupDiscardedCount,
    };
  }

  public static assignHardwareTier(compositeScore: number, gpu: WebGLGPUInfo): HardwareTier {
    if (gpu.isFallback && compositeScore < 1800) {
      return {
        badge: 'ENTRY',
        label: 'Software / Fallback Rasterizer',
        color: '#ff5d47',
        summary:
          'Software WebGL rasterizer detected (SwiftShader/llvmpipe). Hardware GPU acceleration is recommended for high-FPS shader stress workloads.',
      };
    }

    if (compositeScore >= 9000) {
      return {
        badge: 'TIER S',
        label: 'Enthusiast / Flagship GPU',
        color: '#f5b841',
        summary:
          'Exceptional rasterization and fragment throughput across 500k instanced meshes, deep raymarching, multi-pass water, and bloom.',
      };
    }

    if (compositeScore >= 6000) {
      return {
        badge: 'TIER A',
        label: 'Performance / High-End GPU',
        color: '#34d399',
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
        color: '#fb923c',
        summary:
          'Capable of real-time WebGL2 rendering; lowering resolution scale to 0.75x improves shader-bound headroom.',
      };
    }

    return {
      badge: 'ENTRY',
      label: 'Entry / Constrained GPU',
      color: '#ff5d47',
      summary:
        'Limited shader fill-rate or fallback rendering detected; use lower resolution scales or Mobile preset for smoother exploration.',
    };
  }

  public static buildResult(
    accumulators: readonly StageSampleAccumulator[],
    durationSec: number,
    resolutionScale: number,
    gpu: WebGLGPUInfo,
    options: BuildResultOptions = {
      seed: 1,
      presetId: 'desktop',
      instanceScale: 1.0,
    },
  ): BenchmarkResult {
    const normalizedWeights = ScorecardCalculator.normalizeWeights(
      accumulators.map((a) => a.weight),
    );

    const stages = accumulators.map((acc, idx) =>
      ScorecardCalculator.computeStageMetrics(
        acc,
        resolutionScale,
        gpu.isFallback,
        normalizedWeights[idx],
      ),
    );

    let weightedScoreSum = 0;
    const allFrameTimes: number[] = [];
    let totalFrameTimeMs = 0;
    const allWarnings = new Set<string>();
    const confidences: ConfidenceRating[] = [];

    let gpuBoundCount = 0;
    let cpuBoundCount = 0;
    let availableBoundCount = 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      const acc = accumulators[i]!;
      weightedScoreSum += stage.stageScore * stage.weight;
      confidences.push(stage.confidence);
      for (const w of stage.warnings) {
        allWarnings.add(w);
      }
      if (stage.boundVerdict !== 'unavailable') {
        availableBoundCount += 1;
        if (stage.boundVerdict === 'gpu-bound') gpuBoundCount += 1;
        else if (stage.boundVerdict === 'cpu-bound') cpuBoundCount += 1;
      }

      const samples = acc.collector.getSamples();
      for (let j = 0; j < samples.length; j++) {
        const ms = samples[j]!;
        allFrameTimes.push(ms);
        totalFrameTimeMs += ms;
      }
    }

    const compositeScore = Math.round(weightedScoreSum);
    const overallSummary = analyzeFrameTimes(allFrameTimes, {
      isFallbackGpu: gpu.isFallback,
    });
    const overallAvgFps =
      allFrameTimes.length > 0 && totalFrameTimeMs > 0
        ? round2(1000 / (totalFrameTimeMs / allFrameTimes.length))
        : 0;
    const overallMedianFps = overallSummary.medianFps;
    const overallOnePercentLowFps = overallSummary.onePercentLowFps;

    let confidence: ConfidenceRating = combineConfidence(confidences);
    if (options.invalidated) {
      confidence = 'low';
      allWarnings.add('Run was invalidated due to WebGL context loss or interruption.');
    }

    let boundVerdict: BoundVerdict = 'unavailable';
    if (availableBoundCount > 0) {
      if (gpuBoundCount > cpuBoundCount) boundVerdict = 'gpu-bound';
      else if (cpuBoundCount > gpuBoundCount) boundVerdict = 'cpu-bound';
      else boundVerdict = 'balanced';
    }

    const tier = ScorecardCalculator.assignHardwareTier(compositeScore, gpu);
    const timestamp = new Date().toISOString();
    const id = `bench-${Date.now().toString(36)}`;

    return {
      id,
      version: APP_VERSION,
      timestamp,
      seed: options.seed,
      presetId: options.presetId,
      instanceScale: round2(options.instanceScale),
      durationSec: round2(durationSec),
      resolutionScale: round2(resolutionScale),
      gpu,
      compositeScore,
      tier,
      confidence,
      warnings: Array.from(allWarnings),
      boundVerdict,
      stages,
      overallAvgFps,
      overallMedianFps,
      overallOnePercentLowFps,
      invalidated: options.invalidated,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
