import { formatMs, getFrameTimeSeverityColor } from './format.ts';

const DEFAULT_CAPACITY = 180;
const REFERENCE_60FPS_MS = 16.67;
const REFERENCE_30FPS_MS = 33.33;
const CEILING_STEPS = [25, 40, 50, 65, 80, 100, 130, 160, 200, 250, 350, 500, 750, 1000, 1500, 2000];

export interface FrameTimeStats {
  current: number;
  min: number;
  avg: number;
  max: number;
  ceiling: number;
}

/**
 * DPR-aware scrolling canvas chart displaying recent frame times (ms)
 * with 16.67ms (60 FPS) and 33.33ms (30 FPS) pacing guides.
 */
export class FrameTimeChart {
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
  private cssHeight = 128;
  private dpr = 1;
  private smoothedCeiling = 40;
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
    title.textContent = 'Frame time (ms)';

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
    this.canvas.setAttribute('aria-label', 'Scrolling frame time history chart');

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D canvas context for FrameTimeChart.');
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

  public push(frameTimeMs: number, shouldDraw = true): void {
    if (this.disposed) return;
    const clamped = Math.max(0.1, Math.min(2000, Number.isFinite(frameTimeMs) ? frameTimeMs : 16.67));
    this.samples[this.writeIndex] = clamped;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.sampleCount < this.capacity) {
      this.sampleCount += 1;
    }
    if (shouldDraw) {
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
    const height = Math.max(96, Math.floor(rect?.height || 128));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (width !== this.cssWidth || height !== this.cssHeight || dpr !== this.dpr) {
      this.cssWidth = width;
      this.cssHeight = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
  }

  private computeStats(): FrameTimeStats {
    if (this.sampleCount === 0) {
      return { current: 0, min: 0, avg: 0, max: 0, ceiling: 40 };
    }

    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    let sum = 0;

    for (let i = 0; i < this.sampleCount; i++) {
      const val = this.getSampleAt(i);
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
    }

    const current = this.getSampleAt(this.sampleCount - 1);
    const avg = sum / this.sampleCount;

    // Pick a clean step above max and >= 40ms so both 16.67ms and 33.33ms guides are always on scale
    const targetRaw = Math.max(40, max * 1.15);
    let targetCeiling = CEILING_STEPS[CEILING_STEPS.length - 1]!;
    for (let i = 0; i < CEILING_STEPS.length; i++) {
      if (CEILING_STEPS[i]! >= targetRaw) {
        targetCeiling = CEILING_STEPS[i]!;
        break;
      }
    }

    if (targetCeiling > this.smoothedCeiling) {
      this.smoothedCeiling = targetCeiling;
    } else {
      this.smoothedCeiling = Math.max(40, this.smoothedCeiling * 0.94 + targetCeiling * 0.06);
      if (Math.abs(this.smoothedCeiling - targetCeiling) < 1.2) {
        this.smoothedCeiling = targetCeiling;
      }
    }

    return {
      current,
      min,
      avg,
      max,
      ceiling: Math.max(40, Math.round(this.smoothedCeiling)),
    };
  }

  private getSampleAt(logicalIndex: number): number {
    if (this.sampleCount < this.capacity) {
      return this.samples[logicalIndex] ?? 0;
    }
    const idx = (this.writeIndex + logicalIndex) % this.capacity;
    return this.samples[idx] ?? 0;
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (w <= 0 || h <= 0) return;

    const stats = this.computeStats();
    const ceiling = stats.ceiling;

    if (this.sampleCount > 0) {
      this.headerRangeEl.textContent = `${formatMs(stats.min)} - ${formatMs(stats.max)} ms`;
      this.headerCurrentEl.textContent = `${formatMs(stats.current)} ms`;
      this.headerCurrentEl.style.color = getFrameTimeSeverityColor(stats.current);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Chart interior bounds: reserve left lane for Y ticks so lines never cross text
    const padLeft = 36;
    const padRight = 8;
    const padTop = 10;
    const padBottom = 14;
    const plotW = Math.max(40, w - padLeft - padRight);
    const plotH = Math.max(40, h - padTop - padBottom);

    const valueToY = (ms: number): number => {
      const clamped = Math.max(0, Math.min(ceiling, ms));
      return padTop + plotH - (clamped / ceiling) * plotH;
    };

    // Background well
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(padLeft, padTop, plotW, plotH);

    // Subtle horizontal gridlines & Y-axis ticks (0, mid, ceiling)
    const tickValues = [0, Math.round(ceiling / 2), ceiling];
    ctx.font = '500 10px "JetBrains Mono", "Fira Code", "Cascadia Mono", ui-monospace, monospace'; /* taste-skill-ignore */
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < tickValues.length; i++) {
      const tick = tickValues[i]!;
      const y = Math.round(valueToY(tick)) + 0.5;
      ctx.strokeStyle = i === 0 ? '#2a2d36' : '#181a21';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = '#7e8391';
      ctx.fillText(String(tick), padLeft - 6, y);
    }

    // Reference pacing lines: 16.67ms (60 FPS) & 33.33ms (30 FPS)
    const y60 = valueToY(REFERENCE_60FPS_MS);
    const y30 = valueToY(REFERENCE_30FPS_MS);
    const guidesTight = y60 - y30 < 15;

    this.drawReferenceGuide(
      ctx,
      padLeft,
      plotW,
      y30,
      '33.3ms · 30fps',
      'rgba(217, 164, 65, 0.55)',
      '#d9a441',
      'above',
    );
    this.drawReferenceGuide(
      ctx,
      padLeft,
      plotW,
      y60,
      ceiling <= 220 ? '16.7ms · 60fps' : '',
      'rgba(63, 192, 122, 0.50)',
      '#3fc07a',
      guidesTight ? 'below' : 'above',
    );

    if (this.sampleCount === 0) {
      ctx.fillStyle = '#7e8391';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Awaiting frame telemetry', padLeft + plotW / 2, padTop + plotH / 2);
      return;
    }

    // Plot scrolling waveform pinned to the right edge so samples enter from the right
    const stepX = plotW / Math.max(1, this.capacity - 1);
    const startX = padLeft + plotW - (this.sampleCount - 1) * stepX;

    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, plotW, plotH);
    ctx.clip();

    // Subtle flat tint under line (per app-screens rules: flat 12% fill, no gradient)
    ctx.beginPath();
    for (let i = 0; i < this.sampleCount; i++) {
      const x = startX + i * stepX;
      const y = valueToY(this.getSampleAt(i));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const endX = startX + (this.sampleCount - 1) * stepX;
    const baseY = padTop + plotH;
    ctx.lineTo(endX, baseY);
    ctx.lineTo(startX, baseY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(76, 179, 240, 0.11)';
    ctx.fill();

    // Crisp polyline trace
    ctx.beginPath();
    for (let i = 0; i < this.sampleCount; i++) {
      const x = startX + i * stepX;
      const y = valueToY(this.getSampleAt(i));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4cb3f0';
    ctx.lineWidth = 1.65;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.stroke();

    // Highlight current frame-time horizontal marker & dot
    const lastY = valueToY(stats.current);
    const markerColor = getFrameTimeSeverityColor(stats.current);

    ctx.strokeStyle = 'rgba(243, 244, 246, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, Math.round(lastY) + 0.5);
    ctx.lineTo(endX, Math.round(lastY) + 0.5);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = markerColor;
    ctx.beginPath();
    ctx.arc(endX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b0c10';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    // Bottom axis timeline hint
    ctx.fillStyle = '#7e8391';
    ctx.font = '400 10px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`-${this.capacity}f`, padLeft, h - 1);
    ctx.textAlign = 'right';
    ctx.fillText('Now', padLeft + plotW, h - 1);
  }

  private drawReferenceGuide(
    ctx: CanvasRenderingContext2D,
    padLeft: number,
    plotW: number,
    yPos: number,
    label: string,
    strokeStyle: string,
    textStyle: string,
    placement: 'above' | 'below' = 'above',
  ): void {
    const y = Math.round(yPos) + 0.5;
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();

    if (label) {
      ctx.setLineDash([]);
      ctx.font = '500 9.5px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
      ctx.textAlign = 'right';
      ctx.textBaseline = placement === 'above' ? 'bottom' : 'top';
      ctx.fillStyle = textStyle;
      ctx.fillText(label, padLeft + plotW - 4, placement === 'above' ? y - 2 : y + 2);
    }
    ctx.restore();
  }
}
