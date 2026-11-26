import type { BenchmarkResult } from '../types.ts';

export const HISTORY_STORAGE_KEY = 'aethermark.run_history';
export const HISTORY_SCHEMA_VERSION = 1;
const MAX_STORED_RUNS = 50;

export interface RunHistoryStore {
  version: number;
  personalBestId: string | null;
  runs: BenchmarkResult[];
}

/**
 * Versioned localStorage persistence for benchmark runs.
 * Fail-closed: all reads/writes are try/catch-guarded so disabled, full,
 * or corrupted storage never crashes the application.
 */
export class RunHistoryStorage {
  public static load(): RunHistoryStore {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return createEmptyStore();
      }
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return createEmptyStore();

      const parsed: unknown = JSON.parse(raw);
      return RunHistoryStorage.migrate(parsed);
    } catch {
      return createEmptyStore();
    }
  }

  public static migrate(raw: unknown): RunHistoryStore {
    if (!raw || typeof raw !== 'object') {
      return createEmptyStore();
    }
    const obj = raw as Partial<RunHistoryStore>;
    const version = typeof obj.version === 'number' ? obj.version : 0;

    // Migration stub for future schema versions
    if (version < HISTORY_SCHEMA_VERSION) {
      const runs = Array.isArray(obj.runs) ? obj.runs.filter(isValidResult) : [];
      const pbId = recomputePersonalBestId(runs);
      return {
        version: HISTORY_SCHEMA_VERSION,
        personalBestId: pbId,
        runs: runs.slice(0, MAX_STORED_RUNS),
      };
    }

    const runs = Array.isArray(obj.runs) ? obj.runs.filter(isValidResult) : [];
    const personalBestId =
      typeof obj.personalBestId === 'string' &&
      runs.some((r) => r.id === obj.personalBestId && r.confidence === 'high' && !r.invalidated)
        ? obj.personalBestId
        : recomputePersonalBestId(runs);

    return {
      version: HISTORY_SCHEMA_VERSION,
      personalBestId,
      runs: runs.slice(0, MAX_STORED_RUNS),
    };
  }

  public static saveRun(result: BenchmarkResult): RunHistoryStore {
    const store = RunHistoryStorage.load();
    const deduped = store.runs.filter((r) => r.id !== result.id);
    deduped.unshift(result);
    const trimmed = deduped.slice(0, MAX_STORED_RUNS);
    const personalBestId = recomputePersonalBestId(trimmed);

    const next: RunHistoryStore = {
      version: HISTORY_SCHEMA_VERSION,
      personalBestId,
      runs: trimmed,
    };
    RunHistoryStorage.persist(next);
    return next;
  }

  public static deleteRun(id: string): RunHistoryStore {
    const store = RunHistoryStorage.load();
    const runs = store.runs.filter((r) => r.id !== id);
    const next: RunHistoryStore = {
      version: HISTORY_SCHEMA_VERSION,
      personalBestId: recomputePersonalBestId(runs),
      runs,
    };
    RunHistoryStorage.persist(next);
    return next;
  }

  public static clearAll(): RunHistoryStore {
    const empty = createEmptyStore();
    RunHistoryStorage.persist(empty);
    return empty;
  }

  private static persist(store: RunHistoryStore): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Fail closed on QuotaExceededError or private-mode restriction
    }
  }
}

function createEmptyStore(): RunHistoryStore {
  return {
    version: HISTORY_SCHEMA_VERSION,
    personalBestId: null,
    runs: [],
  };
}

function isValidResult(item: unknown): item is BenchmarkResult {
  if (!item || typeof item !== 'object') return false;
  const r = item as Partial<BenchmarkResult>;
  return (
    typeof r.id === 'string' &&
    typeof r.compositeScore === 'number' &&
    Array.isArray(r.stages) &&
    typeof r.gpu === 'object' &&
    r.gpu !== null
  );
}

/**
 * Low-confidence or invalidated runs are NEVER promoted to Personal Best.
 */
function recomputePersonalBestId(runs: readonly BenchmarkResult[]): string | null {
  let bestId: string | null = null;
  let bestScore = -1;
  for (const r of runs) {
    if (r.confidence === 'high' && !r.invalidated && r.compositeScore > bestScore) {
      bestScore = r.compositeScore;
      bestId = r.id;
    }
  }
  return bestId;
}
