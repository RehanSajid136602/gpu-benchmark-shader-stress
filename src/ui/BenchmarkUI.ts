import '../styles/main.css';
import type {
  BenchmarkMode,
  BenchmarkProgress,
  BenchmarkResult,
  EngineController,
  SandboxPasses,
  TelemetrySnapshot,
  UICallbacks,
  WebGLGPUInfo,
} from '../types.ts';
import { ControlPanel } from './ControlPanel.ts';
import { ScorecardModal } from './ScorecardModal.ts';
import { TelemetryHUD } from './TelemetryHUD.ts';
import { formatFps, formatMs, getFpsSeverityColor } from './format.ts';

export interface BenchmarkUIOptions {
  root: HTMLElement;
  controller: EngineController;
}

/**
 * Root UI orchestrator mounted inside `#app` over the full-viewport WebGL2 canvas.
 * Coordinates Live Telemetry HUD, Benchmark/Sandbox ControlPanel, Minimal HUD mode (`H`),
 * error banner reporting, and the Results Scorecard modal & export tools.
 */
export class BenchmarkUI {
  private readonly root: HTMLElement;
  private readonly controller: EngineController;
  private readonly overlayEl: HTMLElement;
  private readonly topActionsEl: HTMLElement;
  private readonly hudToggleBtn: HTMLButtonElement;
  private readonly topScorecardBtn: HTMLButtonElement;
  private readonly minimalPillEl: HTMLElement;
  private readonly minimalDotEl: HTMLElement;
  private readonly minimalFpsEl: HTMLElement;
  private readonly minimalStageEl: HTMLElement;
  private readonly restoreHudBtn: HTMLButtonElement;
  private readonly errorBannerEl: HTMLElement;

  private readonly telemetryHUD: TelemetryHUD;
  private readonly controlPanel: ControlPanel;
  private readonly scorecardModal: ScorecardModal;
  private readonly callbacks: UICallbacks;

  private minimalHud = false;
  private lastMinimalText = '';
  private lastMinimalColor = '';
  private disposed = false;

  constructor(rootOrOptions: HTMLElement | BenchmarkUIOptions, controller?: EngineController) {
    if (rootOrOptions instanceof HTMLElement) {
      if (!controller) {
        throw new Error('BenchmarkUI requires an EngineController instance.');
      }
      this.root = rootOrOptions;
      this.controller = controller;
    } else {
      this.root = rootOrOptions.root;
      this.controller = rootOrOptions.controller;
    }

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'am-overlay';
    this.overlayEl.setAttribute('data-ui', '');

    // Top-right HUD utility strip (Scorecard reopen + Hide HUD)
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

    this.hudToggleBtn = document.createElement('button');
    this.hudToggleBtn.type = 'button';
    this.hudToggleBtn.className = 'am-pill-btn';
    this.hudToggleBtn.setAttribute('data-testid', 'minimal-hud-toggle');
    this.hudToggleBtn.setAttribute('aria-pressed', 'false');
    this.hudToggleBtn.innerHTML = '<span>Minimal HUD</span><kbd class="am-kbd">H</kbd>';
    this.hudToggleBtn.addEventListener('click', () => {
      this.setMinimalHud(true);
    });

    this.topActionsEl.append(this.topScorecardBtn, this.hudToggleBtn);

    // Unobtrusive Minimal HUD corner pill (visible only when minimalHud === true)
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

    // Error banner (hidden unless WebGL / engine error occurs)
    this.errorBannerEl = document.createElement('div');
    this.errorBannerEl.className = 'am-error-banner';
    this.errorBannerEl.setAttribute('role', 'alert');
    this.errorBannerEl.hidden = true;

    // Telemetry dock (top-left)
    this.telemetryHUD = new TelemetryHUD(this.overlayEl);

    // Controls dock (top-right, below topActions)
    const rightColumn = document.createElement('div');
    rightColumn.className = 'am-right-column';
    rightColumn.appendChild(this.topActionsEl);

    this.controlPanel = new ControlPanel(rightColumn, this.controller, () => {
      this.openLastScorecard();
    });

    this.overlayEl.append(rightColumn, this.minimalPillEl, this.errorBannerEl);

    // Scorecard modal
    this.scorecardModal = new ScorecardModal(this.overlayEl, {
      onRunAgain: () => {
        this.controller.startBenchmark();
      },
    });

    this.root.appendChild(this.overlayEl);

    this.callbacks = {
      onTelemetry: (snapshot) => this.handleTelemetry(snapshot),
      onProgress: (progress) => this.handleProgress(progress),
      onBenchmarkComplete: (result) => this.handleBenchmarkComplete(result),
      onBenchmarkStopped: () => this.handleBenchmarkStopped(),
      onModeChange: (mode) => this.handleModeChange(mode),
      onSandboxPassesChange: (passes) => this.handleSandboxPassesChange(passes),
      onResolutionScaleChange: (scale) => this.handleResolutionScaleChange(scale),
      onGPUInfo: (info) => this.handleGPUInfo(info),
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
    window.removeEventListener('keydown', this.handleKeyDown);
    this.telemetryHUD.dispose();
    this.controlPanel.dispose();
    this.scorecardModal.dispose();
    this.overlayEl.remove();
  }

  private syncInitialState(): void {
    this.telemetryHUD.setGPUInfo(this.controller.getGPUInfo());
    this.controlPanel.setMode(this.controller.getMode());
    this.controlPanel.setSandboxPasses(this.controller.getSandboxPasses());
    this.controlPanel.setResolutionScale(this.controller.getResolutionScale());
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
      const left = Math.max(0, progress.totalDurationSec - progress.totalElapsedSec);
      this.minimalStageEl.hidden = false;
      this.minimalStageEl.textContent = `S${progress.stageIndex + 1}/4 · ${left.toFixed(0)}s`;
    } else {
      this.minimalStageEl.hidden = true;
    }
  }

  private handleBenchmarkComplete(result: BenchmarkResult): void {
    if (this.disposed) return;
    this.syncScorecardAvailability(true);
    this.scorecardModal.open(result);
  }

  private handleBenchmarkStopped(): void {
    if (this.disposed) return;
    this.controlPanel.updateProgress(this.controller.getProgress());
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
