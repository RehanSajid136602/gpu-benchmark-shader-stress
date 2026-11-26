import type { BenchmarkResult } from '../types.ts';
import { ScorecardExporter } from './ScorecardExporter.ts';
import {
  formatCompactCount,
  formatFps,
  formatMs,
  formatNumber,
  formatTimestamp,
} from './format.ts';

/**
 * Modal overlay presenting the completed BenchmarkResult scorecard:
 * weighted composite GPU score, hardware tier badge, GPU specs,
 * per-stage performance breakdown table, and JSON / PNG exports.
 */
export class ScorecardModal {
  private readonly backdrop: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly exportJsonBtn: HTMLButtonElement;
  private readonly exportPngBtn: HTMLButtonElement;
  private readonly runAgainBtn: HTMLButtonElement;

  private currentResult: BenchmarkResult | null = null;
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

    const header = document.createElement('header');
    header.className = 'am-modal-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'am-modal-title-wrap';
    const heading = document.createElement('h2');
    heading.id = 'am-scorecard-heading';
    heading.className = 'am-modal-title';
    heading.textContent = 'Benchmark Scorecard';
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

    this.exportPngBtn = document.createElement('button');
    this.exportPngBtn.type = 'button';
    this.exportPngBtn.className = 'am-btn am-btn-secondary';
    this.exportPngBtn.setAttribute('data-testid', 'export-png-btn');
    this.exportPngBtn.textContent = 'Download Scorecard Image';
    this.exportPngBtn.addEventListener('click', () => {
      if (!this.currentResult) return;
      this.exportPngBtn.disabled = true;
      this.exportPngBtn.textContent = 'Rendering PNG…';
      void ScorecardExporter.exportPNG(this.currentResult).finally(() => {
        this.exportPngBtn.disabled = false;
        this.exportPngBtn.textContent = 'Download Scorecard Image';
      });
    });

    exportGroup.append(this.exportJsonBtn, this.exportPngBtn);

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

