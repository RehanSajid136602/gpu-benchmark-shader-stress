import { formatMs, getFrameTimeSeverityColor } from './format.ts';

const DEFAULT_CAPACITY = 180;
const REFERENCE_60FPS_MS = 16.67;
const REFERENCE_30FPS_MS = 33.33;
const DRAW_THROTTLE_MS = 140;
const CEILING_STEPS = [25, 40, 50, 65, 80, 100, 130, 160, 200, 250, 350, 500, 750, 1000, 1500, 2000];

/**
 * Flight-recorder DPR-aware scrolling canvas frame-time graph.
 * Draws on a throttled cadence (~140ms) so HUD rendering never steals GPU budget.
 */
export class FrameGraph {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly headerCurrentEl: HTMLElement;
  private readonly headerRangeEl: HTMLElement;

  private readonly capacity: number;
  private readonly samples: Float32Array;
  private sampleCount = 0;
  private writeIndex = 0;

  private cssWidth = 316;
  private cssHeight = 120;
  private dpr = 1;
  private smoothedCeiling = 40;
  private lastDrawMs = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  constructor(container: HTMLElement, capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(30, capacity);
    this.samples = new Float32Array(this.capacity);

    this.root = document.createElement('div');
    this.root.className = 'am-chart-block';

    const header = document.createElement('div');
    header.className = 'am-chart-header';

    const title = document.createElement('span');
    title.className = 'am-chart-title';
    title.textContent = 'FRAME TELEMETRY (MS)';

    const meta = document.createElement('div');
    meta.className = 'am-chart-meta';

    this.headerRangeEl = document.createElement('span');
    this.headerRangeEl.className = 'am-chart-range num';
    this.headerRangeEl.textContent = 'min - · max -';

    this.headerCurrentEl = document.createElement('span');
    this.headerCurrentEl.className = 'am-chart-current num';
    this.headerCurrentEl.textContent = '- ms';

    meta.append(this.headerRangeEl, this.headerCurrentEl);
    header.append(title, meta);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'am-chart-canvas-wrap';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'am-chart-canvas';
    this.canvas.setAttribute('data-testid', 'frame-time-chart');
    this.canvas.setAttribute('aria-label', 'Scrolling frame time history graph');

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D canvas context for FrameGraph.');
    }
    this.ctx = ctx;

    canvasWrap.appendChild(this.canvas);
    this.root.append(header, canvasWrap);
    container.appendChild(this.root);

    this.syncSize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.disposed) {
          this.syncSize();
          this.draw();
        }
      });
      this.resizeObserver.observe(canvasWrap);
    }

    this.draw();
  }

  public push(frameTimeMs: number, nowMs = performance.now()): void {
    if (this.disposed) return;
    const clamped = Math.max(0.1, Math.min(2000, Number.isFinite(frameTimeMs) ? frameTimeMs : 16.67));
    this.samples[this.writeIndex] = clamped;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.sampleCount < this.capacity) {
      this.sampleCount += 1;
    }
    if (nowMs - this.lastDrawMs >= DRAW_THROTTLE_MS) {
      this.lastDrawMs = nowMs;
      this.draw();
    }
  }

  public clear(): void {
    this.sampleCount = 0;
    this.writeIndex = 0;
    this.smoothedCeiling = 40;
    this.headerRangeEl.textContent = 'min - · max -';
    this.headerCurrentEl.textContent = '- ms';
    this.draw();
  }

  public redraw(): void {
    if (this.disposed) return;
    this.syncSize();
    this.draw();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.root.remove();
  }

  private syncSize(): void {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const width = Math.max(180, Math.floor(rect?.width || this.cssWidth));
    const height = Math.max(92, Math.floor(rect?.height || 120));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (width !== this.cssWidth || height !== this.cssHeight || dpr !== this.dpr) {
      this.cssWidth = width;
      this.cssHeight = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Carbon background
    ctx.fillStyle = '#090b0f';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 8;
    const padRight = 40;
    const padTop = 8;
    const padBottom = 10;
    const plotW = Math.max(10, w - padLeft - padRight);
    const plotH = Math.max(10, h - padTop - padBottom);

    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    let current = 0;

    if (this.sampleCount > 0) {
      const start = (this.writeIndex - this.sampleCount + this.capacity) % this.capacity;
      for (let i = 0; i < this.sampleCount; i++) {
        const val = this.samples[(start + i) % this.capacity]!;
        if (val < min) min = val;
        if (val > max) max = val;
        current = val;
      }
      this.headerRangeEl.textContent = `min ${formatMs(min)} · max ${formatMs(max)}`;
      this.headerCurrentEl.textContent = `${formatMs(current)} ms`;
      this.headerCurrentEl.style.color = getFrameTimeSeverityColor(current);
    }

    const targetMax = Math.max(40, max * 1.15);
    let ceiling = CEILING_STEPS[CEILING_STEPS.length - 1]!;
    for (const step of CEILING_STEPS) {
      if (step >= targetMax) {
        ceiling = step;
        break;
      }
    }
    this.smoothedCeiling = this.smoothedCeiling * 0.7 + ceiling * 0.3;
    const yMax = Math.max(36, this.smoothedCeiling);

    const yForMs = (ms: number): number => {
      const ratio = Math.max(0, Math.min(1, ms / yMax));
      return padTop + plotH * (1 - ratio);
    };

    // Subtle horizontal grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + plotH * 0.5);
    ctx.lineTo(padLeft + plotW, padTop + plotH * 0.5);
    ctx.stroke();

    // 30 FPS guide (33.33ms)
    if (REFERENCE_30FPS_MS <= yMax) {
      const y30 = Math.round(yForMs(REFERENCE_30FPS_MS)) + 0.5;
      ctx.strokeStyle = 'rgba(245, 184, 65, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y30);
      ctx.lineTo(padLeft + plotW, y30);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(245, 184, 65, 0.85)';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('30fps', padLeft + plotW + 4, y30);
    }

    // 60 FPS guide (16.67ms)
    if (REFERENCE_60FPS_MS <= yMax) {
      const y60 = Math.round(yForMs(REFERENCE_60FPS_MS)) + 0.5;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.50)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y60);
      ctx.lineTo(padLeft + plotW, y60);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(52, 211, 153, 0.90)';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('60fps', padLeft + plotW + 4, y60);
    }

    // Plot waveform
    if (this.sampleCount >= 2) {
      const start = (this.writeIndex - this.sampleCount + this.capacity) % this.capacity;
      const stepX = plotW / Math.max(1, this.capacity - 1);
      const offsetX = padLeft + (this.capacity - this.sampleCount) * stepX;

      ctx.beginPath();
      for (let i = 0; i < this.sampleCount; i++) {
        const val = this.samples[(start + i) % this.capacity]!;
        const x = offsetX + i * stepX;
        const y = yForMs(val);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      const strokeColor = getFrameTimeSeverityColor(current);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Subtle fill under curve
      ctx.lineTo(offsetX + (this.sampleCount - 1) * stepX, padTop + plotH);
      ctx.lineTo(offsetX, padTop + plotH);
      ctx.closePath();
      ctx.fillStyle =
        strokeColor === '#34d399'
          ? 'rgba(52, 211, 153, 0.08)'
          : strokeColor === '#f5b841'
            ? 'rgba(245, 184, 65, 0.09)'
            : 'rgba(255, 93, 71, 0.10)';
      ctx.fill();
    }

    ctx.restore();
  }
}
