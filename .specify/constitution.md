# AetherMark Project Constitution

## 1. Measurement Integrity
- Frame timing MUST use high-resolution monotonic timestamps (`performance.now()`).
- Warmup frames (default `1500 ms` per stage) MUST be discarded from scored statistics to eliminate shader-compilation, pipeline-warmup, and first-frame allocation spikes.
- Stage and composite scoring MUST use **median FPS** (derived from median frame time) rather than arithmetic mean, preventing transient outliers from skewing results.
- Stage weights MUST be explicitly normalized so their sum equals `1.00` (`InstancedStressStage: 0.25`, `RaymarchFractalStage: 0.30`, `WaterCausticsStage: 0.25`, `CombinedBloomStage: 0.20`).
- Every run and every stage MUST carry a **confidence rating** (`high | medium | low`) and human-readable `warnings[]` explaining any detected anomalies (thermal/power throttling, VSync/refresh-rate pinning, high coefficient of variation, excessive stutters, software rasterizer, tab hidden, or context loss).
- Low-confidence runs MUST NEVER be promoted to Personal Best.

## 2. Zero-Overhead Hot Path Rule
- The per-frame `requestAnimationFrame` loop MUST NOT allocate objects/arrays in steady-state hot paths where avoidable, MUST NOT perform synchronous GPU readbacks (`gl.readPixels`, `gl.finish`), and MUST NOT cause DOM layout thrash.
- HUD DOM updates MUST be change-checked (write only on string/color change).
- Canvas frame-time graph (`FrameGraph`) MUST draw on a throttled cadence (e.g., every N frames or ~150 ms) rather than every frame, so the HUD never steals GPU/CPU budget from the measured stage.

## 3. Determinism & Reproducibility
- Every benchmark run MUST use a seeded PRNG (`mulberry32`) initialized from a numeric seed (provided via `?seed=` or generated once per run) and stored in `BenchmarkResult`.
- Stages MUST accept the seeded PRNG / deterministic seed without rewriting existing working shader algorithms.
- URL parameters (`?stageDuration=`, `?preset=`, `?res=`, `?seed=`, `?autorun=1`) MUST remain backward-compatible and reproducible.

## 4. Graceful Degradation & Resilience
- `EXT_disjoint_timer_query_webgl2` is optional and often unavailable or coarsened (Firefox, Safari, privacy-hardened browsers). The engine MUST detect availability, poll queries non-stalling, discard `GPU_DISJOINT_EXT` samples, label GPU time as `"unavailable"` when absent, and NEVER block a benchmark run.
- `webglcontextlost` MUST abort any active run, mark the run invalid, and offer recovery/retry on `webglcontextrestored`.
- `visibilitychange` (tab hidden) MUST invalidate/flag the active stage/run to prevent background-tab rAF clamping (`<= 1 Hz`) from corrupting scores.
- Software rasterizers (SwiftShader, llvmpipe, Microsoft Basic Render) MUST trigger a visible warning banner and cap extreme workloads so the tab does not freeze.
- `localStorage` persistence MUST be schema-versioned (`version` field) with a migration stub, wrapped in `try/catch`, failing closed without crashing when storage is disabled, full, or corrupted.

## 5. Accessibility & Visual Craft
- Aesthetic: **Flight-recorder instrumentation** — dark carbon base (`--carbon`), hairline rules (`--rule`), tabular numerals (`JetBrains Mono`), display type (`Bricolage Grotesque`), restrained signal colors (`--signal`, `--warn`, `--fault`, `--tier-s/a/b/entry`), zero purple gradients, zero Inter/Roboto/Arial/system fonts.
- `prefers-reduced-motion: reduce` MUST disable non-essential animations and count-ups.
- All interactive controls MUST be keyboard-operable with visible focus rings and AA contrast.
- Score reveal MUST announce via an ARIA live region (`aria-live="polite"`).
