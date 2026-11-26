import type {
  BenchmarkMode,
  BenchmarkProgress,
  EngineController,
  SandboxPasses,
  StageDescriptor,
  StageId,
} from '../types.ts';
import { formatDurationSec, formatResolution } from './format.ts';

interface PassConfig {
  key: keyof SandboxPasses;
  label: string;
  detail: string;
}

const SANDBOX_PASS_CONFIGS: readonly PassConfig[] = [
  {
    key: 'instancedMesh',
    label: 'Instanced 500k Mesh',
    detail: 'Hardware vertex instancing',
  },
  {
    key: 'raymarchShader',
    label: 'Raymarched Fractal Shader',
    detail: 'Fragment SDF raymarching',
  },
  {
    key: 'waterCaustics',
    label: 'Water Refraction & Caustics',
    detail: 'Multi-pass FBO reflections',
  },
  {
    key: 'dynamicLights',
    label: 'Dynamic Lights',
    detail: 'Orbiting multi-point rig',
  },
  {
    key: 'unrealBloom',
    label: 'UnrealBloom Post-FX',
    detail: 'Half-float HDR bloom pass',
  },
];

interface StageRowElements {
  row: HTMLElement;
  statusEl: HTMLElement;
  fillEl: HTMLElement;
}

/**
 * Mode switcher, 60s Automated Benchmark sequencer controls, and
 * Interactive Sandbox stress pass / resolution scale / camera controls.
 */
export class ControlPanel {
  public readonly element: HTMLElement;
  private readonly controller: EngineController;
  private readonly onOpenScorecard: () => void;

  private readonly benchmarkModeBtn: HTMLButtonElement;
  private readonly sandboxModeBtn: HTMLButtonElement;

  private readonly benchmarkSection: HTMLElement;
  private readonly sandboxSection: HTMLElement;

  private readonly startStopBtn: HTMLButtonElement;
  private readonly reopenScorecardBtn: HTMLButtonElement;
  private readonly stageSummaryEl: HTMLElement;
  private readonly remainingEl: HTMLElement;
  private readonly totalProgressFillEl: HTMLElement;
  private readonly stageListEl: HTMLElement;
  private readonly stageRows = new Map<StageId, StageRowElements>();

  private readonly passSwitches = new Map<keyof SandboxPasses, HTMLButtonElement>();
  private readonly resolutionSlider: HTMLInputElement;
  private readonly resolutionValueEl: HTMLElement;
  private readonly resolutionPixelsEl: HTMLElement;
  private readonly presetButtons = new Map<number, HTMLButtonElement>();
  private readonly resetCameraBtn: HTMLButtonElement;

  private currentMode: BenchmarkMode = 'benchmark';
  private isRunning = false;
  private totalDurationSec = 60;
  private currentScale = 1.0;

