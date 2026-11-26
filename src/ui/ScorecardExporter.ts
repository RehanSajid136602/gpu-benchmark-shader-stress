import type { BenchmarkResult } from '../types.ts';
import {
  formatCompactCount,
  formatFps,
  formatMs,
  formatNumber,
  formatTimestamp,
  truncateText,
} from './format.ts';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 780;
const EXPORT_SCALE = 2;

/**
 * Handles downloading BenchmarkResult as formatted JSON or rendering
 * a high-resolution PNG scorecard onto an offscreen canvas.
 */
export class ScorecardExporter {
  public static exportJSON(result: BenchmarkResult): void {
    const json = JSON.stringify(result, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const filename = `aethermark-${result.id}.json`;
    triggerBlobDownload(blob, filename);
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

    // Card background & outer frame
    ctx.fillStyle = '#090a0e';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Top accent bar matching tier color
    const tierColor = result.tier.color || '#4cb3f0';
    ctx.fillStyle = tierColor;
    ctx.fillRect(0, 0, CARD_WIDTH, 4);

    // Inner card container
    const padX = 48;
    ctx.strokeStyle = '#242630';
    ctx.lineWidth = 1;
    ctx.strokeRect(24.5, 24.5, CARD_WIDTH - 49, CARD_HEIGHT - 49);

    // Header row
    ctx.fillStyle = '#f3f4f6';
    ctx.font = '600 22px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('AetherMark: WebGL2 GPU Benchmark Scorecard', padX, 48);

    ctx.fillStyle = '#9a9da6';
    ctx.font = '500 13px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
    ctx.textAlign = 'right';
    ctx.fillText(`${result.id}  ·  ${formatTimestamp(result.timestamp)}`, CARD_WIDTH - padX, 52);

    // Structural divider
    drawDivider(ctx, padX, 88, CARD_WIDTH - padX);

    // Left Hero: Composite Score & Hardware Tier
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9a9da6';
    ctx.font = '500 13px "Inter", system-ui, sans-serif';
    ctx.fillText('Composite GPU Score', padX, 110);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 64px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
    ctx.fillText(formatNumber(result.compositeScore), padX, 134);

    // Tier pill badge
    const badgeY = 212;
    const badgeText = result.tier.badge.toUpperCase();
    ctx.font = '700 13px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
    const badgeW = Math.ceil(ctx.measureText(badgeText).width) + 24;
    ctx.fillStyle = hexToRgba(tierColor, 0.16);
    drawRoundedRect(ctx, padX, badgeY, badgeW, 28, 4);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(tierColor, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = tierColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, padX + 12, badgeY + 14);

    ctx.fillStyle = '#f3f4f6';
    ctx.font = '600 16px "Inter", system-ui, sans-serif';
    ctx.fillText(result.tier.label, padX + badgeW + 14, badgeY + 14);

    // Tier summary wrapped neatly
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#a1a5b0';
    ctx.font = '400 13px "Inter", system-ui, sans-serif';
    drawWrappedText(ctx, result.tier.summary, padX, 254, 480, 19, 3);

    // Right Hero: Hardware & Run Environment Box
    const envX = 580;
    const envY = 108;
    const envW = CARD_WIDTH - padX - envX;
    const envH = 200;

    ctx.fillStyle = '#111218';
    drawRoundedRect(ctx, envX, envY, envW, envH, 6);
    ctx.fill();
    ctx.strokeStyle = '#242630';
    ctx.stroke();

    ctx.fillStyle = '#9a9da6';
    ctx.font = '500 12px "Inter", system-ui, sans-serif';
    ctx.fillText('GPU Renderer', envX + 20, envY + 16);

    ctx.fillStyle = '#f3f4f6';
    ctx.font = '500 13px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
    drawWrappedText(ctx, result.gpu.renderer, envX + 20, envY + 35, envW - 40, 17, 2);

    ctx.fillStyle = '#828794';
    ctx.font = '400 12px "Inter", system-ui, sans-serif';
    const envDetails = fitTextToWidth(
      ctx,
      `${result.gpu.vendor}  ·  ${result.gpu.webglVersion}`,
      envW - 40,
    );
    ctx.fillText(envDetails, envX + 20, envY + 74);

    drawDivider(ctx, envX + 20, envY + 98, envX + envW - 20);

    // 4-cell summary inside environment box
    const statItems = [
      { label: 'Overall Avg', value: `${formatFps(result.overallAvgFps)} fps` },
      { label: '1% Low', value: `${formatFps(result.overallOnePercentLowFps)} fps` },
      { label: 'Resolution Scale', value: `${result.resolutionScale.toFixed(2)}×` },
      { label: 'Duration', value: `${result.durationSec.toFixed(1)} s` },
    ];
    const colW = (envW - 40) / 4;
    for (let i = 0; i < statItems.length; i++) {
      const item = statItems[i]!;
      const sx = envX + 20 + i * colW;
      ctx.fillStyle = '#828794';
      ctx.font = '500 12px "Inter", system-ui, sans-serif';
      ctx.fillText(item.label, sx, envY + 118);

      ctx.fillStyle = '#f3f4f6';
      ctx.font = '600 18px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
      ctx.fillText(item.value, sx, envY + 142);
    }

    // Per-Stage Breakdown Section
    const tableTop = 340;
    ctx.fillStyle = '#f3f4f6';
    ctx.font = '600 16px "Inter", system-ui, sans-serif';
    ctx.fillText('Per-Stage Workload Breakdown', padX, tableTop);

    const headerY = tableTop + 36;
    const cols = {
      stage: padX,
      avgFps: 455,
      lowFps: 575,
      frameMs: 705,
      draws: 820,
      tris: 945,
      score: CARD_WIDTH - padX,
    };

    ctx.fillStyle = '#828794';
    ctx.font = '500 12px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Stage', cols.stage, headerY);
    ctx.textAlign = 'right';
    ctx.fillText('Avg FPS', cols.avgFps, headerY);
    ctx.fillText('1% Low', cols.lowFps, headerY);
    ctx.fillText('Avg Frame', cols.frameMs, headerY);
    ctx.fillText('Draw Calls', cols.draws, headerY);
    ctx.fillText('Triangles', cols.tris, headerY);
    ctx.fillText('Stage Score', cols.score, headerY);

    drawDivider(ctx, padX, headerY + 24, CARD_WIDTH - padX, '#2c2f3b');

    const maxStageScore = Math.max(
      1,
      ...result.stages.map((s) => s.stageScore),
    );

    const rowPitch = 78;
    result.stages.slice(0, 4).forEach((stage, index) => {
      const ry = headerY + 42 + index * rowPitch;

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f3f4f6';
      ctx.font = '600 15px "Inter", system-ui, sans-serif';
      ctx.fillText(truncateText(stage.name, 34), cols.stage, ry);

      ctx.fillStyle = '#828794';
      ctx.font = '400 12px "Inter", system-ui, sans-serif';
      ctx.fillText(`Weight ${stage.weight.toFixed(2)}× · ${stage.sampleCount} samples`, cols.stage, ry + 22);

      // Score proportion bar underneath stage info
      const barWidth = 280;
      const barY = ry + 44;
      ctx.fillStyle = '#191b23';
      drawRoundedRect(ctx, cols.stage, barY, barWidth, 5, 2.5);
      ctx.fill();

      const ratio = Math.max(0.02, Math.min(1, stage.stageScore / maxStageScore));
      ctx.fillStyle = '#4cb3f0';
      drawRoundedRect(ctx, cols.stage, barY, Math.round(barWidth * ratio), 5, 2.5);
      ctx.fill();

      ctx.textAlign = 'right';
      ctx.fillStyle = '#f3f4f6';
      ctx.font = '600 15px "JetBrains Mono", "Fira Code", ui-monospace, monospace'; /* taste-skill-ignore */
      ctx.fillText(formatFps(stage.avgFps), cols.avgFps, ry + 6);

      ctx.fillStyle = '#d1d5db';
      ctx.fillText(formatFps(stage.onePercentLowFps), cols.lowFps, ry + 6);
      ctx.fillText(`${formatMs(stage.avgFrameTimeMs)} ms`, cols.frameMs, ry + 6);
      ctx.fillText(formatNumber(stage.avgDrawCalls), cols.draws, ry + 6);
      ctx.fillText(formatCompactCount(stage.avgTriangles), cols.tris, ry + 6);

      ctx.fillStyle = '#4cb3f0';
      ctx.fillText(formatNumber(stage.stageScore), cols.score, ry + 6);

      if (index < Math.min(4, result.stages.length) - 1) {
        drawDivider(ctx, padX, ry + 62, CARD_WIDTH - padX, '#1b1d26');
      }
    });

    // Footer bar
    drawDivider(ctx, padX, CARD_HEIGHT - 68, CARD_WIDTH - padX);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#828794';
    ctx.font = '400 12px "Inter", system-ui, sans-serif';
    ctx.fillText(
      'Generated locally via WebGL2 GPU Benchmark & Shader Stress Test',
      padX,
      CARD_HEIGHT - 50,
    );
    ctx.textAlign = 'right';
    ctx.fillText(`Max Texture ${result.gpu.maxTextureSize}px`, CARD_WIDTH - padX, CARD_HEIGHT - 50);

    return canvas;
  }

