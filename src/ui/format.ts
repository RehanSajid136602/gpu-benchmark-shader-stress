import type { BoundVerdict, ConfidenceRating } from '../types.ts';

export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const rounded = Math.round(value);
  if (rounded >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(2)}M`;
  }
  if (rounded >= 10_000) {
    return `${(rounded / 1_000).toFixed(1)}K`;
  }
  return rounded.toLocaleString('en-US');
}

export function formatFps(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

export function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return value >= 100 ? value.toFixed(1) : value.toFixed(2);
}

export function formatGpuTimeMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  return `${formatMs(value)} ms`;
}

export function formatSeedHex(seed: number): string {
  return `0x${(seed >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

export function formatBoundVerdict(verdict: BoundVerdict): string {
  switch (verdict) {
    case 'gpu-bound':
      return 'GPU-BOUND';
    case 'cpu-bound':
      return 'CPU-BOUND';
    case 'balanced':
      return 'BALANCED';
    case 'unavailable':
      return 'GPU TIMER UNAVAILABLE';
  }
}

export function getConfidenceColor(confidence: ConfidenceRating): string {
  switch (confidence) {
    case 'high':
      return '#34d399';
    case 'medium':
      return '#f5b841';
    case 'low':
      return '#ff5d47';
  }
}

export function formatDurationSec(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-';
  return Math.abs(seconds - Math.round(seconds)) < 0.05
    ? `${Math.round(seconds)}s`
    : `${seconds.toFixed(1)}s`;
}

export function formatResolution(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '-';
  }
  return `${Math.round(width)} x ${Math.round(height)}`;
}

export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function getFpsSeverityColor(fps: number): string {
  if (fps >= 55) return '#34d399';
  if (fps >= 30) return '#f5b841';
  return '#ff5d47';
}

export function getFrameTimeSeverityColor(ms: number): string {
  if (ms <= 17.5) return '#34d399';
  if (ms <= 33.33) return '#f5b841';
  return '#ff5d47';
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}