  constructor(
    parent: HTMLElement,
    controller: EngineController,
    onOpenScorecard: () => void,
  ) {
    this.controller = controller;
    this.onOpenScorecard = onOpenScorecard;

    this.element = document.createElement('section');
    this.element.className = 'am-panel am-control-panel';
    this.element.setAttribute('data-testid', 'control-panel');
    this.element.setAttribute('aria-label', 'Benchmark and Sandbox Controls');

    // Mode Segmented Switcher
    const modeRow = document.createElement('div');
    modeRow.className = 'am-mode-switch';
    modeRow.setAttribute('role', 'tablist');
    modeRow.setAttribute('aria-label', 'Execution Mode');

    this.benchmarkModeBtn = document.createElement('button');
    this.benchmarkModeBtn.type = 'button';
    this.benchmarkModeBtn.className = 'am-mode-btn';
    this.benchmarkModeBtn.setAttribute('role', 'tab');
    this.benchmarkModeBtn.setAttribute('data-testid', 'mode-benchmark');
    this.benchmarkModeBtn.textContent = '60s Benchmark';
    this.benchmarkModeBtn.addEventListener('click', () => {
      this.controller.setMode('benchmark');
    });

    this.sandboxModeBtn = document.createElement('button');
    this.sandboxModeBtn.type = 'button';
    this.sandboxModeBtn.className = 'am-mode-btn';
    this.sandboxModeBtn.setAttribute('role', 'tab');
    this.sandboxModeBtn.setAttribute('data-testid', 'mode-sandbox');
    this.sandboxModeBtn.textContent = 'Interactive Sandbox';
    this.sandboxModeBtn.addEventListener('click', () => {
      this.controller.setMode('sandbox');
    });

    modeRow.append(this.benchmarkModeBtn, this.sandboxModeBtn);

    // Benchmark Mode Section
    this.benchmarkSection = document.createElement('div');
    this.benchmarkSection.className = 'am-panel-section';

    const actionRow = document.createElement('div');
    actionRow.className = 'am-benchmark-actions';

    this.startStopBtn = document.createElement('button');
    this.startStopBtn.type = 'button';
    this.startStopBtn.className = 'am-btn am-btn-primary';
    this.startStopBtn.setAttribute('data-testid', 'start-benchmark-btn');
    this.startStopBtn.textContent = 'Start 60s Benchmark';
    this.startStopBtn.addEventListener('click', () => {
      if (this.isRunning) {
        this.controller.stopBenchmark();
      } else {
        this.controller.startBenchmark();
      }
    });

    this.reopenScorecardBtn = document.createElement('button');
    this.reopenScorecardBtn.type = 'button';
    this.reopenScorecardBtn.className = 'am-btn am-btn-secondary';
    this.reopenScorecardBtn.setAttribute('data-testid', 'panel-reopen-scorecard-btn');
    this.reopenScorecardBtn.textContent = 'Last Scorecard';
    this.reopenScorecardBtn.hidden = true;
    this.reopenScorecardBtn.addEventListener('click', () => {
      this.onOpenScorecard();
    });

    actionRow.append(this.startStopBtn, this.reopenScorecardBtn);

    const progressBox = document.createElement('div');
    progressBox.className = 'am-progress-box';

    const progressHeader = document.createElement('div');
    progressHeader.className = 'am-progress-header';

    this.stageSummaryEl = document.createElement('span');
    this.stageSummaryEl.className = 'am-progress-title';
    this.stageSummaryEl.setAttribute('data-testid', 'benchmark-stage-label');
    this.stageSummaryEl.textContent = 'Ready · 4 stages';

    this.remainingEl = document.createElement('span');
    this.remainingEl.className = 'am-progress-time num';
    this.remainingEl.setAttribute('data-testid', 'benchmark-remaining');
    this.remainingEl.textContent = '60.0s / 60s';

    progressHeader.append(this.stageSummaryEl, this.remainingEl);

    const progressTrack = document.createElement('div');
    progressTrack.className = 'am-progress-track';
    this.totalProgressFillEl = document.createElement('div');
    this.totalProgressFillEl.className = 'am-progress-fill';
    progressTrack.appendChild(this.totalProgressFillEl);

    progressBox.append(progressHeader, progressTrack);

    this.stageListEl = document.createElement('div');
    this.stageListEl.className = 'am-stage-list';
    this.buildStageRows(this.controller.getStageDescriptors());

    this.benchmarkSection.append(actionRow, progressBox, this.stageListEl);

    // Sandbox Mode Section
    this.sandboxSection = document.createElement('div');
    this.sandboxSection.className = 'am-panel-section';
    this.sandboxSection.hidden = true;

    const passesHeading = document.createElement('div');
    passesHeading.className = 'am-group-label';
    passesHeading.textContent = 'Stress passes';

    const passList = document.createElement('div');
    passList.className = 'am-pass-list';

    for (const cfg of SANDBOX_PASS_CONFIGS) {
      const row = document.createElement('div');
      row.className = 'am-pass-row';

      const textCol = document.createElement('div');
      textCol.className = 'am-pass-text';
      const title = document.createElement('span');
      title.className = 'am-pass-name';
      title.textContent = cfg.label;
      const detail = document.createElement('span');
      detail.className = 'am-pass-detail';
      detail.textContent = cfg.detail;
      textCol.append(title, detail);

      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'am-switch';
      switchBtn.setAttribute('role', 'switch');
      switchBtn.setAttribute('aria-checked', 'false');
      switchBtn.setAttribute('aria-label', cfg.label);
      switchBtn.setAttribute('data-pass', cfg.key);
      switchBtn.setAttribute('data-testid', `pass-toggle-${cfg.key}`);
      const thumb = document.createElement('span');
      thumb.className = 'am-switch-thumb';
      switchBtn.appendChild(thumb);

      switchBtn.addEventListener('click', () => {
        const nextVal = switchBtn.getAttribute('aria-checked') !== 'true';
        this.controller.setSandboxPasses({ [cfg.key]: nextVal });
      });

      this.passSwitches.set(cfg.key, switchBtn);
      row.append(textCol, switchBtn);
      passList.appendChild(row);
    }

    // Resolution Scale Controls
    const resBox = document.createElement('div');
    resBox.className = 'am-res-box';

    const resHeader = document.createElement('div');
    resHeader.className = 'am-res-header';
    const resLabel = document.createElement('label');
    resLabel.className = 'am-group-label';
    resLabel.htmlFor = 'am-res-scale-slider';
    resLabel.textContent = 'Resolution scale';

    this.resolutionValueEl = document.createElement('span');
    this.resolutionValueEl.className = 'am-res-scale-val num';
    this.resolutionValueEl.setAttribute('data-testid', 'resolution-scale-value');
    this.resolutionValueEl.textContent = '1.00×';

    resHeader.append(resLabel, this.resolutionValueEl);

    this.resolutionSlider = document.createElement('input');
    this.resolutionSlider.id = 'am-res-scale-slider';
    this.resolutionSlider.className = 'am-slider';
    this.resolutionSlider.type = 'range';
    this.resolutionSlider.min = '0.5';
    this.resolutionSlider.max = '2.0';
    this.resolutionSlider.step = '0.05';
    this.resolutionSlider.value = '1.0';
    this.resolutionSlider.setAttribute('data-testid', 'resolution-slider');
    this.resolutionSlider.addEventListener('input', () => {
      const val = Number(this.resolutionSlider.value);
      this.controller.setResolutionScale(val);
    });

    const resSubRow = document.createElement('div');
    resSubRow.className = 'am-res-subrow';

    this.resolutionPixelsEl = document.createElement('span');
    this.resolutionPixelsEl.className = 'am-res-pixels num';
    this.resolutionPixelsEl.setAttribute('data-testid', 'sandbox-effective-res');
    this.resolutionPixelsEl.textContent = '- x - px';

    const presetRow = document.createElement('div');
    presetRow.className = 'am-preset-row';
    for (const preset of [0.5, 1.0, 1.5, 2.0]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'am-preset-btn num';
      btn.textContent = `${preset.toFixed(preset % 1 === 0 ? 1 : 2).replace(/\.0$/, '.0')}×`;
      btn.addEventListener('click', () => {
        this.controller.setResolutionScale(preset);
      });
      this.presetButtons.set(preset, btn);
      presetRow.appendChild(btn);
    }

    resSubRow.append(this.resolutionPixelsEl, presetRow);
    resBox.append(resHeader, this.resolutionSlider, resSubRow);

    // Camera Actions + Hint
    const cameraBox = document.createElement('div');
    cameraBox.className = 'am-camera-box';

    this.resetCameraBtn = document.createElement('button');
    this.resetCameraBtn.type = 'button';
    this.resetCameraBtn.className = 'am-btn am-btn-secondary';
    this.resetCameraBtn.setAttribute('data-testid', 'reset-camera-btn');
    this.resetCameraBtn.textContent = 'Reset Camera';
    this.resetCameraBtn.addEventListener('click', () => {
      this.controller.resetSandboxCamera();
    });

    const hintEl = document.createElement('p');
    hintEl.className = 'am-orbit-hint';
    hintEl.textContent = 'Drag to orbit · Scroll to zoom · Right-drag to pan';

    cameraBox.append(this.resetCameraBtn, hintEl);

    this.sandboxSection.append(passesHeading, passList, resBox, cameraBox);
    this.element.append(modeRow, this.benchmarkSection, this.sandboxSection);
    parent.appendChild(this.element);

    this.setMode(controller.getMode());
    this.setSandboxPasses(controller.getSandboxPasses());
    this.setResolutionScale(controller.getResolutionScale());
    this.updateProgress(controller.getProgress());
  }

