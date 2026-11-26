import type { TelemetrySnapshot, WebGLGPUInfo } from '../types.ts';
import { FrameGraph } from './FrameGraph.ts';
import {
  formatCompactCount,
  formatFps,
  formatGpuTimeMs,
  formatMs,
  formatResolution,
  getFpsSeverityColor,
} from './format.ts';

/**
 * Flight-recorder Live Telemetry HUD panel: displays WebGL2 & GPU renderer info,
 * tabular live metrics (FPS, frame time, 1% low, GPU time, draw calls, triangles),
 * effective render resolution, and the throttled FrameGraph.
 */
export class TelemetryHUD {
  public readonly element: HTMLElement;
  private readonly chart: FrameGraph;

  private readonly gpuRendererEl: HTMLElement;
  private readonly gpuMetaEl: HTMLElement;
  private readonly fallbackPillEl: HTMLElement;
  private readonly resolutionEl: HTMLElement;

  private readonly fpsValueEl: HTMLElement;
  private readonly fpsDotEl: HTMLElement;
  private readonly frameTimeValueEl: HTMLElement;
  private readonly onePercentLowValueEl: HTMLElement;
  private readonly gpuTimeValueEl: HTMLElement;
  private readonly drawCallsValueEl: HTMLElement;
  private readonly trianglesValueEl: HTMLElement;

  private lastFpsText = '';
  private lastFpsColor = '';
  private lastFrameTimeText = '';
  private lastLowText = '';
  private lastGpuTimeText = '';
  private lastDrawCallsText = '';
  private lastTrianglesText = '';
  private lastTrianglesTitle = '';
  private lastResText = '';

