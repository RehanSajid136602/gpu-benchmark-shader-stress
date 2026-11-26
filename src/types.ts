import type * as THREE from 'three';

export type StageId = 'instanced' | 'raymarch' | 'water' | 'combined';

export type BenchmarkMode = 'benchmark' | 'sandbox';

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
}

export interface TelemetrySnapshot {
  fps: number;
  frameTimeMs: number;
  onePercentLowFps: number;
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
  minFps: number;
  maxFps: number;
  onePercentLowFps: number;
  avgFrameTimeMs: number;
  avgDrawCalls: number;
  avgTriangles: number;
  stageScore: number;
  sampleCount: number;
}

export interface HardwareTier {
  badge: string;
  label: string;
  color: string;
  summary: string;
}

export interface BenchmarkResult {
  id: string;
  timestamp: string;
  durationSec: number;
  resolutionScale: number;
  gpu: WebGLGPUInfo;
  compositeScore: number;
  tier: HardwareTier;
  stages: StageMetrics[];
  overallAvgFps: number;
  overallOnePercentLowFps: number;
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
}

export interface UICallbacks {
  onTelemetry?: (snapshot: TelemetrySnapshot) => void;
  onProgress?: (progress: BenchmarkProgress) => void;
  onBenchmarkComplete?: (result: BenchmarkResult) => void;
  onBenchmarkStopped?: () => void;
  onModeChange?: (mode: BenchmarkMode) => void;
  onSandboxPassesChange?: (passes: SandboxPasses) => void;
  onResolutionScaleChange?: (scale: number) => void;
  onGPUInfo?: (gpuInfo: WebGLGPUInfo) => void;
  onError?: (message: string) => void;
}

export interface EngineController {
  startBenchmark(stageDurationSec?: number): void;
  stopBenchmark(): void;
  setMode(mode: BenchmarkMode): void;
  getMode(): BenchmarkMode;
  setSandboxPasses(passes: Partial<SandboxPasses>): void;
  getSandboxPasses(): SandboxPasses;
  setResolutionScale(scale: number): void;
  getResolutionScale(): number;
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
