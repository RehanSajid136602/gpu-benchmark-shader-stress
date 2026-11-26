# AetherMark Specifications (Phases 1–4)

## Phase 1: Reliability Core

### 1.1 `src/telemetry/FrameStats.ts`
- **Warmup discard:** Discard samples recorded during the first `warmupMs` (default `1500 ms`) of a stage. If a stage is shorter than `warmupMs` (e.g. `?stageDuration=1`), fall back gracefully (discard at most 25% of duration) so sample count is non-empty.
- **Metrics:** Compute `medianFrameTimeMs`, `medianFps`, `p95FrameTimeMs`, `p99FrameTimeMs`, `onePercentLowFps`, `minFps`, `maxFps`, `madMs` (Median Absolute Deviation), `cv` (MAD-based or std/mean coefficient of variation), and `stutterCount` (frames > `max(2 * medianFrameTimeMs, medianFrameTimeMs + 16.67)`).
- **Throttle detection:** Compare first-third median frame time vs last-third median frame time (after warmup). Flag `throttled = true` when last-third median degrades by >= 12% (`lastThirdMedianMs / firstThirdMedianMs >= 1.12`) with sufficient samples (>= 30).
- **VSync / Refresh-Cap detection:** Check against common refresh targets (`60, 75, 90, 120, 144, 165, 240` Hz). Flag `vsyncPinned = true` when `medianFps` is within `±2.5%` of a target AND `cv < 0.06`, marking the score as a **floor, not a ceiling**.
- **Confidence rating (`high | medium | low`) & `warnings[]`:**
  - `low`: software rasterizer, tab hidden during run, context lost, `< 20` post-warmup samples, `vsyncPinned`, or `cv >= 0.25`.
  - `medium`: `throttled`, `0.12 <= cv < 0.25`, or `stutterCount >= 5`.
  - `high`: none of the above.

### 1.2 `src/telemetry/GpuTimer.ts`
- Wrap `EXT_disjoint_timer_query_webgl2` (`TIME_ELAPSED_EXT`, `GPU_DISJOINT_EXT`, `QUERY_RESULT_AVAILABLE`, `QUERY_RESULT`).
- Isolate extension typing in one declared TypeScript interface.
- Non-stalling: use a ring/queue of pending queries; only read `QUERY_RESULT` when `QUERY_RESULT_AVAILABLE` is true.
- Check `GPU_DISJOINT_EXT` before trusting completed samples; discard disjoint frames.
- Classify stage/frame as `gpu-bound`, `cpu-bound`, `balanced`, or `unavailable` by comparing GPU elapsed ms to CPU frame time ms.

### 1.3 Resilience, Determinism, Scoring
- `src/utils/prng.ts`: `mulberry32(seed)` deterministic PRNG. Read `?seed=` from URL or generate a 32-bit unsigned seed per run. Inject seed into stages (`setSeed?(seed: number): void`) for deterministic particle/instance/camera phases.
- `BenchmarkEngine.ts`:
  - Listen for `webglcontextlost` (preventDefault, abort run, emit error/invalid state) and `webglcontextrestored` (re-init renderer/stages, allow retry).
  - Listen for `visibilitychange`: if `document.hidden` during a benchmark run, flag `tabHidden = true` on the run/stage.
  - Detect `devicePixelRatio` changes mid-run and record effective pixel count.
  - Software-rasterizer banner + workload cap option in low-end/fallback mode.
- `ScorecardCalculator.ts`:
  - Normalize stage weights to sum to `1.00` (`0.25, 0.30, 0.25, 0.20`).
  - Use **median FPS** (`stageMetrics.medianFps`) for stage scoring and overall FPS.
  - Attach per-stage and overall `ConfidenceRating`, `warnings[]`, `gpuBoundVerdict`, `seed`, and `version`.

## Phase 2: Visual Layer (Flight-Recorder Instrumentation)
- **Typography & Palette (`index.html`, `main.css`):** Load `Bricolage Grotesque` + `JetBrains Mono`. Define `--ink`, `--carbon`, `--rule`, `--signal`, `--warn`, `--fault`, `--tier-s`, `--tier-a`, `--tier-b`, `--tier-entry`. Remove all Inter/Roboto/Arial/system-ui font declarations and purple colors.
- **`src/ui/FrameGraph.ts`:** DPR-aware canvas frame-time graph with 60 fps (`16.67 ms`) and 30 fps (`33.33 ms`) guides, throttled draw cadence (~150 ms / every 8 frames).
- **Scorecard Redesign (`ScorecardModal.ts`):** Asymmetric layout with dominant score column, per-stage timeline strip, confidence badge, warnings list, GPU/CPU-bound chip, tier badge with signature reveal, ARIA live region, and `requestAnimationFrame` score count-up (respecting `prefers-reduced-motion`).
- **Stage Transition Wipe:** Subtle flight-recorder wipe/banner on stage change (gated by `prefers-reduced-motion`).
- **Shareable PNG (`ScorecardExporter.ts`):** Offscreen canvas PNG containing score, tier, GPU string, per-stage bars, seed, confidence, version, and date.

## Phase 3: Super-Tool Features
- **Run History (`src/storage/RunHistoryStorage.ts`):** Versioned `localStorage` store (`version: 1`, `migrate()` stub, `try/catch` fail-closed). List, delete, side-by-side compare of 2 runs with delta badges (`▲/▼ %`), and Personal Best marker (high-confidence runs only).
- **Stability Test:** 5-minute / 10-minute loop mode plotting FPS-decay curve, sustained-vs-peak ratio, and throttle verdict.
- **Presets & URL Params:** `Mobile`, `Laptop`, `Desktop`, `Extreme` presets (controlling resolution scale, instance count multiplier, stage duration). URL params: `?preset=`, `?res=`, `?seed=`, `?stageDuration=`, `?autorun=1`.
- **Export:** Full JSON and CSV export (raw per-stage stats, device info, seed, confidence, version).

## Phase 4: Verification & Delivery
- Vitest unit tests for `FrameStats` (steady, throttling, vsync-pinned, stuttery, warmup discard) and `ScorecardCalculator` (weight normalization, median FPS scoring, confidence/PB gating).
- `pnpm tsc --noEmit` and `pnpm build` pass clean.
- Verify `vite.config.ts` `base: './'` and `.github/workflows/deploy.yml`.
- Update `README.md` with features, URL params, scoring methodology, and "How to Read Your Confidence Rating".
