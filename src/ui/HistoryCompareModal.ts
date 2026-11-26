import { RunHistoryStorage } from '../storage/RunHistoryStorage.ts';
import type { BenchmarkResult, StabilityReport } from '../types.ts';
import {
  formatFps,
  formatNumber,
  formatSeedHex,
  formatTimestamp,
  getConfidenceColor,
} from './format.ts';

/**
 * Modal for Run History (localStorage), side-by-side Run Comparison with delta %,
 * Personal Best marker (high-confidence only), and Stability Test decay-curve reports.
 */
export class HistoryCompareModal {
  private readonly backdrop: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;

  private selectedIds: string[] = [];

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'am-modal-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    this.dialog = document.createElement('div');
    this.dialog.className = 'am-modal';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('data-testid', 'history-modal');

    const header = document.createElement('header');
    header.className = 'am-modal-header';

    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'am-modal-title';
    this.titleEl.textContent = 'Run History & Comparison';

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'am-icon-close';
    this.closeBtn.setAttribute('aria-label', 'Close history');
    this.closeBtn.textContent = '×';
    this.closeBtn.addEventListener('click', () => this.close());

    header.append(this.titleEl, this.closeBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'am-modal-body';

    this.dialog.append(header, this.bodyEl);
    this.backdrop.appendChild(this.dialog);
    parent.appendChild(this.backdrop);
  }

  public isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  public openHistory(): void {
    this.titleEl.textContent = 'Run History & Comparison';
    this.renderHistory();
    this.backdrop.hidden = false;
    this.closeBtn.focus();
  }

  public openStabilityReport(report: StabilityReport): void {
    this.titleEl.textContent = `Stability Test Report (${report.targetDurationMin}m)`;
    this.renderStability(report);
    this.backdrop.hidden = false;
    this.closeBtn.focus();
  }

  public close(): void {
    this.backdrop.hidden = true;
  }

  public dispose(): void {
    this.backdrop.remove();
  }

  private renderHistory(): void {
    this.bodyEl.innerHTML = '';
    const store = RunHistoryStorage.load();

    if (store.runs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'am-tier-summary';
      empty.textContent = 'No benchmark runs recorded yet. Complete a benchmark run to store history locally.';
      this.bodyEl.appendChild(empty);
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'am-history-toolbar';
    const hint = document.createElement('span');
    hint.className = 'am-env-label';
    hint.textContent = `Stored runs: ${store.runs.length} · Select 2 runs to compare`;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'am-btn am-btn-ghost';
    clearBtn.textContent = 'Clear All';
    clearBtn.addEventListener('click', () => {
      RunHistoryStorage.clearAll();
      this.selectedIds = [];
      this.renderHistory();
    });
    toolbar.append(hint, clearBtn);
    this.bodyEl.appendChild(toolbar);

    // Side-by-side comparison if 2 runs selected
    if (this.selectedIds.length === 2) {
      const runA = store.runs.find((r) => r.id === this.selectedIds[0]);
      const runB = store.runs.find((r) => r.id === this.selectedIds[1]);
      if (runA && runB) {
        this.bodyEl.appendChild(this.renderComparison(runA, runB));
      }
    }

    const list = document.createElement('div');
    list.className = 'am-history-list';

    for (const run of store.runs) {
      const isPb = run.id === store.personalBestId;
      const isSelected = this.selectedIds.includes(run.id);

      const row = document.createElement('div');
      row.className = `am-history-row${isSelected ? ' is-selected' : ''}`;

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = isSelected;
      check.setAttribute('aria-label', `Select run ${run.id} for comparison`);
      check.addEventListener('change', () => {
        if (check.checked) {
          if (this.selectedIds.length >= 2) this.selectedIds.shift();
          this.selectedIds.push(run.id);
        } else {
          this.selectedIds = this.selectedIds.filter((id) => id !== run.id);
        }
        this.renderHistory();
      });

      const info = document.createElement('div');
      info.className = 'am-history-info';
      const pbTag = isPb ? '<span class="am-pb-badge">PB</span>' : '';
      const confColor = getConfidenceColor(run.confidence);
      info.innerHTML = `
        <div class="am-history-top">
          <strong class="num">${formatNumber(run.compositeScore)}</strong>
          <span class="am-mini-conf" style="color:${run.tier.color}">${run.tier.badge}</span>
          <span class="am-mini-conf" style="color:${confColor}">${run.confidence.toUpperCase()}</span>
          ${pbTag}
          <span class="am-history-preset">${run.presetId.toUpperCase()} · ${run.resolutionScale.toFixed(2)}×</span>
        </div>
        <div class="am-history-meta num">${formatTimestamp(run.timestamp)} · Med ${formatFps(run.overallMedianFps)} fps · Seed ${formatSeedHex(run.seed)}</div>
      `;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'am-btn am-btn-ghost';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        RunHistoryStorage.deleteRun(run.id);
        this.selectedIds = this.selectedIds.filter((id) => id !== run.id);
        this.renderHistory();
      });

      row.append(check, info, delBtn);
      list.appendChild(row);
    }