  constructor(parent: HTMLElement) {
    this.element = document.createElement('section');
    this.element.className = 'am-panel am-telemetry-dock';
    this.element.setAttribute('data-testid', 'hud-panel');
    this.element.setAttribute('aria-label', 'Live GPU Telemetry');

    // Brand + WebGL2 status header
    const header = document.createElement('header');
    header.className = 'am-hud-header';

    const brand = document.createElement('div');
    brand.className = 'am-brand';
    brand.innerHTML = `
      <svg class="am-brand-mark" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <polygon points="8,1.5 14.5,5.25 14.5,10.75 8,14.5 1.5,10.75 1.5,5.25" stroke="currentColor" stroke-width="1.35"/>
        <circle cx="8" cy="8" r="2.1" fill="#34d399"/>
      </svg>
      <h1 class="am-brand-title">AetherMark</h1>
    `;

    const badges = document.createElement('div');
    badges.className = 'am-header-badges';

    const webglBadge = document.createElement('span');
    webglBadge.className = 'am-pill am-pill-neutral';
    webglBadge.textContent = 'WebGL2';

    this.fallbackPillEl = document.createElement('span');
    this.fallbackPillEl.className = 'am-pill am-pill-warning';
    this.fallbackPillEl.textContent = 'Software SW';
    this.fallbackPillEl.hidden = true;

    badges.append(webglBadge, this.fallbackPillEl);
    header.append(brand, badges);

    // GPU Hardware Info row
    const gpuBlock = document.createElement('div');
    gpuBlock.className = 'am-gpu-block';

    const gpuTop = document.createElement('div');
    gpuTop.className = 'am-gpu-top';

    const gpuLabel = document.createElement('span');
    gpuLabel.className = 'am-meta-label';
    gpuLabel.textContent = 'GPU Renderer';

    this.resolutionEl = document.createElement('span');
    this.resolutionEl.className = 'am-resolution-readout num';
    this.resolutionEl.setAttribute('data-testid', 'hud-resolution');
    this.resolutionEl.textContent = '- x - px';

    gpuTop.append(gpuLabel, this.resolutionEl);

    this.gpuRendererEl = document.createElement('div');
    this.gpuRendererEl.className = 'am-gpu-renderer';
    this.gpuRendererEl.setAttribute('data-testid', 'gpu-renderer');
    this.gpuRendererEl.textContent = 'Detecting WebGL2 device...';

    this.gpuMetaEl = document.createElement('div');
    this.gpuMetaEl.className = 'am-gpu-meta';
    this.gpuMetaEl.textContent = 'WEBGL_debug_renderer_info';

    gpuBlock.append(gpuTop, this.gpuRendererEl, this.gpuMetaEl);

    // Primary KPI strip (FPS & Frame Time)
    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'am-kpi-strip am-kpi-primary';

    const fpsCell = document.createElement('div');
    fpsCell.className = 'am-kpi-cell';
    const fpsLabelRow = document.createElement('div');
    fpsLabelRow.className = 'am-kpi-label-row';
    this.fpsDotEl = document.createElement('span');
    this.fpsDotEl.className = 'am-status-dot';
    const fpsLabel = document.createElement('span');
    fpsLabel.className = 'am-kpi-label';
    fpsLabel.textContent = 'Frame rate';
    fpsLabelRow.append(this.fpsDotEl, fpsLabel);

    const fpsValRow = document.createElement('div');
    fpsValRow.className = 'am-kpi-val-row';
    this.fpsValueEl = document.createElement('span');
    this.fpsValueEl.className = 'am-kpi-value am-kpi-lead num';
    this.fpsValueEl.setAttribute('data-testid', 'hud-fps');
    this.fpsValueEl.textContent = '-';
    const fpsUnit = document.createElement('span');
    fpsUnit.className = 'am-kpi-unit';
    fpsUnit.textContent = 'fps';
    fpsValRow.append(this.fpsValueEl, fpsUnit);
    fpsCell.append(fpsLabelRow, fpsValRow);

    const ftCell = document.createElement('div');
    ftCell.className = 'am-kpi-cell';
    const ftLabel = document.createElement('span');
    ftLabel.className = 'am-kpi-label';
    ftLabel.textContent = 'Frame time';
    const ftValRow = document.createElement('div');
    ftValRow.className = 'am-kpi-val-row';
    this.frameTimeValueEl = document.createElement('span');
    this.frameTimeValueEl.className = 'am-kpi-value am-kpi-lead num';
    this.frameTimeValueEl.setAttribute('data-testid', 'hud-frametime');
    this.frameTimeValueEl.textContent = '-';
    const ftUnit = document.createElement('span');
    ftUnit.className = 'am-kpi-unit';
    ftUnit.textContent = 'ms';
    ftValRow.append(this.frameTimeValueEl, ftUnit);
    ftCell.append(ftLabel, ftValRow);

    primaryGrid.append(fpsCell, ftCell);

    // Secondary Telemetry strip (1% Low, GPU Time, Draw Calls, Triangles)
    const secondaryGrid = document.createElement('div');
    secondaryGrid.className = 'am-kpi-strip am-kpi-secondary am-kpi-quad';

    const lowCell = this.createCompactMetricCell('1% Low', 'hud-1pct-low', 'fps');
    this.onePercentLowValueEl = lowCell.valueEl;

    const gpuTimeCell = this.createCompactMetricCell('GPU time', 'hud-gpu-time');
    this.gpuTimeValueEl = gpuTimeCell.valueEl;

    const drawsCell = this.createCompactMetricCell('Draws', 'hud-draw-calls');
    this.drawCallsValueEl = drawsCell.valueEl;

    const trisCell = this.createCompactMetricCell('Tris', 'hud-triangles');
    this.trianglesValueEl = trisCell.valueEl;

    secondaryGrid.append(lowCell.cell, gpuTimeCell.cell, drawsCell.cell, trisCell.cell);

    // Scrolling frame-time canvas chart container
    const chartContainer = document.createElement('div');
    chartContainer.className = 'am-hud-chart-container';
    this.chart = new FrameGraph(chartContainer);

    this.element.append(header, gpuBlock, primaryGrid, secondaryGrid, chartContainer);
    parent.appendChild(this.element);
  }

