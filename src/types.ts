import type * as THREE from 'three';
import type { ConfidenceRating } from './telemetry/FrameStats.ts';
import type { BoundVerdict } from './telemetry/GpuTimer.ts';

export type { ConfidenceRating } from './telemetry/FrameStats.ts';
export type { BoundVerdict } from './telemetry/GpuTimer.ts';

export const APP_VERSION = '2.0.0';

export type StageId = 'instanced' | 'raymarch' | 'water' | 'combined';

export type BenchmarkMode = 'benchmark' | 'sandbox';

export type PresetId = 'mobile' | 'laptop' | 'desktop' | 'extreme' | 'custom';

export interface BenchmarkPreset {
  id: Exclude<PresetId, 'custom'>;
  label: string;
  description: string;
  resolutionScale: number;
  instanceScale: number;
  stageDurationSec: number;
}

export const BENCHMARK_PRESETS: Record<Exclude<PresetId, 'custom'>, BenchmarkPreset> = {
  mobile: {
    id: 'mobile',
    label: 'Mobile',
    description: '0.75× res · 40% instances · 10s/stage',
    resolutionScale: 0.75,
    instanceScale: 0.4,
    stageDurationSec: 10,
  },
  laptop: {
    id: 'laptop',
    label: 'Laptop',
    description: '1.00× res · 75% instances · 12s/stage',
    resolutionScale: 1.0,
    instanceScale: 0.75,
    stageDurationSec: 12,
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop',
    description: '1.00× res · 100% instances · 15s/stage',
    resolutionScale: 1.0,
    instanceScale: 1.0,
    stageDurationSec: 15,
  },
  extreme: {
    id: 'extreme',
    label: 'Extreme',
    description: '1.50× res · 100% instances · 20s/stage',
    resolutionScale: 1.5,
    instanceScale: 1.0,
    stageDurationSec: 20,
  },
};

export interface SandboxPasses {
  instancedMesh: boolean;
  raymarchShader: boolean;
  waterCaustics: boolean;
  dynamicLights: boolean;
  unrealBloom: boolean;
}

export interface WebGLGPUInfo {
  renderer: string;
  vendor: string;
  webglVersion: string;
  maxTextureSize: number;
  isFallback: boolean;
  timerQueryAvailable: boolean;
}

export interface TelemetrySnapshot {
  fps: number;
  frameTimeMs: number;
  onePercentLowFps: number;
  gpuTimeMs: number | null;
  drawCalls: number;
  triangles: number;
  resolutionWidth: number;
  resolutionHeight: number;
  pixelRatio: number;
  resolutionScale: number;
}

export interface StageMetrics {
  id: StageId;
  name: string;
  weight: number;
  avgFps: number;
  medianFps: number;
  minFps: number;
  maxFps: number;
  onePercentLowFps: number;
  avgFrameTimeMs: number;
  medianFrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  madMs: number;
  cv: number;
  stutterCount: number;
  throttled: boolean;
  vsyncPinned: boolean;
  vsyncTargetHz: number | null;
  confidence: ConfidenceRating;
  warnings: string[];
  gpuTimeMs: number | null;
  boundVerdict: BoundVerdict;
  avgDrawCalls: number;
  avgTriangles: number;
  stageScore: number;
  sampleCount: number;
  warmupDiscardedCount: number;
}

export interface HardwareTier {
  badge: string;
  label: string;
  color: string;
  summary: string;
}

export interface BenchmarkResult {
  id: string;
  version: string;
  timestamp: string;
  seed: number;
  presetId: PresetId;
  instanceScale: number;
  durationSec: number;
  resolutionScale: number;
  gpu: WebGLGPUInfo;
  compositeScore: number;
  tier: HardwareTier;
  confidence: ConfidenceRating;
  warnings: string[];
  boundVerdict: BoundVerdict;
  stages: StageMetrics[];
  overallAvgFps: number;
  overallMedianFps: number;
  overallOnePercentLowFps: number;
  invalidated?: boolean;
}

