import { BenchmarkEngine } from './engine/BenchmarkEngine.ts';
import { CombinedBloomStage } from './stages/CombinedBloomStage.ts';
import { InstancedStressStage } from './stages/InstancedStressStage.ts';
import { RaymarchFractalStage } from './stages/RaymarchFractalStage.ts';
import { WaterCausticsStage } from './stages/WaterCausticsStage.ts';
import { BenchmarkUI } from './ui/BenchmarkUI.ts';

function bootstrap(): void {
  const appRoot = document.getElementById('app');
  if (!appRoot) {
    throw new Error('Root element #app was not found in index.html.');
  }

  const stages = [
    new InstancedStressStage(),
    new RaymarchFractalStage(),
    new WaterCausticsStage(),
    new CombinedBloomStage(),
  ];

  let engine: BenchmarkEngine;
  try {
    engine = new BenchmarkEngine({
      container: appRoot,
      stages,
      initialMode: 'benchmark',
      initialResolutionScale: 1.0,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to initialize WebGL2 GPU benchmark engine.';
    renderFatalFallback(appRoot, message);
    return;
  }

  const ui = new BenchmarkUI(appRoot, engine);

  const cleanup = (): void => {
    ui.dispose();
    engine.dispose();
  };

  window.addEventListener('beforeunload', cleanup, { once: true });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    });
  }
}

function renderFatalFallback(root: HTMLElement, message: string): void {
  root.innerHTML = '';
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#08090c;color:#f3f4f6;font-family:system-ui,sans-serif;padding:24px;';
  const box = document.createElement('div');
  box.style.cssText =
    'max-width:480px;padding:24px;border:1px solid #393c49;border-radius:8px;background:#0f1015;';
  const title = document.createElement('h1');
  title.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:600;color:#e5566f;';
  title.textContent = 'WebGL2 Initialization Error';
  const desc = document.createElement('p');
  desc.style.cssText = 'margin:0;font-size:13px;line-height:1.5;color:#a1a5b0;';
  desc.textContent = message;
  box.append(title, desc);
  panel.appendChild(box);
  root.appendChild(panel);
}

bootstrap();