  public setGPUInfo(info: WebGLGPUInfo): void {
    this.gpuRendererEl.textContent = info.renderer;
    this.gpuRendererEl.title = `${info.renderer} (${info.vendor})`;
    const timerStr = info.timerQueryAvailable ? 'TimerQuery ON' : 'TimerQuery N/A';
    this.gpuMetaEl.textContent = `${info.vendor} · MaxTex ${info.maxTextureSize}px · ${timerStr}`;
    this.fallbackPillEl.hidden = !info.isFallback;
  }

  public updateTelemetry(snapshot: TelemetrySnapshot, drawChart = true): void {
    const fpsText = formatFps(snapshot.fps);
    if (fpsText !== this.lastFpsText) {
      this.lastFpsText = fpsText;
      this.fpsValueEl.textContent = fpsText;
    }

    const fpsColor = getFpsSeverityColor(snapshot.fps);
    if (fpsColor !== this.lastFpsColor) {
      this.lastFpsColor = fpsColor;
      this.fpsDotEl.style.backgroundColor = fpsColor;
    }

    const ftText = formatMs(snapshot.frameTimeMs);
    if (ftText !== this.lastFrameTimeText) {
      this.lastFrameTimeText = ftText;
      this.frameTimeValueEl.textContent = ftText;
    }

    const lowText = formatFps(snapshot.onePercentLowFps);
    if (lowText !== this.lastLowText) {
      this.lastLowText = lowText;
      this.onePercentLowValueEl.textContent = lowText;
    }

    const gpuText = snapshot.gpuTimeMs !== null ? formatGpuTimeMs(snapshot.gpuTimeMs) : 'N/A';
    if (gpuText !== this.lastGpuTimeText) {
      this.lastGpuTimeText = gpuText;
      this.gpuTimeValueEl.textContent = gpuText;
      this.gpuTimeValueEl.title =
        snapshot.gpuTimeMs !== null
          ? `Measured GPU frame time: ${gpuText}`
          : 'EXT_disjoint_timer_query_webgl2 unavailable';
    }

    const drawText = Math.round(snapshot.drawCalls).toLocaleString('en-US');
    if (drawText !== this.lastDrawCallsText) {
      this.lastDrawCallsText = drawText;
      this.drawCallsValueEl.textContent = drawText;
    }

    const triText = formatCompactCount(snapshot.triangles);
    if (triText !== this.lastTrianglesText) {
      this.lastTrianglesText = triText;
      this.trianglesValueEl.textContent = triText;
    }
    const exactTris = `${Math.round(snapshot.triangles).toLocaleString('en-US')} triangles`;
    if (exactTris !== this.lastTrianglesTitle) {
      this.lastTrianglesTitle = exactTris;
      this.trianglesValueEl.title = exactTris;
    }

    const resText = `${formatResolution(snapshot.resolutionWidth, snapshot.resolutionHeight)} px · ${snapshot.resolutionScale.toFixed(2)}×`;
    if (resText !== this.lastResText) {
      this.lastResText = resText;
      this.resolutionEl.textContent = resText;
    }

    if (drawChart) {
      this.chart.push(snapshot.frameTimeMs);
    }
  }

  public clearChart(): void {
    this.chart.clear();
  }

  public redrawChart(): void {
    this.chart.redraw();
  }

  public dispose(): void {
    this.chart.dispose();
    this.element.remove();
  }

  private createCompactMetricCell(
    labelText: string,
    testId: string,
    unitText?: string,
  ): { cell: HTMLElement; valueEl: HTMLElement } {
    const cell = document.createElement('div');
    cell.className = 'am-kpi-cell';

    const label = document.createElement('span');
    label.className = 'am-kpi-label';
    label.textContent = labelText;

    const valRow = document.createElement('div');
    valRow.className = 'am-kpi-val-row';

    const valueEl = document.createElement('span');
    valueEl.className = 'am-kpi-value num';
    valueEl.setAttribute('data-testid', testId);
    valueEl.textContent = '-';
    valRow.appendChild(valueEl);

    if (unitText) {
      const unit = document.createElement('span');
      unit.className = 'am-kpi-unit';
      unit.textContent = unitText;
      valRow.appendChild(unit);
    }

    cell.append(label, valRow);
    return { cell, valueEl };
  }
}