    this.bodyEl.appendChild(list);
  }

  private renderComparison(a: BenchmarkResult, b: BenchmarkResult): HTMLElement {
    const box = document.createElement('div');
    box.className = 'am-compare-box';

    const scoreDelta = formatDeltaHtml(b.compositeScore, a.compositeScore);
    const fpsDelta = formatDeltaHtml(b.overallMedianFps, a.overallMedianFps);

    let stageRows = '';
    for (let i = 0; i < a.stages.length; i++) {
      const sa = a.stages[i]!;
      const sb = b.stages.find((s) => s.id === sa.id);
      if (!sb) continue;
      stageRows += `
        <tr>
          <td>${sa.name}</td>
          <td class="num">${formatNumber(sa.stageScore)}</td>
          <td class="num">${formatNumber(sb.stageScore)}</td>
          <td class="num">${formatDeltaHtml(sb.stageScore, sa.stageScore)}</td>
        </tr>
      `;
    }

    box.innerHTML = `
      <div class="am-section-title">SIDE-BY-SIDE COMPARISON (B vs A)</div>
      <div class="am-compare-summary num">
        <span>Composite: ${formatNumber(a.compositeScore)} → ${formatNumber(b.compositeScore)} ${scoreDelta}</span>
        <span>Median FPS: ${formatFps(a.overallMedianFps)} → ${formatFps(b.overallMedianFps)} ${fpsDelta}</span>
      </div>
      <table class="am-stage-table">
        <thead><tr><th>Stage</th><th class="num">Run A</th><th class="num">Run B</th><th class="num">Delta</th></tr></thead>
        <tbody>${stageRows}</tbody>
      </table>
    `;
    return box;
  }

  private renderStability(report: StabilityReport): void {
    this.bodyEl.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'am-warnings-box';
    summary.style.borderColor = report.throttled ? 'var(--fault)' : 'var(--signal)';
    summary.style.background = report.throttled
      ? 'rgba(255, 93, 71, 0.08)'
      : 'rgba(52, 211, 153, 0.08)';
    summary.innerHTML = `
      <div class="am-warnings-title" style="color:${report.throttled ? 'var(--fault)' : 'var(--signal)'}">
        ${report.throttled ? 'THROTTLING DETECTED' : 'THERMALLY STABLE'} · SUSTAINED RATIO ${(report.sustainedRatio * 100).toFixed(1)}%
      </div>
      <div class="am-tier-summary">${report.verdict}</div>
      <div class="am-history-meta num" style="margin-top:6px">
        Loops: ${report.loopsCompleted} · Peak: ${formatNumber(report.peakScore)} · Sustained: ${formatNumber(report.sustainedScore)} · Elapsed: ${report.actualDurationSec}s
      </div>
    `;
    this.bodyEl.appendChild(summary);

    // FPS-decay canvas plot
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 200;
    canvas.style.width = '100%';
    canvas.style.height = '180px';
    canvas.style.border = '1px solid var(--rule)';
    canvas.style.borderRadius = '4px';
    canvas.style.background = '#090b0f';
    this.drawDecayCurve(canvas, report);
    this.bodyEl.appendChild(canvas);
  }

  private drawDecayCurve(canvas: HTMLCanvasElement, report: StabilityReport): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || report.samples.length === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const pad = 28;
    const maxFps = Math.max(10, ...report.samples.map((s) => s.medianFps)) * 1.15;

    ctx.fillStyle = '#090b0f';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = report.throttled ? '#ff5d47' : '#34d399';
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    const n = report.samples.length;
    for (let i = 0; i < n; i++) {
      const s = report.samples[i]!;
      const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2);
      const y = h - pad - (s.medianFps / maxFps) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#9aa4b2';
    ctx.font = '500 12px "JetBrains Mono", monospace';
    for (let i = 0; i < n; i++) {
      const s = report.samples[i]!;
      const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2);
      const y = h - pad - (s.medianFps / maxFps) * (h - pad * 2);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#eef2f7';
      ctx.fill();
      ctx.fillText(`${formatFps(s.medianFps)}`, x - 12, Math.max(14, y - 10));
    }
  }
}

function formatDeltaHtml(next: number, prev: number): string {
  if (prev <= 0) return '<span>—</span>';
  const pct = ((next - prev) / prev) * 100;
  const sign = pct >= 0 ? '▲' : '▼';
  const color = pct >= 0 ? 'var(--signal)' : 'var(--fault)';
  return `<span style="color:${color}">${sign} ${Math.abs(pct).toFixed(1)}%</span>`;
}
