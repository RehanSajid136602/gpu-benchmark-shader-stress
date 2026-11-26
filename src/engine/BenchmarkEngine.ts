import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GpuTimer } from '../telemetry/GpuTimer.ts';
import {
  BENCHMARK_PRESETS,
  DEFAULT_SANDBOX_PASSES,
  DEFAULT_STAGE_DURATION_SEC,
  STAGE_SEQUENCE,
  type BenchmarkMode,
  type BenchmarkProgress,
  type BenchmarkResult,
  type BenchmarkStage,
  type EngineController,
  type PresetId,
  type SandboxPasses,
  type StabilityLoopSample,
  type StabilityReport,
  type StageDescriptor,
  type StageId,
  type TelemetrySnapshot,
  type UICallbacks,
  type WebGLGPUInfo,
} from '../types.ts';
import { parseOrGenerateSeed } from '../utils/prng.ts';
import { ScorecardCalculator, type StageSampleAccumulator } from './ScorecardCalculator.ts';

export interface BenchmarkEngineOptions {
  container: HTMLElement;
  stages: BenchmarkStage[];
  callbacks?: UICallbacks;
  initialMode?: BenchmarkMode;
  initialResolutionScale?: number;
}

interface DynamicLightOrb {
  light: THREE.PointLight;
  mesh: THREE.Mesh;
  radius: number;
  speed: number;
  phase: number;
  yOffset: number;
}

const TELEMETRY_WINDOW_SIZE = 180;
const FALLBACK_GPU_PATTERN = /swiftshader|llvmpipe|software|microsoft basic render|mesa offscreen/i;

export class BenchmarkEngine implements EngineController {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly gpuInfo: WebGLGPUInfo;
  private readonly gpuTimer: GpuTimer;

  private readonly stageMap = new Map<StageId, BenchmarkStage>();
  private readonly stageOrder: StageId[] = [];
  private readonly initializedStages = new Set<StageId>();

  private callbacks: UICallbacks;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private disposed = false;
  private contextLost = false;

  private viewportWidth = 1280;
  private viewportHeight = 720;
  private resolutionScale = 1.0;
  private instanceScale = 1.0;
  private effectivePixelRatio = 1.0;
  private lastKnownRawDpr = window.devicePixelRatio || 1;
  private presetId: PresetId = 'desktop';
  private seed: number;
  private hasExplicitSeed = false;

  private mode: BenchmarkMode = 'benchmark';
  private sandboxPasses: SandboxPasses = { ...DEFAULT_SANDBOX_PASSES };

  // Benchmark run state
  private defaultStageDurationSec = DEFAULT_STAGE_DURATION_SEC;
  private activeStageDurationSec = DEFAULT_STAGE_DURATION_SEC;
  private benchmarkRunning = false;
  private benchmarkStageIndex = 0;
  private stageElapsedSec = 0;
  private totalElapsedSec = 0;
  private stageAccumulators: StageSampleAccumulator[] = [];
  private lastResult: BenchmarkResult | null = null;
  private runInvalidated = false;

  // Stability loop state
  private stabilityMode = false;
  private stabilityTargetMinutes: 5 | 10 = 5;
  private stabilityTargetSec = 300;
  private stabilityElapsedSec = 0;
  private stabilityLoopIndex = 0;
  private stabilitySamples: StabilityLoopSample[] = [];

  // Timing & telemetry
  private lastFrameTimestampMs = 0;
  private sandboxElapsedSec = 0;
  private previewElapsedSec = 0;
  private smoothedFrameTimeMs = 16.67;
  private readonly rollingFrameTimesMs: number[] = [];
  private sandboxJustInitialized = false;

  // Sandbox post-processing & dynamic lights rig
  private sandboxRenderTarget: THREE.WebGLRenderTarget | null = null;
  private sandboxComposer: EffectComposer | null = null;
  private sandboxBloomPass: UnrealBloomPass | null = null;
  private sandboxOutputPass: OutputPass | null = null;

  private readonly sandboxLightsScene = new THREE.Scene();
  private readonly sandboxOrbs: DynamicLightOrb[] = [];
  private readonly sandboxFallbackGroup = new THREE.Group();
  private readonly sandboxAmbientLight = new THREE.AmbientLight(0x1f2937, 0.7);
  private readonly sandboxDisposables: Array<{ dispose(): void }> = [];

  constructor(options: BenchmarkEngineOptions) {
    this.container = options.container;
    this.callbacks = options.callbacks ?? {};
    this.mode = options.initialMode ?? 'benchmark';
    this.resolutionScale = clampResolutionScale(options.initialResolutionScale ?? 1.0);

    const urlParams = new URLSearchParams(window.location.search);
    const urlSeed = urlParams.get('seed');
    this.hasExplicitSeed = urlSeed !== null && urlSeed.trim() !== '';
    this.seed = parseOrGenerateSeed(urlSeed);

    const urlPreset = urlParams.get('preset');
    if (
      urlPreset === 'mobile' ||
      urlPreset === 'tablet' ||
      urlPreset === 'laptop' ||
      urlPreset === 'desktop' ||
      urlPreset === 'extreme'
    ) {
      const preset = BENCHMARK_PRESETS[urlPreset];
      this.presetId = preset.id;
      this.resolutionScale = preset.resolutionScale;
      this.instanceScale = preset.instanceScale;
      this.defaultStageDurationSec = preset.stageDurationSec;
    }

    const urlRes = urlParams.get('res');
    if (urlRes !== null) {
      const parsedRes = Number(urlRes);
      if (Number.isFinite(parsedRes) && parsedRes > 0) {
        this.resolutionScale = clampResolutionScale(parsedRes);
        if (urlPreset === null) this.presetId = 'custom';
      }
    }

    const urlStageDuration = urlParams.get('stageDuration');
    if (urlStageDuration !== null) {
      const parsed = Number(urlStageDuration);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 300) {
        this.defaultStageDurationSec = parsed;
      }
    }
    this.activeStageDurationSec = this.defaultStageDurationSec;