  public setMode(mode: BenchmarkMode): void {
    this.currentMode = mode;
    const isBenchmark = mode === 'benchmark';

    this.benchmarkModeBtn.classList.toggle('is-active', isBenchmark);
    this.benchmarkModeBtn.setAttribute('aria-selected', String(isBenchmark));
    this.sandboxModeBtn.classList.toggle('is-active', !isBenchmark);
    this.sandboxModeBtn.setAttribute('aria-selected', String(!isBenchmark));

    this.benchmarkSection.hidden = !isBenchmark;
    this.sandboxSection.hidden = isBenchmark;
  }

  public setSandboxPasses(passes: SandboxPasses): void {
    for (const cfg of SANDBOX_PASS_CONFIGS) {
      const btn = this.passSwitches.get(cfg.key);
      if (!btn) continue;
      const enabled = Boolean(passes[cfg.key]);
      btn.setAttribute('aria-checked', String(enabled));
      btn.classList.toggle('is-on', enabled);
    }
  }

  public setResolutionScale(scale: number): void {
    this.currentScale = scale;
    const formatted = `${scale.toFixed(2)}×`;
    this.resolutionValueEl.textContent = formatted;
    if (Math.abs(Number(this.resolutionSlider.value) - scale) > 0.001) {
      this.resolutionSlider.value = String(scale);
    }
    for (const [preset, btn] of this.presetButtons.entries()) {
      btn.classList.toggle('is-active', Math.abs(preset - scale) < 0.02);
    }
  }

  public updateEffectiveResolution(width: number, height: number): void {
    this.resolutionPixelsEl.textContent = `${formatResolution(width, height)} px`;
  }

