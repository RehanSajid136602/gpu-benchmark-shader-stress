import type { BenchmarkResult } from '../types.ts';
import {
  formatBoundVerdict,
  formatCompactCount,
  formatFps,
  formatGpuTimeMs,
  formatNumber,
  formatSeedHex,
  formatTimestamp,
  getConfidenceColor,
  truncateText,
} from './format.ts';

const CARD_WIDTH = 1240;
const CARD_HEIGHT = 820;
const EXPORT_SCALE = 2;

/**
 * Handles downloading BenchmarkResult as JSON, CSV, or rendering
 * a flight-recorder PNG scorecard onto an offscreen canvas.
 */
export class ScorecardExporter {
  public static exportJSON(result: BenchmarkResult): void {
    const json = JSON.stringify(result, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    triggerBlobDownload(blob, `aethermark-${result.id}.json`);
  }

  public static exportCSV(result: BenchmarkResult): void {
    const headers = [
      'run_id',
      'version',
      'timestamp',
      'seed',
      'preset',
      'resolution_scale',
      'instance_scale',
      'gpu_renderer',
      'gpu_vendor',
      'composite_score',
      'tier_badge',
      'run_confidence',
      'run_bound_verdict',
      'stage_id',
      'stage_name',
      'stage_weight',
      'stage_score',
      'median_fps',
      'avg_fps',
      'min_fps',
      'max_fps',
      'one_pct_low_fps',
      'median_frame_ms',
      'p95_frame_ms',
      'p99_frame_ms',
      'mad_ms',
      'cv',
      'stutter_count',
      'throttled',
      'vsync_pinned',
      'vsync_target_hz',
      'stage_confidence',
      'gpu_time_ms',
      'stage_bound_verdict',
      'avg_draw_calls',
      'avg_triangles',
      'sample_count',
      'warmup_discarded',
    ];

    const rows = result.stages.map((s) => [
      result.id,
      result.version,
      result.timestamp,
      formatSeedHex(result.seed),
      result.presetId,
      result.resolutionScale,
      result.instanceScale,
      result.gpu.renderer,
      result.gpu.vendor,
      result.compositeScore,
      result.tier.badge,
      result.confidence,
      result.boundVerdict,
      s.id,
      s.name,
      s.weight,
      s.stageScore,
      s.medianFps,
      s.avgFps,
      s.minFps,
      s.maxFps,
      s.onePercentLowFps,
      s.medianFrameTimeMs,
      s.p95FrameTimeMs,
      s.p99FrameTimeMs,
      s.madMs,
      s.cv,
      s.stutterCount,
      s.throttled,
      s.vsyncPinned,
      s.vsyncTargetHz ?? '',
      s.confidence,
      s.gpuTimeMs ?? 'unavailable',
      s.boundVerdict,
      s.avgDrawCalls,
      s.avgTriangles,
      s.sampleCount,
      s.warmupDiscardedCount,
    ]);

    const csvLines = [
      headers.join(','),
      ...rows.map((r) => r.map(escapeCsvCell).join(',')),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
    triggerBlobDownload(blob, `aethermark-${result.id}.csv`);
  }

  public static renderScorecardCanvas(result: BenchmarkResult): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH * EXPORT_SCALE;
    canvas.height = CARD_HEIGHT * EXPORT_SCALE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create offscreen 2D context for PNG scorecard export.');
    }

    ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

    // Carbon base
    ctx.fillStyle = '#090b0f';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Top accent bar matching tier color
    const tierColor = result.tier.color || '#34d399';
    ctx.fillStyle = tierColor;
    ctx.fillRect(0, 0, CARD_WIDTH, 4);

    // Outer hairline frame
    const padX = 48;
    ctx.strokeStyle = '#202632';
    ctx.lineWidth = 1;
    ctx.strokeRect(24.5, 24.5, CARD_WIDTH - 49, CARD_HEIGHT - 49);

    // Header row
    ctx.fillStyle = '#eef2f7';
    ctx.font = '700 22px "Bricolage Grotesque", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('AETHERMARK // FLIGHT RECORDER SCORECARD', padX, 46);

    ctx.fillStyle = '#8b95a5';
    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(
      `v${result.version}  ·  ${result.id}  ·  ${formatTimestamp(result.timestamp)}`,
      CARD_WIDTH - padX,
      50,
    );

    drawDivider(ctx, padX, 86, CARD_WIDTH - padX);

    // Left Dominant Score Column
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b95a5';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillText('COMPOSITE GPU SCORE (MEDIAN-WEIGHTED)', padX, 108);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 72px "JetBrains Mono", monospace';
    ctx.fillText(formatNumber(result.compositeScore), padX, 130);

    // Tier + Confidence + Bound pills
    let pillX = padX;
    const pillY = 218;
    pillX += drawPill(ctx, pillX, pillY, result.tier.badge.toUpperCase(), tierColor) + 10;
    const confColor = getConfidenceColor(result.confidence);
    pillX += drawPill(ctx, pillX, pillY, `CONFIDENCE: ${result.confidence.toUpperCase()}`, confColor) + 10;
    drawPill(ctx, pillX, pillY, formatBoundVerdict(result.boundVerdict), '#38bdf8');

    ctx.fillStyle = '#eef2f7';
    ctx.font = '600 15px "Bricolage Grotesque", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(result.tier.label, padX, 258);

    ctx.fillStyle = '#9aa4b2';
    ctx.font = '400 12px "JetBrains Mono", monospace';
    drawWrappedText(ctx, result.tier.summary, padX, 282, 500, 18, 2);

    // Right Environment Box
    const envX = 590;
    const envY = 108;
    const envW = CARD_WIDTH - padX - envX;
    const envH = 212;

    ctx.fillStyle = '#0e1218';
    drawRoundedRect(ctx, envX, envY, envW, envH, 4);
    ctx.fill();
    ctx.strokeStyle = '#202632';
    ctx.stroke();

    ctx.fillStyle = '#8b95a5';
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillText('GPU RENDERER', envX + 20, envY + 16);

    ctx.fillStyle = '#eef2f7';
    ctx.font = '600 13px "JetBrains Mono", monospace';
    drawWrappedText(ctx, result.gpu.renderer, envX + 20, envY + 35, envW - 40, 17, 2);

    ctx.fillStyle = '#7e8897';
    ctx.font = '400 11px "JetBrains Mono", monospace';
    const envDetails = fitTextToWidth(
      ctx,
      `${result.gpu.vendor} · ${result.gpu.webglVersion} · Seed ${formatSeedHex(result.seed)}`,
      envW - 40,
    );
    ctx.fillText(envDetails, envX + 20, envY + 76);

    drawDivider(ctx, envX + 20, envY + 102, envX + envW - 20);

    const statItems = [
      { label: 'Median FPS', value: `${formatFps(result.overallMedianFps)} fps` },
      { label: '1% Low', value: `${formatFps(result.overallOnePercentLowFps)} fps` },
      { label: 'Scale / Preset', value: `${result.resolutionScale.toFixed(2)}× · ${result.presetId}` },
      { label: 'Duration', value: `${result.durationSec.toFixed(1)} s` },
    ];
    const colW = (envW - 40) / 4;
    for (let i = 0; i < statItems.length; i++) {
      const item = statItems[i]!;
      const sx = envX + 20 + i * colW;
      ctx.fillStyle = '#7e8897';
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillText(item.label, sx, envY + 122);
      ctx.fillStyle = '#eef2f7';
      ctx.font = '600 15px "JetBrains Mono", monospace';
      ctx.fillText(item.value, sx, envY + 144);
    }

    // Per-Stage Breakdown Bars
    drawDivider(ctx, padX, 344, CARD_WIDTH - padX);

    ctx.fillStyle = '#8b95a5';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillText('PER-STAGE TELEMETRY & SCORE BREAKDOWN', padX, 360);

    const maxStageScore = Math.max(1, ...result.stages.map((s) => s.stageScore));
    const rowStartY = 392;
    const rowHeight = 84;

    for (let i = 0; i < result.stages.length; i++) {
      const s = result.stages[i]!;
      const y = rowStartY + i * rowHeight;
      const boxW = CARD_WIDTH - padX * 2;

      ctx.fillStyle = '#0e1218';
      drawRoundedRect(ctx, padX, y, boxW, rowHeight - 12, 4);
      ctx.fill();
      ctx.strokeStyle = '#1e2430';
      ctx.stroke();

      // Stage title & weight
      ctx.fillStyle = '#eef2f7';
      ctx.font = '600 14px "Bricolage Grotesque", sans-serif';
      ctx.fillText(truncateText(s.name, 42), padX + 16, y + 14);

      ctx.fillStyle = '#7e8897';
      ctx.font = '400 11px "JetBrains Mono", monospace';
      ctx.fillText(
        `w ${(s.weight * 100).toFixed(0)}% · Med ${formatFps(s.medianFps)} fps · 1% Low ${formatFps(s.onePercentLowFps)} fps · CV ${(s.cv * 100).toFixed(1)}% · GPU ${formatGpuTimeMs(s.gpuTimeMs)} · ${formatCompactCount(s.avgTriangles)} tris`,
        padX + 16,
        y + 38,
      );

      // Score & confidence right-aligned
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 18px "JetBrains Mono", monospace';
      ctx.fillText(formatNumber(s.stageScore), padX + boxW - 16, y + 14);

      ctx.fillStyle = getConfidenceColor(s.confidence);
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(
        `${s.confidence.toUpperCase()} · ${formatBoundVerdict(s.boundVerdict)}`,
        padX + boxW - 16,
        y + 38,
      );
      ctx.textAlign = 'left';

      // Progress bar
      const barY = y + 58;
      const barW = boxW - 32;
      ctx.fillStyle = '#161b24';
      ctx.fillRect(padX + 16, barY, barW, 4);
      const fillW = Math.max(4, Math.round((s.stageScore / maxStageScore) * barW));
      ctx.fillStyle = tierColor;
      ctx.fillRect(padX + 16, barY, fillW, 4);
    }

    // Footer
    ctx.fillStyle = '#6c7584';
    ctx.font = '400 11px "JetBrains Mono", monospace';
    ctx.fillText(
      `AetherMark v${result.version} · Seed ${formatSeedHex(result.seed)} · https://rehansajid136602.github.io/gpu-benchmark-shader-stress/`,
      padX,
      CARD_HEIGHT - 48,
    );

    return canvas;
  }

  public static async exportPNG(result: BenchmarkResult): Promise<void> {
    const canvas = ScorecardExporter.renderScorecardCanvas(result);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) {
      throw new Error('Failed to encode PNG scorecard blob.');
    }
    triggerBlobDownload(blob, `aethermark-${result.id}.png`);
  }
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
): number {
  ctx.font = '700 11px "JetBrains Mono", monospace';
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  ctx.fillStyle = hexToRgba(color, 0.14);
  drawRoundedRect(ctx, x, y, w, 24, 3);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 10, y + 12);
  ctx.textBaseline = 'top';
  return w;
}

function drawDivider(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number): void {
  ctx.strokeStyle = '#202632';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/);
  let line = '';
  let lineCount = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      lineCount += 1;
      line = word;
      if (lineCount >= maxLines - 1) {
        const remaining = [line, ...words.slice(i + 1)].join(' ');
        ctx.fillText(fitTextToWidth(ctx, remaining, maxWidth), x, y + lineCount * lineHeight);
        return;
      }
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + lineCount * lineHeight);
  }
}

function fitTextToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 3 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(52, 211, 153, ${alpha})`;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeCsvCell(value: string | number | boolean): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1500);
}