    for (const stage of options.stages) {
      this.stageMap.set(stage.id, stage);
    }
    for (const id of STAGE_SEQUENCE) {
      if (this.stageMap.has(id)) {
        this.stageOrder.push(id);
      }
    }
    for (const stage of options.stages) {
      if (!this.stageOrder.includes(stage.id)) {
        this.stageOrder.push(stage.id);
      }
    }

    // Prepare canvas inside container
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'benchmark-webgl-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);

    // Explicit WebGL2 context
    const gl = this.canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      const msg = 'WebGL2 is required but unavailable in this browser or GPU context.';
      this.callbacks.onError?.(msg);
      throw new Error(msg);
    }

    this.gpuTimer = new GpuTimer(gl);
    this.gpuInfo = this.detectGPUInfo(gl);

    // Cap extreme workload on software rasterizers unless user explicitly forced a preset/res
    if (this.gpuInfo.isFallback && urlPreset === null && urlRes === null) {
      this.presetId = 'mobile';
      this.resolutionScale = BENCHMARK_PRESETS.mobile.resolutionScale;
      this.instanceScale = BENCHMARK_PRESETS.mobile.instanceScale;
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: gl,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    // CRITICAL: manual reset once at start of each frame for multi-pass draw/triangle accuracy
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const rect = this.container.getBoundingClientRect();
    this.viewportWidth = Math.max(1, Math.floor(rect.width || window.innerWidth || 1280));
    this.viewportHeight = Math.max(1, Math.floor(rect.height || window.innerHeight || 720));

    this.camera = new THREE.PerspectiveCamera(
      60,
      this.viewportWidth / this.viewportHeight,
      0.1,
      400,
    );

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 120.0;
    this.controls.enabled = this.mode === 'sandbox';

    this.buildSandboxLightsRig();
    this.applyRendererSize();
    this.initSandboxBloomComposer();

    // Initialize first available stage and apply camera preset
    const initialStageId = this.stageOrder[0];
    if (initialStageId) {
      const stage = this.ensureStageInitialized(initialStageId);
      if (stage) {
        this.applyCameraPreset(stage.getCameraPreset());
      }
    }
    if (this.mode === 'sandbox') {
      this.resetSandboxCamera();
    }

    this.setupResizeHandling();
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.callbacks.onGPUInfo?.(this.gpuInfo);
    this.callbacks.onModeChange?.(this.mode);
    this.callbacks.onSandboxPassesChange?.({ ...this.sandboxPasses });
    this.callbacks.onResolutionScaleChange?.(this.resolutionScale);
    this.callbacks.onPresetChange?.(this.presetId);
    this.callbacks.onProgress?.(this.getProgress());

    this.lastFrameTimestampMs = performance.now();
    this.scheduleNextFrame();

    if (urlParams.get('autorun') === '1') {
      queueMicrotask(() => {
        if (!this.disposed) {
          this.startBenchmark();
        }
      });
    }
  }

  public setUICallbacks(callbacks: UICallbacks): void {
    this.callbacks = callbacks;
    this.callbacks.onGPUInfo?.(this.gpuInfo);
    this.callbacks.onModeChange?.(this.mode);
    this.callbacks.onSandboxPassesChange?.({ ...this.sandboxPasses });
    this.callbacks.onResolutionScaleChange?.(this.resolutionScale);
    this.callbacks.onPresetChange?.(this.presetId);
    this.callbacks.onProgress?.(this.getProgress());
  }

  public getGPUInfo(): WebGLGPUInfo {
    return { ...this.gpuInfo };
  }

  public getStageDescriptors(): StageDescriptor[] {
    const result: StageDescriptor[] = [];
    for (const id of this.stageOrder) {
      const stage = this.stageMap.get(id);
      if (stage) {
        result.push({
          id: stage.id,
          name: stage.name,
          description: stage.description,
          weight: stage.weight,
        });
      }
    }
    return result;
  }

  public getMode(): BenchmarkMode {
    return this.mode;
  }

  public setMode(mode: BenchmarkMode): void {
    if (this.mode === mode && !this.benchmarkRunning) return;
    if (this.benchmarkRunning && mode === 'sandbox') {
      this.stopBenchmark();
    }
    this.mode = mode;
    this.controls.enabled = mode === 'sandbox';

    if (mode === 'sandbox') {
      this.syncSandboxStageSettings();
      this.resetSandboxCamera();
    } else {
      const stageId = this.stageOrder[0];
      const stage = stageId ? this.ensureStageInitialized(stageId) : null;
      if (stage) {
        stage.setBackgroundMode?.(false);
        stage.setOverlayMode?.(false);
        stage.setLightsEnabled?.(true);
        this.applyCameraPreset(stage.getCameraPreset());
      }
    }

    this.callbacks.onModeChange?.(this.mode);
    this.callbacks.onProgress?.(this.getProgress());
  }

  public getSandboxPasses(): SandboxPasses {
    return { ...this.sandboxPasses };
  }

  public setSandboxPasses(passes: Partial<SandboxPasses>): void {
    const hadWater = this.sandboxPasses.waterCaustics;
    const hadInstanced = this.sandboxPasses.instancedMesh;
    const hadRaymarch = this.sandboxPasses.raymarchShader;

    this.sandboxPasses = {
      ...this.sandboxPasses,
      ...passes,
    };

    if (this.mode === 'sandbox') {
      this.syncSandboxStageSettings();
      const nowWater = this.sandboxPasses.waterCaustics;
      const nowInstanced = this.sandboxPasses.instancedMesh;
      const nowRaymarch = this.sandboxPasses.raymarchShader;

      const previouslyAnyVisual = hadWater || hadInstanced || hadRaymarch;
      const nowAnyVisual = nowWater || nowInstanced || nowRaymarch;
      const becameSoloRaymarch =
        nowRaymarch && !nowInstanced && !nowWater && (!hadRaymarch || hadInstanced || hadWater);
      const exitedSoloRaymarchTo3D =
        hadRaymarch && !hadInstanced && !hadWater && (nowInstanced || nowWater);

      if ((!previouslyAnyVisual && nowAnyVisual) || becameSoloRaymarch || exitedSoloRaymarchTo3D) {
        this.resetSandboxCamera();
      }
    }

    this.callbacks.onSandboxPassesChange?.({ ...this.sandboxPasses });
  }

  public getResolutionScale(): number {
    return this.resolutionScale;
  }

  public setResolutionScale(scale: number): void {
    const clamped = clampResolutionScale(scale);
    if (Math.abs(clamped - this.resolutionScale) < 0.001) return;
    this.resolutionScale = clamped;
    this.presetId = 'custom';
    this.applyRendererSize();
    this.callbacks.onResolutionScaleChange?.(this.resolutionScale);
    this.callbacks.onPresetChange?.(this.presetId);
  }

  public applyPreset(presetId: Exclude<PresetId, 'custom'>): void {
    const preset = BENCHMARK_PRESETS[presetId];
    if (!preset) return;
    this.presetId = preset.id;
    this.resolutionScale = preset.resolutionScale;
    this.instanceScale = preset.instanceScale;
    this.defaultStageDurationSec = preset.stageDurationSec;
    this.activeStageDurationSec = preset.stageDurationSec;

    for (const id of this.initializedStages) {
      this.stageMap.get(id)?.setInstanceScale?.(this.instanceScale);
    }
    this.applyRendererSize();
    this.callbacks.onResolutionScaleChange?.(this.resolutionScale);
    this.callbacks.onPresetChange?.(this.presetId);
    this.callbacks.onProgress?.(this.getProgress());
  }

  public getPresetId(): PresetId {
    return this.presetId;
  }

  public getInstanceScale(): number {
    return this.instanceScale;
  }

  public getSeed(): number {
    return this.seed;
  }

  public setSeed(seed: number): void {
    this.seed = (seed >>> 0) || 1;
    this.hasExplicitSeed = true;
    for (const id of this.initializedStages) {
      this.stageMap.get(id)?.setSeed?.(this.seed);
    }
  }

  public getLastResult(): BenchmarkResult | null {
    return this.lastResult;
  }

  public getProgress(): BenchmarkProgress {
    const activeStageId = this.stageOrder[this.benchmarkStageIndex] ?? this.stageOrder[0] ?? 'instanced';
    const activeStage = this.stageMap.get(activeStageId);
    const stageCount = Math.max(1, this.stageOrder.length);

    return {
      running: this.benchmarkRunning,
      stageIndex: this.benchmarkStageIndex,
      stageId: activeStageId,
      stageName: activeStage?.name ?? activeStageId,
      stageElapsedSec: this.benchmarkRunning ? Math.min(this.stageElapsedSec, this.activeStageDurationSec) : 0,
      stageDurationSec: this.activeStageDurationSec,
      totalElapsedSec: this.benchmarkRunning
        ? Math.min(this.totalElapsedSec, this.activeStageDurationSec * stageCount)
        : 0,
      totalDurationSec: this.activeStageDurationSec * stageCount,
      stabilityMode: this.stabilityMode,
      stabilityLoopIndex: this.stabilityMode ? this.stabilityLoopIndex : undefined,
      stabilityTargetSec: this.stabilityMode ? this.stabilityTargetSec : undefined,
      stabilityElapsedSec: this.stabilityMode ? this.stabilityElapsedSec : undefined,
    };
  }

  public startBenchmark(stageDurationSec?: number): void {
    this.beginRun(false, stageDurationSec);
  }

  public startStabilityTest(durationMinutes: 5 | 10): void {
    this.stabilityTargetMinutes = durationMinutes;
    this.stabilityTargetSec = durationMinutes * 60;
    this.stabilityElapsedSec = 0;
    this.stabilityLoopIndex = 1;
    this.stabilitySamples = [];
    this.beginRun(true);
  }

  private beginRun(isStability: boolean, stageDurationSec?: number): void {
    if (this.disposed || this.contextLost || this.stageOrder.length === 0) return;

    this.stabilityMode = isStability;
    this.runInvalidated = false;

    if (!this.hasExplicitSeed && !isStability) {
      this.seed = parseOrGenerateSeed(null);
    }

    this.activeStageDurationSec =
      typeof stageDurationSec === 'number' && Number.isFinite(stageDurationSec) && stageDurationSec > 0
        ? stageDurationSec
        : this.defaultStageDurationSec;

    if (this.mode !== 'benchmark') {
      this.mode = 'benchmark';
      this.callbacks.onModeChange?.(this.mode);
    }

    this.controls.enabled = false;
    this.benchmarkRunning = true;
    this.resetStageAccumulators();

    // Pre-initialize all stages up front so allocation/setup doesn't skew stage frame times
    for (const id of this.stageOrder) {
      const s = this.ensureStageInitialized(id);
      s?.setSeed?.(this.seed);
      s?.setInstanceScale?.(this.instanceScale);
    }

    this.enterBenchmarkStage(0);
    this.lastFrameTimestampMs = performance.now();
    this.callbacks.onProgress?.(this.getProgress());
  }

  private resetStageAccumulators(): void {
    this.benchmarkStageIndex = 0;
    this.stageElapsedSec = 0;
    this.totalElapsedSec = 0;
    this.rollingFrameTimesMs.length = 0;
    this.gpuTimer.resetStageStats();

    const expectedMs = this.activeStageDurationSec * 1000;
    this.stageAccumulators = this.stageOrder.map((id) => {
      const stage = this.stageMap.get(id)!;
      return ScorecardCalculator.createAccumulator(stage.id, stage.name, stage.weight, expectedMs);
    });
  }

  public stopBenchmark(): void {
    if (!this.benchmarkRunning) return;
    this.benchmarkRunning = false;
    this.stabilityMode = false;
    this.benchmarkStageIndex = 0;
    this.stageElapsedSec = 0;
    this.totalElapsedSec = 0;
    this.gpuTimer.resetStageStats();
    if (this.mode === 'benchmark') {
      this.enterBenchmarkStage(0);
    }
    this.callbacks.onProgress?.(this.getProgress());
    this.callbacks.onBenchmarkStopped?.();
  }

  public resetSandboxCamera(): void {
    let targetStage: BenchmarkStage | null = null;
    if (this.sandboxPasses.waterCaustics) {
      targetStage = this.ensureStageInitialized('water');
    } else if (this.sandboxPasses.instancedMesh) {
      targetStage = this.ensureStageInitialized('instanced');
    } else if (this.sandboxPasses.raymarchShader) {
      targetStage = this.ensureStageInitialized('raymarch');
    } else if (this.stageOrder[0]) {
      targetStage = this.ensureStageInitialized(this.stageOrder[0]);
    }

    if (targetStage) {
      this.applyCameraPreset(targetStage.getCameraPreset());
    } else {
      this.applyCameraPreset({ position: [0, 4, 14], target: [0, 0, 0], fov: 60 });
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.handleWindowResize);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.gpuTimer.dispose();
    this.controls.dispose();

    for (const stage of this.stageMap.values()) {
      if (this.initializedStages.has(stage.id)) {
        stage.dispose();
      }
    }
    this.initializedStages.clear();

    this.sandboxBloomPass?.dispose();
    this.sandboxOutputPass?.dispose();
    this.sandboxComposer?.dispose();
    this.sandboxRenderTarget?.dispose();

    for (const item of this.sandboxDisposables) {
      item.dispose();
    }
    this.sandboxDisposables.length = 0;

    this.renderer.dispose();
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;

    if (this.benchmarkRunning) {
      this.runInvalidated = true;
      const acc = this.stageAccumulators[this.benchmarkStageIndex];
      if (acc) acc.contextLost = true;
      this.benchmarkRunning = false;
      this.stabilityMode = false;
      this.callbacks.onProgress?.(this.getProgress());
      this.callbacks.onBenchmarkStopped?.();
    }

    this.callbacks.onContextLost?.(
      'WebGL2 context was lost (GPU reset or driver timeout). Active run aborted and marked invalid.',
    );
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.initializedStages.clear();
    this.applyRendererSize();
    const firstId = this.stageOrder[0];
    if (firstId) {
      const stage = this.ensureStageInitialized(firstId);
      if (stage) {
        this.applyCameraPreset(stage.getCameraPreset());
      }
    }
    this.lastFrameTimestampMs = performance.now();
    this.callbacks.onContextRestored?.();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden && this.benchmarkRunning) {
      this.runInvalidated = true;
      const acc = this.stageAccumulators[this.benchmarkStageIndex];
      if (acc) acc.tabHidden = true;
    } else if (!document.hidden) {
      this.lastFrameTimestampMs = performance.now();
    }
  };

  private detectGPUInfo(gl: WebGL2RenderingContext): WebGLGPUInfo {
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    let rendererStr = '';
    let vendorStr = '';

    if (debugExt) {
      rendererStr = String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) ?? '').trim();
      vendorStr = String(gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) ?? '').trim();
    }
    if (!rendererStr) {
      rendererStr = String(gl.getParameter(gl.RENDERER) ?? 'Unknown WebGL2 Renderer').trim();
    }
    if (!vendorStr) {
      vendorStr = String(gl.getParameter(gl.VENDOR) ?? 'Unknown Vendor').trim();
    }

    const webglVersion = String(gl.getParameter(gl.VERSION) ?? 'WebGL 2.0');
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    const isFallback = FALLBACK_GPU_PATTERN.test(rendererStr);

    return {
      renderer: rendererStr,
      vendor: vendorStr,
      webglVersion,
      maxTextureSize,
      isFallback,
      timerQueryAvailable: this.gpuTimer.isAvailable(),
    };
  }

  private ensureStageInitialized(id: StageId): BenchmarkStage | null {
    const stage = this.stageMap.get(id);
    if (!stage) return null;
    if (!this.initializedStages.has(id)) {
      stage.init(this.renderer, this.viewportWidth, this.viewportHeight);
      stage.resize(this.viewportWidth, this.viewportHeight);
      stage.setSeed?.(this.seed);
      stage.setInstanceScale?.(this.instanceScale);
      this.initializedStages.add(id);
      if (!this.benchmarkRunning) {
        this.sandboxJustInitialized = true;
        this.lastFrameTimestampMs = performance.now();
      }
    }
    return stage;
  }

  private applyCameraPreset(preset: {
    position: [number, number, number];
    target: [number, number, number];
    fov?: number;
  }): void {
    const fov = preset.fov ?? 60;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(preset.position[0], preset.position[1], preset.position[2]);
    this.controls.target.set(preset.target[0], preset.target[1], preset.target[2]);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.camera.updateMatrixWorld(true);
  }

  private setupResizeHandling(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = Math.max(1, Math.floor(entry.contentRect.width));
          const height = Math.max(1, Math.floor(entry.contentRect.height));
          if (width !== this.viewportWidth || height !== this.viewportHeight) {
            this.viewportWidth = width;
            this.viewportHeight = height;
            this.applyRendererSize();
          }
        }
      });
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('resize', this.handleWindowResize);
  }

  private readonly handleWindowResize = (): void => {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || window.innerWidth));
    const height = Math.max(1, Math.floor(rect.height || window.innerHeight));
    if (width !== this.viewportWidth || height !== this.viewportHeight) {
      this.viewportWidth = width;
      this.viewportHeight = height;
      this.applyRendererSize();
    }
  };

  private applyRendererSize(): void {
    const rawDpr = window.devicePixelRatio || 1;
    if (Math.abs(rawDpr - this.lastKnownRawDpr) > 0.01) {
      this.lastKnownRawDpr = rawDpr;
      if (this.benchmarkRunning) {
        const acc = this.stageAccumulators[this.benchmarkStageIndex];
        if (acc) acc.dprChanged = true;
      }
    }

    const baseDpr = Math.min(rawDpr, 2);
    let desiredDpr = baseDpr * this.resolutionScale;

    // Guard against exceeding WebGL MAX_TEXTURE_SIZE at extreme scales
    const maxDim = Math.max(this.viewportWidth, this.viewportHeight);
    if (maxDim * desiredDpr > this.gpuInfo.maxTextureSize) {
      desiredDpr = Math.max(0.25, (this.gpuInfo.maxTextureSize - 16) / maxDim);
    }
    this.effectivePixelRatio = Math.max(0.25, Math.min(desiredDpr, 3.0));

    this.renderer.setPixelRatio(this.effectivePixelRatio);
    this.renderer.setSize(this.viewportWidth, this.viewportHeight, false);

    this.camera.aspect = this.viewportWidth / Math.max(1, this.viewportHeight);
    this.camera.updateProjectionMatrix();

    for (const id of this.initializedStages) {
      this.stageMap.get(id)?.resize(this.viewportWidth, this.viewportHeight);
    }

    if (this.sandboxComposer) {
      this.sandboxComposer.setPixelRatio(this.effectivePixelRatio);
      this.sandboxComposer.setSize(this.viewportWidth, this.viewportHeight);
      this.sandboxBloomPass?.setSize(
        Math.max(1, Math.floor(this.viewportWidth * this.effectivePixelRatio)),
        Math.max(1, Math.floor(this.viewportHeight * this.effectivePixelRatio)),
      );
    }
  }

  private initSandboxBloomComposer(): void {
    const drawW = Math.max(1, Math.floor(this.viewportWidth * this.effectivePixelRatio));
    const drawH = Math.max(1, Math.floor(this.viewportHeight * this.effectivePixelRatio));

    this.sandboxRenderTarget = new THREE.WebGLRenderTarget(drawW, drawH, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.sandboxComposer = new EffectComposer(this.renderer, this.sandboxRenderTarget);
    this.sandboxComposer.setPixelRatio(this.effectivePixelRatio);
    this.sandboxComposer.setSize(this.viewportWidth, this.viewportHeight);

    this.sandboxBloomPass = new UnrealBloomPass(
      new THREE.Vector2(drawW, drawH),
      0.72,
      0.45,
      0.78,
    );
    this.sandboxOutputPass = new OutputPass();

    this.sandboxComposer.addPass(this.sandboxBloomPass);
    this.sandboxComposer.addPass(this.sandboxOutputPass);
  }

  private buildSandboxLightsRig(): void {
    this.sandboxLightsScene.background = null;
    this.sandboxLightsScene.add(this.sandboxAmbientLight);

    const orbColors = [0x38bdf8, 0xf5b841, 0xff5d47, 0x34d399];
    const orbGeo = new THREE.SphereGeometry(0.32, 20, 20);
    this.sandboxDisposables.push(orbGeo);

    for (let i = 0; i < orbColors.length; i++) {
      const hex = orbColors[i]!;
      const light = new THREE.PointLight(hex, 42, 48, 1.4);
      const color = new THREE.Color(hex).multiplyScalar(2.4);
      const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const mesh = new THREE.Mesh(orbGeo, mat);
      this.sandboxDisposables.push(mat);

      this.sandboxLightsScene.add(light);
      this.sandboxLightsScene.add(mesh);
      this.sandboxOrbs.push({
        light,
        mesh,
        radius: 6.5 + (i % 2) * 3.0,
        speed: 0.75 + i * 0.22,
        phase: (i * Math.PI) / 2,
        yOffset: i % 2 === 0 ? 1.8 : -0.6,
      });
    }

    const coreGeo = new THREE.IcosahedronGeometry(2.1, 2);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.88,
      roughness: 0.18,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const ringGeo = new THREE.TorusGeometry(3.6, 0.14, 24, 96);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.92,
      roughness: 0.14,
      emissive: new THREE.Color(0x0ea5e9),
      emissiveIntensity: 0.35,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI * 0.36;

    this.sandboxDisposables.push(coreGeo, coreMat, ringGeo, ringMat);
    this.sandboxFallbackGroup.add(coreMesh, ringMesh);
    this.sandboxLightsScene.add(this.sandboxFallbackGroup);
  }

  private enterBenchmarkStage(index: number): void {
    const id = this.stageOrder[index];
    if (!id) return;
    const stage = this.ensureStageInitialized(id);
    if (!stage) return;

    this.gpuTimer.resetStageStats();
    stage.setBackgroundMode?.(false);
    stage.setOverlayMode?.(false);
    stage.setLightsEnabled?.(true);
    this.applyCameraPreset(stage.getCameraPreset());
    this.callbacks.onStageTransition?.(index, stage.id, stage.name);
  }

  private syncSandboxStageSettings(): void {
    if (this.sandboxPasses.raymarchShader) {
      const raymarch = this.ensureStageInitialized('raymarch');
      const hasForeground3D =
        this.sandboxPasses.instancedMesh || this.sandboxPasses.waterCaustics;
      raymarch?.setBackgroundMode?.(hasForeground3D);
      raymarch?.setLightsEnabled?.(this.sandboxPasses.dynamicLights);
    }

    if (this.sandboxPasses.waterCaustics) {
      const water = this.ensureStageInitialized('water');
      water?.setOverlayMode?.(this.sandboxPasses.raymarchShader);
      water?.setLightsEnabled?.(this.sandboxPasses.dynamicLights);
    }

    if (this.sandboxPasses.instancedMesh) {
      const instanced = this.ensureStageInitialized('instanced');
      const hasBackdrop =
        this.sandboxPasses.raymarchShader || this.sandboxPasses.waterCaustics;
      instanced?.setOverlayMode?.(hasBackdrop);
      instanced?.setLightsEnabled?.(this.sandboxPasses.dynamicLights);
    }
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (nowMs: number): void => {
    if (this.disposed) return;
    if (this.contextLost) {
      this.scheduleNextFrame();
      return;
    }

    // Detect mid-run DPR changes without layout thrash
    const rawDpr = window.devicePixelRatio || 1;
    if (Math.abs(rawDpr - this.lastKnownRawDpr) > 0.01) {
      this.applyRendererSize();
    }

    const rawFrameTimeMs = Math.max(0.1, nowMs - this.lastFrameTimestampMs);
    this.lastFrameTimestampMs = nowMs;
    const deltaSec = Math.min(rawFrameTimeMs / 1000, 0.25);

    // Non-stalling poll of previous GPU timer queries
    this.gpuTimer.poll();

    // CRITICAL: reset renderer.info once at frame start so multi-pass stages accumulate cleanly
    this.renderer.info.reset();

    this.gpuTimer.beginFrame();
    if (this.benchmarkRunning) {
      this.tickBenchmarkFrame(rawFrameTimeMs, deltaSec);
    } else if (this.mode === 'sandbox') {
      this.tickSandboxFrame(deltaSec);
    } else {
      this.tickIdleBenchmarkPreview(deltaSec);
    }
    this.gpuTimer.endFrame();

    const drawCalls = this.renderer.info.render.calls;
    const triangles = this.renderer.info.render.triangles;

    this.recordTelemetry(rawFrameTimeMs, drawCalls, triangles);
    this.scheduleNextFrame();
  };

  private tickBenchmarkFrame(rawFrameTimeMs: number, deltaSec: number): void {
    const activeId = this.stageOrder[this.benchmarkStageIndex];
    const stage = activeId ? this.stageMap.get(activeId) : undefined;

    if (!stage) {
      this.finishBenchmarkRun();
      return;
    }

    this.stageElapsedSec += rawFrameTimeMs / 1000;
    this.totalElapsedSec += rawFrameTimeMs / 1000;
    if (this.stabilityMode) {
      this.stabilityElapsedSec += rawFrameTimeMs / 1000;
    }

    this.renderer.autoClear = true;
    stage.update(this.stageElapsedSec, deltaSec, this.camera, false);
    this.camera.updateMatrixWorld();
    stage.render(this.renderer, this.camera, null);

    const acc = this.stageAccumulators[this.benchmarkStageIndex];
    if (acc) {
      if (document.hidden) {
        acc.tabHidden = true;
      }
      ScorecardCalculator.recordSample(
        acc,
        rawFrameTimeMs,
        this.renderer.info.render.calls,
        this.renderer.info.render.triangles,
      );
    }

    this.callbacks.onProgress?.(this.getProgress());

    if (this.stageElapsedSec >= this.activeStageDurationSec) {
      if (acc) {
        const summary = acc.collector.summarize();
        acc.gpuStats = this.gpuTimer.summarizeStage(summary.medianFrameTimeMs);
      }

      const nextIndex = this.benchmarkStageIndex + 1;
      if (nextIndex < this.stageOrder.length) {
        this.benchmarkStageIndex = nextIndex;
        this.stageElapsedSec = 0;
        this.enterBenchmarkStage(nextIndex);
        this.lastFrameTimestampMs = performance.now();
        this.callbacks.onProgress?.(this.getProgress());
      } else {
        this.finishBenchmarkRun();
      }
    }
  }

  private finishBenchmarkRun(): void {
    const totalRunDurationSec = this.activeStageDurationSec * this.stageOrder.length;
    const result = ScorecardCalculator.buildResult(
      this.stageAccumulators,
      totalRunDurationSec,
      this.resolutionScale,
      this.gpuInfo,
      {
        seed: this.seed,
        presetId: this.presetId,
        instanceScale: this.instanceScale,
        invalidated: this.runInvalidated,
      },
    );
    this.lastResult = result;

    if (this.stabilityMode) {
      this.stabilitySamples.push({
        loopIndex: this.stabilityLoopIndex,
        elapsedSec: Math.round(this.stabilityElapsedSec * 10) / 10,
        compositeScore: result.compositeScore,
        medianFps: result.overallMedianFps,
        confidence: result.confidence,
      });

      if (this.stabilityElapsedSec < this.stabilityTargetSec) {
        this.stabilityLoopIndex += 1;
        this.resetStageAccumulators();
        this.enterBenchmarkStage(0);
        this.lastFrameTimestampMs = performance.now();
        this.callbacks.onProgress?.(this.getProgress());
        return;
      }

      const report = this.buildStabilityReport();
      this.stabilityMode = false;
      this.benchmarkRunning = false;
      this.benchmarkStageIndex = 0;
      this.stageElapsedSec = 0;
      this.totalElapsedSec = 0;
      this.enterBenchmarkStage(0);
      this.callbacks.onProgress?.(this.getProgress());
      this.callbacks.onStabilityComplete?.(report);
      return;
    }

    this.benchmarkRunning = false;
    this.benchmarkStageIndex = 0;
    this.stageElapsedSec = 0;
    this.totalElapsedSec = 0;
    this.enterBenchmarkStage(0);
    this.callbacks.onProgress?.(this.getProgress());
    this.callbacks.onBenchmarkComplete?.(result);
  }

  private buildStabilityReport(): StabilityReport {
    const samples = [...this.stabilitySamples];
    const peakScore = samples.reduce((m, s) => Math.max(m, s.compositeScore), 0);
    const lastScore = samples[samples.length - 1]?.compositeScore ?? 0;
    const tailCount = Math.max(1, Math.ceil(samples.length / 3));
    const tailSlice = samples.slice(samples.length - tailCount);
    const sustainedScore = Math.round(
      tailSlice.reduce((sum, s) => sum + s.compositeScore, 0) / tailSlice.length,
    );
    const sustainedRatio = peakScore > 0 ? Math.round((sustainedScore / peakScore) * 1000) / 1000 : 1;
    const throttled = sustainedRatio < 0.88;
    const verdict = throttled
      ? `Thermal/power throttling detected (${Math.round((1 - sustainedRatio) * 100)}% drop from peak ${peakScore} to sustained ${sustainedScore}).`
      : `Thermally stable (${Math.round(sustainedRatio * 100)}% sustained vs peak; final loop ${lastScore}).`;

    return {
      id: `stab-${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      targetDurationMin: this.stabilityTargetMinutes,
      actualDurationSec: Math.round(this.stabilityElapsedSec * 10) / 10,
      loopsCompleted: samples.length,
      peakScore,
      sustainedScore,
      sustainedRatio,
      throttled,
      verdict,
      samples,
    };
  }

  private tickIdleBenchmarkPreview(deltaSec: number): void {
    this.previewElapsedSec += deltaSec;
    const stageId = this.stageOrder[0];
    const stage = stageId ? this.ensureStageInitialized(stageId) : null;
    if (!stage) {
      this.clearTarget(null);
      return;
    }

    this.renderer.autoClear = true;
    stage.setBackgroundMode?.(false);
    stage.setOverlayMode?.(false);
    stage.setLightsEnabled?.(true);
    stage.update(this.previewElapsedSec, deltaSec, this.camera, false);
    this.camera.updateMatrixWorld();
    stage.render(this.renderer, this.camera, null);
  }

  private tickSandboxFrame(deltaSec: number): void {
    this.sandboxElapsedSec += deltaSec;
    this.controls.update();
    this.camera.updateMatrixWorld();

    const { instancedMesh, raymarchShader, waterCaustics, dynamicLights, unrealBloom } =
      this.sandboxPasses;

    const useBloom = unrealBloom && this.sandboxComposer !== null;
    const renderTarget: THREE.WebGLRenderTarget | null = useBloom
      ? this.sandboxComposer!.readBuffer
      : null;

    const hasAnyPass =
      instancedMesh || raymarchShader || waterCaustics || dynamicLights;

    if (!hasAnyPass) {
      this.clearTarget(renderTarget);
      if (useBloom) {
        this.sandboxComposer!.render(deltaSec);
      }
      return;
    }

    this.syncSandboxStageSettings();

    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.clearTarget(renderTarget);

    let hasRenderedColorLayer = false;

    if (raymarchShader) {
      const raymarchStage = this.ensureStageInitialized('raymarch');
      if (raymarchStage) {
        raymarchStage.update(this.sandboxElapsedSec, deltaSec, this.camera, true);
        raymarchStage.render(this.renderer, this.camera, renderTarget);
        this.renderer.setRenderTarget(renderTarget);
        this.renderer.clearDepth();
        hasRenderedColorLayer = true;
      }
    }

    if (waterCaustics) {
      const waterStage = this.ensureStageInitialized('water');
      if (waterStage) {
        waterStage.update(this.sandboxElapsedSec, deltaSec, this.camera, true);
        waterStage.render(this.renderer, this.camera, renderTarget);
        hasRenderedColorLayer = true;
      }
    }

    if (instancedMesh) {
      const instancedStage = this.ensureStageInitialized('instanced');
      if (instancedStage) {
        instancedStage.update(this.sandboxElapsedSec, deltaSec, this.camera, true);
        instancedStage.render(this.renderer, this.camera, renderTarget);
        hasRenderedColorLayer = true;
      }
    }

    if (dynamicLights) {
      this.updateSandboxLightsRig(
        this.sandboxElapsedSec,
        !instancedMesh && !waterCaustics && !raymarchShader,
      );
      if (!hasRenderedColorLayer) {
        this.clearTarget(renderTarget);
      } else {
        this.renderer.setRenderTarget(renderTarget);
      }
      this.renderer.render(this.sandboxLightsScene, this.camera);
    }

    this.renderer.autoClear = prevAutoClear;

    if (useBloom) {
      this.sandboxComposer!.render(deltaSec);
    } else {
      this.renderer.setRenderTarget(null);
    }

    if (this.sandboxJustInitialized) {
      this.sandboxJustInitialized = false;
      this.lastFrameTimestampMs = performance.now();
    }
  }

  private updateSandboxLightsRig(elapsedSec: number, showFallbackMesh: boolean): void {
    this.sandboxFallbackGroup.visible = showFallbackMesh;
    if (showFallbackMesh) {
      this.sandboxFallbackGroup.rotation.y = elapsedSec * 0.35;
      this.sandboxFallbackGroup.rotation.x = Math.sin(elapsedSec * 0.5) * 0.12;
    }

    for (const orb of this.sandboxOrbs) {
      const angle = elapsedSec * orb.speed + orb.phase;
      const x = Math.cos(angle) * orb.radius;
      const z = Math.sin(angle) * orb.radius;
      const y = orb.yOffset + Math.sin(elapsedSec * 1.4 + orb.phase) * 1.6;
      orb.light.position.set(x, y, z);
      orb.mesh.position.set(x, y, z);
    }
  }

  private clearTarget(target: THREE.WebGLRenderTarget | null): void {
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x06080d, 1);
    this.renderer.clear(true, true, true);
  }

  private recordTelemetry(
    rawFrameTimeMs: number,
    drawCalls: number,
    triangles: number,
  ): void {
    this.rollingFrameTimesMs.push(rawFrameTimeMs);
    if (this.rollingFrameTimesMs.length > TELEMETRY_WINDOW_SIZE) {
      this.rollingFrameTimesMs.shift();
    }

    this.smoothedFrameTimeMs =
      this.smoothedFrameTimeMs * 0.85 + Math.min(rawFrameTimeMs, 2000) * 0.15;

    const fps = this.smoothedFrameTimeMs > 0 ? 1000 / this.smoothedFrameTimeMs : 0;
    const onePercentLowFps = ScorecardCalculator.computeOnePercentLowFps(
      this.rollingFrameTimesMs,
    );

    const snapshot: TelemetrySnapshot = {
      fps: Math.round(fps * 10) / 10,
      frameTimeMs: Math.round(rawFrameTimeMs * 100) / 100,
      onePercentLowFps: Math.round(onePercentLowFps * 10) / 10,
      gpuTimeMs: this.gpuTimer.getLastGpuTimeMs(),
      drawCalls,
      triangles,
      resolutionWidth: this.renderer.domElement.width,
      resolutionHeight: this.renderer.domElement.height,
      pixelRatio: Math.round(this.effectivePixelRatio * 100) / 100,
      resolutionScale: this.resolutionScale,
    };

    this.callbacks.onTelemetry?.(snapshot);
  }
}

function clampResolutionScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1.0;
  return Math.round(Math.min(2.0, Math.max(0.5, scale)) * 100) / 100;
}
