import '../styles/main.css';
import { RunHistoryStorage } from '../storage/RunHistoryStorage.ts';
import type {
  BenchmarkMode,
  BenchmarkProgress,
  BenchmarkResult,
  EngineController,
  PresetId,
  SandboxPasses,
  StabilityReport,
  StageId,
  TelemetrySnapshot,
  UICallbacks,
  WebGLGPUInfo,
} from '../types.ts';
import { ControlPanel } from './ControlPanel.ts';
import { HistoryCompareModal } from './HistoryCompareModal.ts';
import { ScorecardModal } from './ScorecardModal.ts';
import { TelemetryHUD } from './TelemetryHUD.ts';
import { formatFps, formatMs, getFpsSeverityColor } from './format.ts';

/**
 * Root UI orchestrator mounted inside `#app` over the full-viewport WebGL2 canvas.
 * Coordinates Live Telemetry HUD, Benchmark/Sandbox ControlPanel, Minimal HUD mode (`H`),
 * stage transition wipes, software-rasterizer & context-loss banners, and Scorecard modal.
 */
export class BenchmarkUI {
  private readonly root: HTMLElement;
  private readonly controller: EngineController;
  private readonly overlayEl: HTMLElement;
  private readonly topActionsEl: HTMLElement;
  private readonly hudToggleBtn: HTMLButtonElement;
  private readonly topHistoryBtn: HTMLButtonElement;
  private readonly topScorecardBtn: HTMLButtonElement;
  private readonly minimalPillEl: HTMLElement;
  private readonly minimalDotEl: HTMLElement;
  private readonly minimalFpsEl: HTMLElement;
  private readonly minimalStageEl: HTMLElement;
  private readonly restoreHudBtn: HTMLButtonElement;
  private readonly errorBannerEl: HTMLElement;
  private readonly fallbackBannerEl: HTMLElement;
  private readonly stageWipeEl: HTMLElement;

  private readonly telemetryHUD: TelemetryHUD;
  private readonly controlPanel: ControlPanel;
  private readonly scorecardModal: ScorecardModal;
  private readonly historyModal: HistoryCompareModal;
  private readonly callbacks: UICallbacks;

  private minimalHud = false;
  private lastMinimalText = '';
  private lastMinimalColor = '';
  private wipeTimer: number | null = null;
  private disposed = false;

