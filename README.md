# AetherMark — WebGL2 GPU Benchmark & Shader Stress

**Live:** https://rehansajid136602.github.io/gpu-benchmark-shader-stress/

AetherMark is a client-side WebGL2 GPU benchmark and shader stress suite built with TypeScript, Three.js, custom GLSL shaders, and Vite.

## Features
- **5-Stage Automated Benchmark (normalized weights summing to 1.00):**
  1. **500k Instanced Crystal Vortex** (`0.20`) — 500,000 GPU-instanced octahedrons (4.0M triangles) with vertex-shader curl fields.
  2. **Raymarched Mandelbulb & Nebula** (`0.25`) — Full-screen SDF raymarching with volumetric nebula, AO, soft shadows, and iridescence.
  3. **Water Refraction & Caustics** (`0.20`) — Multi-pass Gerstner waves with planar reflection, depth-aware refraction, and chromatic caustics.
  4. **Combined Bloom & Dynamic Lighting** (`0.15`) — Instanced monoliths, 48k shards, plasma core, mirror deck, 6 dynamic lights, and `UnrealBloomPass`.
  5. **Volumetric God-Rays & Overdraw** (`0.20`) — 36,000 layered volumetric sprites and 64 instanced god-ray light shafts stressing alpha overdraw and fill-rate.
- **Flight-Recorder Telemetry:**
  - 1500 ms per-stage warmup discard (eliminates shader-compile and first-frame spikes).
  - Median FPS, 1% low, P95/P99 frame times, MAD, CV, stutter count, thermal throttling detection, and VSync refresh-cap detection.
  - Non-stalling `EXT_disjoint_timer_query_webgl2` GPU timer wrapper (degrades gracefully to `unavailable` when unsupported).
  - Resilience against `webglcontextlost`, `visibilitychange` background tab throttling, mid-run `devicePixelRatio` changes, and software rasterizers.
- **Super-Tool Features:**
  - **Hardware Profiles:** `Phone`, `Tablet`, `Laptop`, `Desktop`, `Extreme` (with automatic device detection and non-blocking mismatch warnings).
  - **Stability Loop:** 5-minute or 10-minute loop plotting FPS-decay curves and sustained-vs-peak throttle verdicts.
  - **Run History & Side-by-Side Compare:** Versioned `localStorage` persistence with delta badges (`▲/▼ %`) and Personal Best tracking (high-confidence runs only).
  - **Exports:** Full JSON, raw-metrics CSV, and offscreen-rendered shareable PNG scorecard.

## URL Parameters
- `?preset=mobile|tablet|laptop|desktop|extreme` — Apply a hardware profile on load.
- `?res=0.5..2.0` — Override resolution scale.
- `?stageDuration=1..300` — Override seconds per stage (default `15`).
- `?seed=<number|0xhex|string>` — Deterministic `mulberry32` run seed for reproducible runs.
- `?autorun=1` — Automatically start the benchmark on page load.

## Scoring Methodology
- Each stage discards the first `1500 ms` (capped at 25% for short custom durations) as warmup.
- Stage score is derived from **median FPS** (70%) and **1% low FPS** (30%), modulated by frame-pacing stability and `resolutionScale^1.15`.
- Composite score is the normalized weighted average across all 4 stages (`0.25 + 0.30 + 0.25 + 0.20 = 1.00`).

## How to Read Your Confidence Rating
- **HIGH:** Clean hardware-accelerated run with steady frame pacing (`CV < 12%`), no thermal throttling, no VSync cap, and sufficient post-warmup samples. Eligible for Personal Best.
- **MEDIUM:** Moderate frame-time variance (`12% <= CV < 25%`), >= 5 stutters, mid-stage DPR change, or >= 12% thermal/power throttling between the first and last third of a stage.
- **LOW:** Display VSync/refresh-rate cap detected (`60/75/90/120/144/165/240 Hz` with `CV < 6%` — score reflects display floor, not GPU ceiling), software rasterizer (`SwiftShader`/`llvmpipe`), background tab hidden, WebGL context lost, or severe variance (`CV >= 25%`). Never saved as Personal Best.

## Development
```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```
