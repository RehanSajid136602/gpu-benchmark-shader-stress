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
  if (fps >= 55) return '#3fc07a';
  if (fps >= 30) return '#d9a441';
  return '#e5566f';
}

export function getFrameTimeSeverityColor(ms: number): string {
  if (ms <= 17.5) return '#3fc07a';
  if (ms <= 33.33) return '#d9a441';
  return '#e5566f';
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}
