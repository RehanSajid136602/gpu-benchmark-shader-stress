import type { BenchmarkResult } from '../types.ts';
import { ScorecardExporter } from './ScorecardExporter.ts';
import {
  formatBoundVerdict,
  formatCompactCount,
  formatFps,
  formatGpuTimeMs,
  formatMs,
  formatNumber,
  formatSeedHex,
  formatTimestamp,
  getConfidenceColor,
} from './format.ts';

/**
 * Flight-recorder Scorecard Modal:
 * Asymmetric layout with dominant score column, animated score count-up,
 * ARIA live region, confidence badge, warnings list, GPU/CPU-bound chip,
 * per-stage timeline strip, and JSON / CSV / PNG exports.
 */
export class ScorecardModal {
  private readonly backdrop: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly liveRegionEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly exportJsonBtn: HTMLButtonElement;
  private readonly exportCsvBtn: HTMLButtonElement;
  private readonly exportPngBtn: HTMLButtonElement;
  private readonly runAgainBtn: HTMLButtonElement;

  private currentResult: BenchmarkResult | null = null;
  private countUpRafId: number | null = null;
  private readonly onRunAgain: () => void;
  private readonly onCloseCallback: () => void;

  constructor(
    parent: HTMLElement,
    options: {
      onRunAgain: () => void;
      onClose?: () => void;
    },
  ) {
    this.onRunAgain = options.onRunAgain;
    this.onCloseCallback = options.onClose ?? (() => {});

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'am-modal-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) {
        this.close();
      }
    });

    this.dialog = document.createElement('div');
    this.dialog.className = 'am-modal';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-labelledby', 'am-scorecard-heading');
    this.dialog.setAttribute('data-testid', 'scorecard-modal');

    // ARIA live region for accessible score reveal
    this.liveRegionEl = document.createElement('div');
    this.liveRegionEl.className = 'am-sr-only';
    this.liveRegionEl.setAttribute('aria-live', 'polite');
    this.liveRegionEl.setAttribute('aria-atomic', 'true');

    const header = document.createElement('header');
    header.className = 'am-modal-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'am-modal-title-wrap';
    const heading = document.createElement('h2');
    heading.id = 'am-scorecard-heading';
    heading.className = 'am-modal-title';
    heading.textContent = 'Flight-Recorder Scorecard';
    titleWrap.appendChild(heading);

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'am-icon-close';
    this.closeBtn.setAttribute('aria-label', 'Close scorecard');
    this.closeBtn.setAttribute('data-testid', 'close-scorecard-btn');
    this.closeBtn.innerHTML = '×';
    this.closeBtn.addEventListener('click', () => this.close());

    header.append(titleWrap, this.closeBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'am-modal-body';

    const footer = document.createElement('footer');
    footer.className = 'am-modal-footer';

    const exportGroup = document.createElement('div');
    exportGroup.className = 'am-modal-export-group';

    this.exportJsonBtn = document.createElement('button');
    this.exportJsonBtn.type = 'button';
    this.exportJsonBtn.className = 'am-btn am-btn-secondary';
    this.exportJsonBtn.setAttribute('data-testid', 'export-json-btn');
    this.exportJsonBtn.textContent = 'Export JSON';
    this.exportJsonBtn.addEventListener('click', () => {
      if (this.currentResult) {
        ScorecardExporter.exportJSON(this.currentResult);
      }
    });

    this.exportCsvBtn = document.createElement('button');
    this.exportCsvBtn.type = 'button';
    this.exportCsvBtn.className = 'am-btn am-btn-secondary';
    this.exportCsvBtn.setAttribute('data-testid', 'export-csv-btn');
    this.exportCsvBtn.textContent = 'Export CSV';
    this.exportCsvBtn.addEventListener('click', () => {
      if (this.currentResult) {
        ScorecardExporter.exportCSV(this.currentResult);
      }
    });

    this.exportPngBtn = document.createElement('button');
    this.exportPngBtn.type = 'button';
    this.exportPngBtn.className = 'am-btn am-btn-secondary';
    this.exportPngBtn.setAttribute('data-testid', 'export-png-btn');
    this.exportPngBtn.textContent = 'Shareable PNG';
    this.exportPngBtn.addEventListener('click', () => {
      if (!this.currentResult) return;
      this.exportPngBtn.disabled = true;
      this.exportPngBtn.textContent = 'Rendering PNG…';
      void ScorecardExporter.exportPNG(this.currentResult).finally(() => {
        this.exportPngBtn.disabled = false;
        this.exportPngBtn.textContent = 'Shareable PNG';
      });
    });

    exportGroup.append(this.exportJsonBtn, this.exportCsvBtn, this.exportPngBtn);

    const actionGroup = document.createElement('div');
    actionGroup.className = 'am-modal-action-group';

    const inspectBtn = document.createElement('button');
    inspectBtn.type = 'button';
    inspectBtn.className = 'am-btn am-btn-ghost';
    inspectBtn.textContent = 'Inspect Viewport';
    inspectBtn.addEventListener('click', () => this.close());

    this.runAgainBtn = document.createElement('button');
    this.runAgainBtn.type = 'button';
    this.runAgainBtn.className = 'am-btn am-btn-primary';
    this.runAgainBtn.textContent = 'Run Again';
    this.runAgainBtn.addEventListener('click', () => {
      this.close();
      this.onRunAgain();
    });

    actionGroup.append(inspectBtn, this.runAgainBtn);
    footer.append(exportGroup, actionGroup);

    this.dialog.append(this.liveRegionEl, header, this.bodyEl, footer);
    this.backdrop.appendChild(this.dialog);
    parent.appendChild(this.backdrop);
  }

  public isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  public open(result: BenchmarkResult): void {
    this.currentResult = result;
    this.renderResult(result);
    this.backdrop.hidden = false;
    this.liveRegionEl.textContent = `Benchmark complete. Composite score ${result.compositeScore}, ${result.tier.badge}, confidence ${result.confidence}.`;
    this.closeBtn.focus();
  }

  public close(): void {
    if (this.backdrop.hidden) return;
    if (this.countUpRafId !== null) {
      cancelAnimationFrame(this.countUpRafId);
      this.countUpRafId = null;
    }
    this.backdrop.hidden = true;
    this.onCloseCallback();
  }

  public dispose(): void {
    if (this.countUpRafId !== null) {
      cancelAnimationFrame(this.countUpRafId);
      this.countUpRafId = null;
    }
    this.backdrop.remove();
  }

  private renderResult(result: BenchmarkResult): void {
    this.bodyEl.innerHTML = '';

    // Asymmetric Hero Grid: Dominant Score Column (left) + Telemetry & Env Column (right)
    const hero = document.createElement('div');
    hero.className = 'am-score-hero-asym';

    const scoreCol = document.createElement('div');
    scoreCol.className = 'am-score-dominant-col';

    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'am-score-label';
    scoreLabel.textContent = 'COMPOSITE GPU SCORE';

    const scoreValue = document.createElement('div');
    scoreValue.className = 'am-score-value num';
    scoreValue.setAttribute('data-testid', 'scorecard-composite');
    scoreValue.textContent = '0';

    const badgesRow = document.createElement('div');
    badgesRow.className = 'am-score-badges-row';

    const tierBadge = document.createElement('span');
    tierBadge.className = 'am-tier-badge am-tier-reveal';
    tierBadge.setAttribute('data-testid', 'scorecard-tier-badge');
    tierBadge.textContent = result.tier.badge;
    tierBadge.style.color = result.tier.color;
    tierBadge.style.borderColor = result.tier.color;
    tierBadge.style.backgroundColor = `${result.tier.color}1f`;

    const confBadge = document.createElement('span');
    confBadge.className = 'am-conf-badge';
    confBadge.setAttribute('data-testid', 'scorecard-confidence');
    const confColor = getConfidenceColor(result.confidence);
    confBadge.textContent = `CONFIDENCE: ${result.confidence.toUpperCase()}`;
    confBadge.style.color = confColor;
    confBadge.style.borderColor = `${confColor}66`;
    confBadge.style.backgroundColor = `${confColor}18`;

    const boundChip = document.createElement('span');
    boundChip.className = 'am-bound-chip';
    boundChip.textContent = formatBoundVerdict(result.boundVerdict);

    badgesRow.append(tierBadge, confBadge, boundChip);

    const tierTitle = document.createElement('div');
    tierTitle.className = 'am-tier-title';
    tierTitle.textContent = result.tier.label;

    const tierSummary = document.createElement('p');
    tierSummary.className = 'am-tier-summary';
    tierSummary.textContent = result.tier.summary;

    scoreCol.append(scoreLabel, scoreValue, badgesRow, tierTitle, tierSummary);

    // Right Environment & Summary Column
    const envCol = document.createElement('div');
    envCol.className = 'am-score-env-card';

    const envMeta = document.createElement('div');
    envMeta.className = 'am-env-grid';
    envMeta.append(
      this.createEnvRow('GPU Renderer', result.gpu.renderer),
      this.createEnvRow('Vendor & API', `${result.gpu.vendor} · ${result.gpu.webglVersion}`),
      this.createEnvRow('Median FPS', `${formatFps(result.overallMedianFps)} fps`),
      this.createEnvRow('1% Low FPS', `${formatFps(result.overallOnePercentLowFps)} fps`),
      this.createEnvRow(
        'Profile / Scale',
        `${result.presetId.toUpperCase()} · ${result.resolutionScale.toFixed(2)}× res · ${Math.round(result.instanceScale * 100)}% inst`,
      ),
      this.createEnvRow('Seed / Version', `${formatSeedHex(result.seed)} · v${result.version}`),
      this.createEnvRow('Timestamp', formatTimestamp(result.timestamp)),
    );
    envCol.appendChild(envMeta);

    hero.append(scoreCol, envCol);
    this.bodyEl.appendChild(hero);

    // Warnings Panel (if any)
    if (result.warnings.length > 0) {
      const warnBox = document.createElement('div');
      warnBox.className = 'am-warnings-box';
      warnBox.setAttribute('data-testid', 'scorecard-warnings');
      const warnHead = document.createElement('div');
      warnHead.className = 'am-warnings-title';
      warnHead.textContent = `INSTRUMENTATION WARNINGS (${result.warnings.length})`;
      const warnList = document.createElement('ul');
      warnList.className = 'am-warnings-list';
      for (const w of result.warnings) {
        const li = document.createElement('li');
        li.textContent = w;
        warnList.appendChild(li);
      }
      warnBox.append(warnHead, warnList);
      this.bodyEl.appendChild(warnBox);
    }

    // Per-stage Timeline Strip
    const timelineWrap = document.createElement('div');
    timelineWrap.className = 'am-timeline-strip-wrap';
    const timelineTitle = document.createElement('div');
    timelineTitle.className = 'am-section-title';
    timelineTitle.textContent = 'STAGE WEIGHT & SCORE TIMELINE';
    const timelineStrip = document.createElement('div');
    timelineStrip.className = 'am-timeline-strip';
    const maxStageScore = Math.max(1, ...result.stages.map((s) => s.stageScore));
    for (const s of result.stages) {
      const seg = document.createElement('div');
      seg.className = 'am-timeline-seg';
      seg.style.flexGrow = String(Math.max(0.1, s.weight));
      const pct = Math.round((s.stageScore / maxStageScore) * 100);
      seg.innerHTML = `
        <div class="am-timeline-seg-head">
          <span>${s.id.toUpperCase()}</span>
          <span class="num">${formatNumber(s.stageScore)}</span>
        </div>
        <div class="am-timeline-bar"><div class="am-timeline-fill" style="width:${pct}%;background:${result.tier.color}"></div></div>
      `;
      timelineStrip.appendChild(seg);
    }
    timelineWrap.append(timelineTitle, timelineStrip);
    this.bodyEl.appendChild(timelineWrap);

    // Per-stage breakdown table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'am-stage-table-wrap';

    const tableTitle = document.createElement('h3');
    tableTitle.className = 'am-section-title';
    tableTitle.textContent = 'PER-STAGE TELEMETRY BREAKDOWN';

    const table = document.createElement('table');
    table.className = 'am-stage-table';
    table.setAttribute('data-testid', 'scorecard-stage-table');

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Stage</th>
        <th class="num">Wt</th>
        <th class="num">Med FPS</th>
        <th class="num">1% Low</th>
        <th class="num">P95 ms</th>
        <th class="num">CV / Stut</th>
        <th class="num">GPU Time</th>
        <th>Conf</th>
        <th class="num">Score</th>
      </tr>
    `;

    const tbody = document.createElement('tbody');
    for (let i = 0; i < result.stages.length; i++) {
      const s = result.stages[i]!;
      const tr = document.createElement('tr');
      tr.className = 'am-stagger-row';
      tr.style.animationDelay = `${i * 55}ms`;
      const sConfColor = getConfidenceColor(s.confidence);
      tr.innerHTML = `
        <td>
          <div class="am-td-stage-name">${s.name}</div>
          <div class="am-td-stage-meta">${formatBoundVerdict(s.boundVerdict)} · ${formatCompactCount(s.avgTriangles)} tris</div>
        </td>
        <td class="num">${(s.weight * 100).toFixed(0)}%</td>
        <td class="num">${formatFps(s.medianFps)}</td>
        <td class="num">${formatFps(s.onePercentLowFps)}</td>
        <td class="num">${formatMs(s.p95FrameTimeMs)}</td>
        <td class="num">${(s.cv * 100).toFixed(1)}% · ${s.stutterCount}</td>
        <td class="num">${formatGpuTimeMs(s.gpuTimeMs)}</td>
        <td><span class="am-mini-conf" style="color:${sConfColor}">${s.confidence.toUpperCase()}</span></td>
        <td class="num am-td-score">${formatNumber(s.stageScore)}</td>
      `;
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    tableWrap.append(tableTitle, table);
    this.bodyEl.appendChild(tableWrap);

    this.animateScoreCountUp(scoreValue, result.compositeScore);
  }

  private animateScoreCountUp(el: HTMLElement, target: number): void {
    if (this.countUpRafId !== null) {
      cancelAnimationFrame(this.countUpRafId);
      this.countUpRafId = null;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || target <= 0) {
      el.textContent = formatNumber(target);
      return;
    }

    const durationMs = 680;
    const startMs = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - startMs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatNumber(Math.round(target * eased));
      if (t < 1) {
        this.countUpRafId = requestAnimationFrame(step);
      } else {
        el.textContent = formatNumber(target);
        this.countUpRafId = null;
      }
    };
    this.countUpRafId = requestAnimationFrame(step);
  }

  private createEnvRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'am-env-row';
    const l = document.createElement('span');
    l.className = 'am-env-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'am-env-value num';
    v.textContent = value;
    v.title = value;
    row.append(l, v);
    return row;
  }
}