    this.dialog.append(header, this.bodyEl, footer);
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
    this.closeBtn.focus();
  }

  public close(): void {
    if (this.backdrop.hidden) return;
    this.backdrop.hidden = true;
    this.onCloseCallback();
  }

  public dispose(): void {
    this.backdrop.remove();
  }

  private renderResult(result: BenchmarkResult): void {
    this.bodyEl.replaceChildren();

    const maxScore = Math.max(1, ...result.stages.map((s) => s.stageScore));
    const tierColor = result.tier.color || '#4cb3f0';

    // Top Hero Row: Composite Score + Tier + Run Summary
    const hero = document.createElement('div');
    hero.className = 'am-score-hero';

    const scoreBlock = document.createElement('div');
    scoreBlock.className = 'am-score-lead-card';

    const scoreLabel = document.createElement('span');
    scoreLabel.className = 'am-meta-label';
    scoreLabel.textContent = 'Composite GPU Score';

    const scoreNum = document.createElement('div');
    scoreNum.className = 'am-score-value num';
    scoreNum.setAttribute('data-testid', 'scorecard-composite-score');
    scoreNum.textContent = formatNumber(result.compositeScore);

    const tierRow = document.createElement('div');
    tierRow.className = 'am-tier-row';

    const tierBadge = document.createElement('span');
    tierBadge.className = 'am-tier-badge';
    tierBadge.setAttribute('data-testid', 'scorecard-tier-badge');
    tierBadge.textContent = result.tier.badge;
    tierBadge.style.color = tierColor;
    tierBadge.style.borderColor = tierColor;

    const tierLabel = document.createElement('span');
    tierLabel.className = 'am-tier-label';
    tierLabel.textContent = result.tier.label;

    tierRow.append(tierBadge, tierLabel);

    const tierSummary = document.createElement('p');
    tierSummary.className = 'am-tier-summary';
    tierSummary.textContent = result.tier.summary;

    scoreBlock.append(scoreLabel, scoreNum, tierRow, tierSummary);

    // Hardware & Run Overview card
    const envBlock = document.createElement('div');
    envBlock.className = 'am-score-env-card';

    const envHeader = document.createElement('div');
    envHeader.className = 'am-env-header';
    const envLabel = document.createElement('span');
    envLabel.className = 'am-meta-label';
    envLabel.textContent = 'Device & Run Profile';
    const envStamp = document.createElement('span');
    envStamp.className = 'am-env-stamp num';
    envStamp.textContent = `${result.id} · ${formatTimestamp(result.timestamp)}`;
    envHeader.append(envLabel, envStamp);

    const gpuStr = document.createElement('div');
    gpuStr.className = 'am-env-gpu';
    gpuStr.setAttribute('data-testid', 'scorecard-gpu-renderer');
    gpuStr.textContent = result.gpu.renderer;

    const gpuSub = document.createElement('div');
    gpuSub.className = 'am-env-gpu-sub';
    gpuSub.textContent = `${result.gpu.vendor} · ${result.gpu.webglVersion} · MaxTex ${result.gpu.maxTextureSize}px`;

    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'am-score-summary-grid';
    summaryGrid.append(
      this.createStatCell('Overall Avg', `${formatFps(result.overallAvgFps)} fps`),
      this.createStatCell('Overall 1% Low', `${formatFps(result.overallOnePercentLowFps)} fps`),
      this.createStatCell('Resolution Scale', `${result.resolutionScale.toFixed(2)}×`),
      this.createStatCell('Duration', `${result.durationSec.toFixed(1)} s`),
    );

    envBlock.append(envHeader, gpuStr, gpuSub, summaryGrid);
    hero.append(scoreBlock, envBlock);

    // Per-Stage Breakdown Table
    const tableSection = document.createElement('div');
    tableSection.className = 'am-stage-table-wrap';

    const tableTitle = document.createElement('h3');
    tableTitle.className = 'am-table-heading';
    tableTitle.textContent = 'Per-stage breakdown';

    const tableScroll = document.createElement('div');
    tableScroll.className = 'am-table-scroll';

    const table = document.createElement('table');
    table.className = 'am-stage-table';
    table.setAttribute('data-testid', 'scorecard-stage-table');

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col">Stage</th>
        <th scope="col" class="num">Avg FPS</th>
        <th scope="col" class="num">1% Low</th>
        <th scope="col" class="num">Avg Frame</th>
        <th scope="col" class="num">Draw Calls</th>
        <th scope="col" class="num">Triangles</th>
        <th scope="col" class="num">Stage Score</th>
      </tr>
    `;

    const tbody = document.createElement('tbody');
    for (const stage of result.stages) {
      const tr = document.createElement('tr');
      const pct = Math.max(3, Math.min(100, Math.round((stage.stageScore / maxScore) * 100)));

      const nameTd = document.createElement('td');
      nameTd.className = 'am-stage-cell';
      const stageName = document.createElement('div');
      stageName.className = 'am-table-stage-name';
      stageName.textContent = stage.name;
      const stageMeta = document.createElement('div');
      stageMeta.className = 'am-table-stage-meta';
      stageMeta.textContent = `Weight ${stage.weight.toFixed(2)}× · ${stage.sampleCount} samples`;
      const bar = document.createElement('div');
      bar.className = 'am-table-bar-track';
      const fill = document.createElement('div');
      fill.className = 'am-table-bar-fill';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      nameTd.append(stageName, stageMeta, bar);

      tr.append(
        nameTd,
        this.createNumericTd(formatFps(stage.avgFps)),
        this.createNumericTd(formatFps(stage.onePercentLowFps)),
        this.createNumericTd(`${formatMs(stage.avgFrameTimeMs)} ms`),
        this.createNumericTd(formatNumber(stage.avgDrawCalls)),
        this.createNumericTd(formatCompactCount(stage.avgTriangles), `${formatNumber(stage.avgTriangles)} triangles`),
        this.createNumericTd(formatNumber(stage.stageScore), undefined, 'am-score-cell'),
      );
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    tableScroll.appendChild(table);
    tableSection.append(tableTitle, tableScroll);

    this.bodyEl.append(hero, tableSection);
  }

  private createStatCell(label: string, value: string): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'am-score-stat-cell';
    const lbl = document.createElement('span');
    lbl.className = 'am-kpi-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'am-score-stat-val num';
    val.textContent = value;
    cell.append(lbl, val);
    return cell;
  }

  private createNumericTd(text: string, title?: string, extraClass?: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = extraClass ? `num ${extraClass}` : 'num';
    td.textContent = text;
    if (title) td.title = title;
    return td;
  }
}