  public static async exportPNG(result: BenchmarkResult): Promise<void> {
    const canvas = ScorecardExporter.renderScorecardCanvas(result);
    const filename = `aethermark-scorecard-${result.id}.png`;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((generated) => resolve(generated), 'image/png');
    });

    if (blob) {
      triggerBlobDownload(blob, filename);
      return;
    }

    const dataUrl = canvas.toDataURL('image/png');
    triggerUrlDownload(dataUrl, filename);
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerUrlDownload(url, filename);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}

function triggerUrlDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function drawDivider(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y: number,
  x2: number,
  color = '#242630',
): void {
  const crispY = Math.round(y) + 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, crispY);
  ctx.lineTo(x2, crispY);
  ctx.stroke();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
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
  let currentY = y;
  let linesDrawn = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      linesDrawn += 1;
      currentY += lineHeight;
      if (linesDrawn >= maxLines - 1) {
        const rest = [word, ...words.slice(i + 1)].join(' ');
        ctx.fillText(fitTextToWidth(ctx, rest, maxWidth), x, currentY);
        return;
      }
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(fitTextToWidth(ctx, line, maxWidth), x, currentY);
  }
}

function fitTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}...`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}...`;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) {
    return `rgba(56, 189, 248, ${alpha})`;
  }
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) {
    return `rgba(56, 189, 248, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