export interface StabilityLoopSample {
  loopIndex: number;
  elapsedSec: number;
  compositeScore: number;
  medianFps: number;
  confidence: ConfidenceRating;
}

export interface StabilityReport {
  id: string;
  timestamp: string;
  targetDurationMin: 5 | 10;
  actualDurationSec: number;
  loopsCompleted: number;
  peakScore: number;
  sustainedScore: number;
  sustainedRatio: number;
  throttled: boolean;
  verdict: string;
  samples: StabilityLoopSample[];
}

export interface BenchmarkProgress {
  running: boolean;
  stageIndex: number;
  stageId: StageId;
  stageName: string;
  stageElapsedSec: number;
  stageDurationSec: number;
  totalElapsedSec: number;
  totalDurationSec: number;
  stabilityMode?: boolean;
  stabilityLoopIndex?: number;
  stabilityTargetSec?: number;
  stabilityElapsedSec?: number;
}

export interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface StageDescriptor {
  id: StageId;
  name: string;
  description: string;
  weight: number;
}

export interface BenchmarkStage {
  readonly id: StageId;
  readonly name: string;
  readonly description: string;
  readonly weight: number;
  init(renderer: THREE.WebGLRenderer, width: number, height: number): void;
  resize(width: number, height: number): void;
  getCameraPreset(): CameraPreset;
  update(elapsedSec: number, deltaSec: number, camera: THREE.PerspectiveCamera, isSandbox: boolean): void;
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target?: THREE.WebGLRenderTarget | null): void;
  dispose(): void;
  setLightsEnabled?(enabled: boolean): void;
  setBackgroundMode?(enabled: boolean): void;
  setOverlayMode?(enabled: boolean): void;
  setSeed?(seed: number): void;
  setInstanceScale?(scale: number): void;
}

export interface UICallbacks {
  onTelemetry?: (snapshot: TelemetrySnapshot) => void;
  onProgress?: (progress: BenchmarkProgress) => void;
  onStageTransition?: (stageIndex: number, stageId: StageId, stageName: string) => void;
  onBenchmarkComplete?: (result: BenchmarkResult) => void;
  onBenchmarkStopped?: () => void;
  onStabilityComplete?: (report: StabilityReport) => void;
  onModeChange?: (mode: BenchmarkMode) => void;
  onSandboxPassesChange?: (passes: SandboxPasses) => void;
  onResolutionScaleChange?: (scale: number) => void;
  onPresetChange?: (presetId: PresetId) => void;
  onGPUInfo?: (gpuInfo: WebGLGPUInfo) => void;
  onContextLost?: (message: string) => void;
  onContextRestored?: () => void;
  onError?: (message: string) => void;
}

export interface EngineController {
  startBenchmark(stageDurationSec?: number): void;
  startStabilityTest(durationMinutes: 5 | 10): void;
  stopBenchmark(): void;
  setMode(mode: BenchmarkMode): void;
  getMode(): BenchmarkMode;
  setSandboxPasses(passes: Partial<SandboxPasses>): void;
  getSandboxPasses(): SandboxPasses;
  setResolutionScale(scale: number): void;
  getResolutionScale(): number;
  applyPreset(presetId: Exclude<PresetId, 'custom'>): void;
  getPresetId(): PresetId;
  getInstanceScale(): number;
  getSeed(): number;
  setSeed(seed: number): void;
  resetSandboxCamera(): void;
  getGPUInfo(): WebGLGPUInfo;
  getStageDescriptors(): StageDescriptor[];
  getLastResult(): BenchmarkResult | null;
  getProgress(): BenchmarkProgress;
  setUICallbacks(callbacks: UICallbacks): void;
  dispose(): void;
}

export const STAGE_SEQUENCE: readonly StageId[] = ['instanced', 'raymarch', 'water', 'combined'] as const;

export const DEFAULT_STAGE_DURATION_SEC = 15;

export const DEFAULT_SANDBOX_PASSES: SandboxPasses = {
  instancedMesh: true,
  raymarchShader: false,
  waterCaustics: false,
  dynamicLights: true,
  unrealBloom: false,
};