  public setHasLastResult(hasResult: boolean): void {
    this.reopenScorecardBtn.hidden = !hasResult;
  }

  public updateProgress(progress: BenchmarkProgress): void {
    this.isRunning = progress.running;
    this.totalDurationSec = progress.totalDurationSec;

    if (progress.running) {
      this.startStopBtn.textContent = 'Stop Benchmark';
      this.startStopBtn.classList.remove('am-btn-primary');
      this.startStopBtn.classList.add('am-btn-danger');
      this.startStopBtn.setAttribute('data-testid', 'stop-benchmark-btn');
    } else {
      const durationLabel = formatDurationSec(this.totalDurationSec);
      this.startStopBtn.textContent = `Start ${durationLabel} Benchmark`;
      this.startStopBtn.classList.add('am-btn-primary');
      this.startStopBtn.classList.remove('am-btn-danger');
      this.startStopBtn.setAttribute('data-testid', 'start-benchmark-btn');
    }

    const totalStages = Math.max(1, this.stageRows.size);
    const remainingSec = Math.max(0, progress.totalDurationSec - progress.totalElapsedSec);
    const totalPct =
      progress.totalDurationSec > 0
        ? Math.min(100, Math.max(0, (progress.totalElapsedSec / progress.totalDurationSec) * 100))
        : 0;

    if (progress.running) {
      this.stageSummaryEl.textContent = `Stage ${progress.stageIndex + 1}/${totalStages} · ${progress.stageName}`;
      this.remainingEl.textContent = `${remainingSec.toFixed(1)}s left`;
      this.totalProgressFillEl.style.width = `${totalPct.toFixed(1)}%`;
    } else {
      const durationLabel = formatDurationSec(progress.totalDurationSec);
      this.stageSummaryEl.textContent =
        this.currentMode === 'benchmark'
          ? `Ready · ${totalStages} sequential stages`
          : 'Benchmark idle';
      this.remainingEl.textContent = `${durationLabel} · ${this.currentScale.toFixed(2)}×`;
      this.totalProgressFillEl.style.width = '0%';
    }

    let idx = 0;
    for (const [, rowRefs] of this.stageRows.entries()) {
      const isDone = progress.running && idx < progress.stageIndex;
      const isActive = progress.running && idx === progress.stageIndex;

      rowRefs.row.classList.toggle('is-active', isActive);
      rowRefs.row.classList.toggle('is-done', isDone);

      if (isActive) {
        const stageLeft = Math.max(0, progress.stageDurationSec - progress.stageElapsedSec);
        const stagePct =
          progress.stageDurationSec > 0
            ? Math.min(100, Math.max(0, (progress.stageElapsedSec / progress.stageDurationSec) * 100))
            : 0;
        rowRefs.statusEl.textContent = `${stageLeft.toFixed(1)}s`;
        rowRefs.fillEl.style.width = `${stagePct.toFixed(1)}%`;
      } else if (isDone) {
        rowRefs.statusEl.textContent = 'Done';
        rowRefs.fillEl.style.width = '100%';
      } else {
        rowRefs.statusEl.textContent = progress.running
          ? 'Queued'
          : formatDurationSec(progress.stageDurationSec);
        rowRefs.fillEl.style.width = '0%';
      }
      idx += 1;
    }
  }

  public dispose(): void {
    this.element.remove();
  }

  private buildStageRows(descriptors: StageDescriptor[]): void {
    const items: StageDescriptor[] =
      descriptors.length > 0
        ? descriptors
        : [
            { id: 'instanced', name: 'Instanced 500k Mesh', description: '', weight: 1.0 },
            { id: 'raymarch', name: 'Raymarched Fractal Shader', description: '', weight: 1.3 },
            { id: 'water', name: 'Water Refraction & Caustics', description: '', weight: 1.2 },
            { id: 'combined', name: 'Combined Stress Scene', description: '', weight: 1.5 },
          ];

    items.forEach((stage, index) => {
      const row = document.createElement('div');
      row.className = 'am-stage-row';
      row.setAttribute('data-stage-id', stage.id);

      const top = document.createElement('div');
      top.className = 'am-stage-top';

      const name = document.createElement('span');
      name.className = 'am-stage-name';
      name.textContent = `${index + 1}. ${stage.name}`;

      const statusEl = document.createElement('span');
      statusEl.className = 'am-stage-status num';
      statusEl.textContent = '15s';

      top.append(name, statusEl);

      const barTrack = document.createElement('div');
      barTrack.className = 'am-stage-bar-track';
      const fillEl = document.createElement('div');
      fillEl.className = 'am-stage-bar-fill';
      barTrack.appendChild(fillEl);

      row.append(top, barTrack);
      this.stageListEl.appendChild(row);
      this.stageRows.set(stage.id, { row, statusEl, fillEl });
    });
  }
}
