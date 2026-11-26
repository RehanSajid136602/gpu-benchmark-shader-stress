export type BoundVerdict = 'gpu-bound' | 'cpu-bound' | 'balanced' | 'unavailable';

/**
 * Isolated WebGL2 timer query extension interface.
 * The only location where extension constants are declared.
 */
export interface EXTDisjointTimerQueryWebGL2 {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
}

export interface GpuTimerStats {
  available: boolean;
  lastGpuTimeMs: number | null;
  medianGpuTimeMs: number | null;
  sampleCount: number;
  disjointCount: number;
  boundVerdict: BoundVerdict;
}

const MAX_PENDING_QUERIES = 8;

/**
 * Non-stalling wrapper around EXT_disjoint_timer_query_webgl2.
 * Gracefully degrades to `unavailable` on browsers without support
 * (e.g., Firefox, Safari, or coarsened privacy contexts) and discards
 * any sample where GPU_DISJOINT_EXT was raised.
 */
export class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: EXTDisjointTimerQueryWebGL2 | null;
  private readonly pendingQueries: WebGLQuery[] = [];
  private readonly gpuTimesMs: number[] = [];

  private activeQuery: WebGLQuery | null = null;
  private lastGpuTimeMs: number | null = null;
  private disjointCount = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const rawExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as EXTDisjointTimerQueryWebGL2 | null;
    this.ext = rawExt ?? null;
  }

  public isAvailable(): boolean {
    return this.ext !== null;
  }

  public beginFrame(): void {
    if (!this.ext || this.activeQuery !== null) return;
    if (this.pendingQueries.length >= MAX_PENDING_QUERIES) return;

    const query = this.gl.createQuery();
    if (!query) return;

    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
  }

  public endFrame(): void {
    if (!this.ext || this.activeQuery === null) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pendingQueries.push(this.activeQuery);
    this.activeQuery = null;
  }

  public poll(): void {
    if (!this.ext || this.pendingQueries.length === 0) return;

    const disjoint = Boolean(this.gl.getParameter(this.ext.GPU_DISJOINT_EXT));

    while (this.pendingQueries.length > 0) {
      const oldest = this.pendingQueries[0]!;
      const available = Boolean(
        this.gl.getQueryParameter(oldest, this.gl.QUERY_RESULT_AVAILABLE),
      );
      if (!available) {
        break;
      }

      this.pendingQueries.shift();
      if (disjoint) {
        this.disjointCount += 1;
        this.gl.deleteQuery(oldest);
        continue;
      }

      const elapsedNs = Number(this.gl.getQueryParameter(oldest, this.gl.QUERY_RESULT));
      this.gl.deleteQuery(oldest);

      if (Number.isFinite(elapsedNs) && elapsedNs > 0) {
        const ms = elapsedNs / 1_000_000;
        this.lastGpuTimeMs = Math.round(ms * 100) / 100;
        this.gpuTimesMs.push(ms);
      }
    }
  }

  public resetStageStats(): void {
    this.gpuTimesMs.length = 0;
    this.lastGpuTimeMs = null;
    this.disjointCount = 0;
  }

  public getLastGpuTimeMs(): number | null {
    return this.ext ? this.lastGpuTimeMs : null;
  }

  public summarizeStage(medianCpuFrameTimeMs: number): GpuTimerStats {
    if (!this.ext || this.gpuTimesMs.length === 0) {
      return {
        available: this.ext !== null,
        lastGpuTimeMs: this.lastGpuTimeMs,
        medianGpuTimeMs: null,
        sampleCount: 0,
        disjointCount: this.disjointCount,
        boundVerdict: 'unavailable',
      };
    }

    const sorted = [...this.gpuTimesMs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianGpuMs =
      sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) * 0.5;

    let boundVerdict: BoundVerdict = 'balanced';
    if (medianCpuFrameTimeMs > 0) {
      const ratio = medianGpuMs / medianCpuFrameTimeMs;
      if (ratio >= 0.72) {
        boundVerdict = 'gpu-bound';
      } else if (ratio <= 0.40) {
        boundVerdict = 'cpu-bound';
      }
    }

    return {
      available: true,
      lastGpuTimeMs: this.lastGpuTimeMs,
      medianGpuTimeMs: Math.round(medianGpuMs * 100) / 100,
      sampleCount: this.gpuTimesMs.length,
      disjointCount: this.disjointCount,
      boundVerdict,
    };
  }

  public dispose(): void {
    if (this.activeQuery) {
      if (this.ext) {
        try {
          this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
        } catch {
          // Ignore if context already lost
        }
      }
      this.gl.deleteQuery(this.activeQuery);
      this.activeQuery = null;
    }
    while (this.pendingQueries.length > 0) {
      const q = this.pendingQueries.shift()!;
      this.gl.deleteQuery(q);
    }
    this.gpuTimesMs.length = 0;
  }
}