  constructor(root: HTMLElement, controller: EngineController) {
    this.root = root;
    this.controller = controller;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'am-overlay';
    this.overlayEl.setAttribute('data-ui', '');

    // Top-right HUD utility strip
    this.topActionsEl = document.createElement('div');
    this.topActionsEl.className = 'am-top-actions';

    this.topScorecardBtn = document.createElement('button');
    this.topScorecardBtn.type = 'button';
    this.topScorecardBtn.className = 'am-pill-btn';
    this.topScorecardBtn.setAttribute('data-testid', 'reopen-scorecard-btn');
    this.topScorecardBtn.textContent = 'Scorecard';
    this.topScorecardBtn.hidden = true;
    this.topScorecardBtn.addEventListener('click', () => {
      this.openLastScorecard();
    });

    this.topHistoryBtn = document.createElement('button');
    this.topHistoryBtn.type = 'button';
    this.topHistoryBtn.className = 'am-pill-btn';
    this.topHistoryBtn.setAttribute('data-testid', 'open-history-btn');
    this.topHistoryBtn.textContent = 'History';
    this.topHistoryBtn.addEventListener('click', () => {
      this.historyModal.openHistory();
    });

    this.hudToggleBtn = document.createElement('button');
    this.hudToggleBtn.type = 'button';
    this.hudToggleBtn.className = 'am-pill-btn';
    this.hudToggleBtn.setAttribute('data-testid', 'minimal-hud-toggle');
    this.hudToggleBtn.setAttribute('aria-pressed', 'false');
    this.hudToggleBtn.innerHTML = '<span>Minimal HUD</span><kbd class="am-kbd">H</kbd>';
    this.hudToggleBtn.addEventListener('click', () => {
      this.setMinimalHud(true);
    });

    this.topActionsEl.append(this.topScorecardBtn, this.topHistoryBtn, this.hudToggleBtn);

    // Unobtrusive Minimal HUD corner pill
    this.minimalPillEl = document.createElement('div');
    this.minimalPillEl.className = 'am-minimal-pill';
    this.minimalPillEl.setAttribute('data-testid', 'minimal-hud-pill');
    this.minimalPillEl.hidden = true;

    this.minimalDotEl = document.createElement('span');
    this.minimalDotEl.className = 'am-status-dot';

    this.minimalFpsEl = document.createElement('span');
    this.minimalFpsEl.className = 'am-minimal-fps num';
    this.minimalFpsEl.textContent = '- fps';

    this.minimalStageEl = document.createElement('span');
    this.minimalStageEl.className = 'am-minimal-stage num';
    this.minimalStageEl.hidden = true;

    this.restoreHudBtn = document.createElement('button');
    this.restoreHudBtn.type = 'button';
    this.restoreHudBtn.className = 'am-minimal-restore';
    this.restoreHudBtn.setAttribute('data-testid', 'restore-hud-btn');
    this.restoreHudBtn.innerHTML = '<span>Restore HUD</span><kbd class="am-kbd">H</kbd>';
    this.restoreHudBtn.addEventListener('click', () => {
      this.setMinimalHud(false);
    });

    this.minimalPillEl.append(
      this.minimalDotEl,
      this.minimalFpsEl,
      this.minimalStageEl,
      this.restoreHudBtn,
    );

    // Software rasterizer warning banner
    this.fallbackBannerEl = document.createElement('div');
    this.fallbackBannerEl.className = 'am-warning-banner';
    this.fallbackBannerEl.setAttribute('role', 'status');
    this.fallbackBannerEl.setAttribute('data-testid', 'software-rasterizer-banner');
    this.fallbackBannerEl.hidden = true;

    // Error / context-loss banner
    this.errorBannerEl = document.createElement('div');
    this.errorBannerEl.className = 'am-error-banner';
    this.errorBannerEl.setAttribute('role', 'alert');
    this.errorBannerEl.hidden = true;

    // Stage transition wipe overlay
    this.stageWipeEl = document.createElement('div');
    this.stageWipeEl.className = 'am-stage-wipe';
    this.stageWipeEl.setAttribute('aria-hidden', 'true');
    this.stageWipeEl.hidden = true;

    // Telemetry dock (top-left)
    this.telemetryHUD = new TelemetryHUD(this.overlayEl);

    // Controls dock (top-right)
    const rightColumn = document.createElement('div');
    rightColumn.className = 'am-right-column';
    rightColumn.appendChild(this.topActionsEl);

    this.controlPanel = new ControlPanel(rightColumn, this.controller, () => {
      this.openLastScorecard();
    });

    this.overlayEl.append(
      rightColumn,
      this.minimalPillEl,
      this.fallbackBannerEl,
      this.errorBannerEl,
      this.stageWipeEl,
    );

    this.scorecardModal = new ScorecardModal(this.overlayEl, {
      onRunAgain: () => {
        this.controller.startBenchmark();
      },
    });
    this.historyModal = new HistoryCompareModal(this.overlayEl);

    this.root.appendChild(this.overlayEl);

    this.callbacks = {
      onTelemetry: (snapshot) => this.handleTelemetry(snapshot),
      onProgress: (progress) => this.handleProgress(progress),
      onStageTransition: (idx, id, name) => this.handleStageTransition(idx, id, name),
      onBenchmarkComplete: (result) => this.handleBenchmarkComplete(result),
      onBenchmarkStopped: () => this.handleBenchmarkStopped(),
      onStabilityComplete: (report) => this.handleStabilityComplete(report),
      onModeChange: (mode) => this.handleModeChange(mode),
      onSandboxPassesChange: (passes) => this.handleSandboxPassesChange(passes),
      onResolutionScaleChange: (scale) => this.handleResolutionScaleChange(scale),
      onPresetChange: (presetId) => this.handlePresetChange(presetId),
      onGPUInfo: (info) => this.handleGPUInfo(info),
      onContextLost: (msg) => this.handleContextLost(msg),
      onContextRestored: () => this.handleContextRestored(),
      onError: (msg) => this.handleError(msg),
    };

    this.controller.setUICallbacks(this.callbacks);
    this.syncInitialState();
    window.addEventListener('keydown', this.handleKeyDown);
  }

