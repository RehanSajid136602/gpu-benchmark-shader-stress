import type { PresetId } from '../types.ts';

export type DetectedDeviceClass = 'phone' | 'tablet' | 'laptop' | 'desktop';

export interface DeviceDetectionInfo {
  deviceClass: DetectedDeviceClass;
  label: string;
  isTouch: boolean;
  screenMinPx: number;
  screenMaxPx: number;
}

interface NavigatorUADataLike {
  mobile?: boolean;
  platform?: string;
}

/**
 * Classifies the client device into phone, tablet, laptop, or desktop using
 * User-Agent hints, touch capabilities, pointer coarseness, and screen size.
 */
export function detectDeviceClass(): DeviceDetectionInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      deviceClass: 'desktop',
      label: 'Desktop',
      isTouch: false,
      screenMinPx: 1080,
      screenMaxPx: 1920,
    };
  }

  const ua = navigator.userAgent || '';
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUADataLike }).userAgentData;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const hasCoarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const isTouch = maxTouchPoints > 0 || hasCoarsePointer;

  const sw = window.screen?.width || window.innerWidth || 1280;
  const sh = window.screen?.height || window.innerHeight || 720;
  const screenMinPx = Math.min(sw, sh);
  const screenMaxPx = Math.max(sw, sh);

  const isIPadUA =
    /iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const isAndroidTabletUA = /Android/i.test(ua) && !/Mobile/i.test(ua);
  const isGenericTabletUA = /Tablet|PlayBook|Silk|Kindle/i.test(ua);
  const isPhoneUA =
    Boolean(uaData?.mobile) ||
    /iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua) ||
    (/Android/i.test(ua) && /Mobile/i.test(ua));

  if (isIPadUA || isAndroidTabletUA || isGenericTabletUA) {
    return {
      deviceClass: 'tablet',
      label: 'Tablet',
      isTouch: true,
      screenMinPx,
      screenMaxPx,
    };
  }

  if (isPhoneUA || (isTouch && screenMinPx < 600 && screenMaxPx < 960)) {
    return {
      deviceClass: 'phone',
      label: 'Phone',
      isTouch: true,
      screenMinPx,
      screenMaxPx,
    };
  }

  if (isTouch && screenMinPx >= 600 && screenMaxPx <= 1400) {
    return {
      deviceClass: 'tablet',
      label: 'Tablet',
      isTouch: true,
      screenMinPx,
      screenMaxPx,
    };
  }

  // Distinguish likely laptop vs desktop by typical built-in panel dimensions
  if (screenMaxPx <= 1728 && screenMinPx <= 1120) {
    return {
      deviceClass: 'laptop',
      label: 'Laptop',
      isTouch,
      screenMinPx,
      screenMaxPx,
    };
  }

  return {
    deviceClass: 'desktop',
    label: 'Desktop',
    isTouch,
    screenMinPx,
    screenMaxPx,
  };
}

/**
 * Returns a non-blocking warning message when the selected benchmark preset
 * mismatches the detected device class, or null when compatible.
 */
export function getPresetDeviceWarning(
  presetId: PresetId,
  detected: DeviceDetectionInfo,
): string | null {
  if (presetId === 'custom') return null;

  const { deviceClass, label } = detected;

  if (deviceClass === 'phone') {
    if (presetId === 'tablet') {
      return `Detected ${label} device, but Tablet profile is selected. Higher resolution/instance load may reduce FPS — you can still run it.`;
    }
    if (presetId === 'laptop' || presetId === 'desktop' || presetId === 'extreme') {
      const target = presetId.charAt(0).toUpperCase() + presetId.slice(1);
      return `Detected ${label} device, but ${target} profile is selected. Expect heavy thermal/GPU load and lower FPS — you can still run it.`;
    }
  }

  if (deviceClass === 'tablet') {
    if (presetId === 'mobile') {
      return `Detected ${label} device, but Phone profile is selected. Workload is lighter than native Tablet — you can still run it.`;
    }
    if (presetId === 'desktop' || presetId === 'extreme') {
      const target = presetId.charAt(0).toUpperCase() + presetId.slice(1);
      return `Detected ${label} device, but ${target} profile is selected. Heavy desktop workload may cause throttling — you can still run it.`;
    }
  }

  if (deviceClass === 'laptop') {
    if (presetId === 'mobile' || presetId === 'tablet') {
      const target = presetId === 'mobile' ? 'Phone' : 'Tablet';
      return `Detected ${label} device, but ${target} profile is selected. Workload is scaled down for mobile GPUs — you can still run it.`;
    }
  }

  if (deviceClass === 'desktop') {
    if (presetId === 'mobile' || presetId === 'tablet') {
      const target = presetId === 'mobile' ? 'Phone' : 'Tablet';
      return `Detected ${label} device, but ${target} profile is selected. Workload is scaled down for mobile GPUs — you can still run it.`;
    }
  }

  return null;
}