  public getCallbacks(): UICallbacks {
    return this.callbacks;
  }

  public isMinimalHud(): boolean {
    return this.minimalHud;
  }

  public setMinimalHud(enabled: boolean): void {
    this.minimalHud = enabled;
    this.telemetryHUD.element.hidden = enabled;
    this.controlPanel.element.hidden = enabled;
    this.topActionsEl.hidden = enabled;
    this.minimalPillEl.hidden = !enabled;
    this.hudToggleBtn.setAttribute('aria-pressed', String(enabled));

    if (!enabled) {
      this.telemetryHUD.redrawChart();
    }
  }

  public toggleMinimalHud(): void {
    this.setMinimalHud(!this.minimalHud);
  }

  public openLastScorecard(): void {
    const result = this.controller.getLastResult();
    if (result) {
      this.scorecardModal.open(result);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.wipeTimer !== null) {
      window.clearTimeout(this.wipeTimer);
      this.wipeTimer = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    this.telemetryHUD.dispose();
    this.controlPanel.dispose();
    this.scorecardModal.dispose();
    this.historyModal.dispose();
    this.overlayEl.remove();
  }

  private syncInitialState(): void {
    const gpu = this.controller.getGPUInfo();
    this.handleGPUInfo(gpu);
    this.controlPanel.setMode(this.controller.getMode());
    this.controlPanel.setSandboxPasses(this.controller.getSandboxPasses());
    this.controlPanel.setResolutionScale(this.controller.getResolutionScale());
    this.controlPanel.setPreset(this.controller.getPresetId());
    this.controlPanel.updateProgress(this.controller.getProgress());

    const lastResult = this.controller.getLastResult();
    this.syncScorecardAvailability(lastResult !== null);
  }

  private syncScorecardAvailability(hasResult: boolean): void {
    this.topScorecardBtn.hidden = !hasResult;
    this.controlPanel.setHasLastResult(hasResult);
  }

  private handleGPUInfo(info: WebGLGPUInfo): void {
    this.telemetryHUD.setGPUInfo(info);
    if (info.isFallback) {
      this.fallbackBannerEl.textContent =
        'Software rasterizer detected (SwiftShader / llvmpipe). Workload auto-capped; scores reflect CPU emulation, not hardware GPU.';
      this.fallbackBannerEl.hidden = false;
    } else {
      this.fallbackBannerEl.hidden = true;
    }
  }

  private handleTelemetry(snapshot: TelemetrySnapshot): void {
    if (this.disposed) return;

    this.telemetryHUD.updateTelemetry(snapshot, !this.minimalHud);

    if (!this.minimalHud) {
      this.controlPanel.updateEffectiveResolution(
        snapshot.resolutionWidth,
        snapshot.resolutionHeight,
      );
    } else {
      const minimalText = `${formatFps(snapshot.fps)} fps · ${formatMs(snapshot.frameTimeMs)} ms`;
      if (minimalText !== this.lastMinimalText) {
        this.lastMinimalText = minimalText;
        this.minimalFpsEl.textContent = minimalText;
      }
      const color = getFpsSeverityColor(snapshot.fps);
      if (color !== this.lastMinimalColor) {
        this.lastMinimalColor = color;
        this.minimalDotEl.style.backgroundColor = color;
      }
    }
  }

  private handleProgress(progress: BenchmarkProgress): void {
    if (this.disposed) return;
    this.controlPanel.updateProgress(progress);

    if (progress.running) {
      const totalStages = Math.max(1, this.controller.getStageDescriptors().length);
      const left = Math.max(0, progress.totalDurationSec - progress.totalElapsedSec);
      this.minimalStageEl.hidden = false;
      this.minimalStageEl.textContent = progress.stabilityMode
        ? `LOOP ${progress.stabilityLoopIndex ?? 1} · S${progress.stageIndex + 1}/${totalStages}`
        : `S${progress.stageIndex + 1}/${totalStages} · ${left.toFixed(0)}s`;
    } else {
      this.minimalStageEl.hidden = true;
    }
  }

  private handleStageTransition(index: number, _id: StageId, name: string): void {
    if (this.disposed || !this.controller.getProgress().running) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    if (this.wipeTimer !== null) {
      window.clearTimeout(this.wipeTimer);
    }
    this.stageWipeEl.innerHTML = `<span class="am-wipe-tag">STAGE 0${index + 1}</span><span class="am-wipe-name">${name}</span>`;
    this.stageWipeEl.hidden = false;
    this.stageWipeEl.classList.remove('am-wipe-active');
    void this.stageWipeEl.offsetWidth;
    this.stageWipeEl.classList.add('am-wipe-active');

    this.wipeTimer = window.setTimeout(() => {
      this.stageWipeEl.hidden = true;
      this.stageWipeEl.classList.remove('am-wipe-active');
      this.wipeTimer = null;
    }, 1150);
  }

  private handleBenchmarkComplete(result: BenchmarkResult): void {
    if (this.disposed) return;
    RunHistoryStorage.saveRun(result);
    this.syncScorecardAvailability(true);
    this.scorecardModal.open(result);
  }

  private handleBenchmarkStopped(): void {
    if (this.disposed) return;
    this.controlPanel.updateProgress(this.controller.getProgress());
  }

  private handleStabilityComplete(report: StabilityReport): void {
    if (this.disposed) return;
    this.historyModal.openStabilityReport(report);
  }

  private handleModeChange(mode: BenchmarkMode): void {
    if (this.disposed) return;
    this.controlPanel.setMode(mode);
  }

  private handleSandboxPassesChange(passes: SandboxPasses): void {
    if (this.disposed) return;
    this.controlPanel.setSandboxPasses(passes);
  }

  private handleResolutionScaleChange(scale: number): void {
    if (this.disposed) return;
    this.controlPanel.setResolutionScale(scale);
  }

  private handlePresetChange(presetId: PresetId): void {
    if (this.disposed) return;
    this.controlPanel.setPreset(presetId);
  }

  private handleContextLost(message: string): void {
    this.errorBannerEl.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    this.errorBannerEl.appendChild(text);
    this.errorBannerEl.hidden = false;
  }

  private handleContextRestored(): void {
    this.errorBannerEl.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = 'WebGL2 context restored. Previous run invalidated — ready to retry.';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'am-btn am-btn-secondary';
    retryBtn.textContent = 'Retry Run';
    retryBtn.style.marginLeft = '12px';
    retryBtn.addEventListener('click', () => {
      this.errorBannerEl.hidden = true;
      this.controller.startBenchmark();
    });
    this.errorBannerEl.append(text, retryBtn);
    this.errorBannerEl.hidden = false;
  }

  private handleError(message: string): void {
    this.errorBannerEl.textContent = message;
    this.errorBannerEl.hidden = false;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      if (event.key === 'Escape' && this.scorecardModal.isOpen()) {
        this.scorecardModal.close();
      }
      return;
    }

    if (event.key === 'Escape' && this.scorecardModal.isOpen()) {
      event.preventDefault();
      this.scorecardModal.close();
      return;
    }

    if ((event.key === 'h' || event.key === 'H') && !this.scorecardModal.isOpen()) {
      event.preventDefault();
      this.toggleMinimalHud();
    }
  };
}
