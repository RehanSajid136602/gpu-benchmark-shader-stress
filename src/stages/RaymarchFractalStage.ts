import * as THREE from 'three';
import {
  RAYMARCH_FRAGMENT_SHADER,
  RAYMARCH_VERTEX_SHADER,
} from '../shaders/raymarchShader.ts';
import type { BenchmarkStage, CameraPreset } from '../types.ts';

export class RaymarchFractalStage implements BenchmarkStage {
  public readonly id = 'raymarch' as const;
  public readonly name = 'Raymarched Mandelbulb & Nebula';
  public readonly description =
    'Full-screen WebGL2 raymarching of a 3D Mandelbulb + Menger fold hybrid with volumetric nebula scattering, AO, soft shadows, and iridescence.';
  public readonly weight = 0.3;

  private readonly scene = new THREE.Scene();
  private readonly orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private quadGeo: THREE.PlaneGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private quadMesh: THREE.Mesh | null = null;

  private viewportWidth = 1280;
  private viewportHeight = 720;
  private elapsedSec = 0;
  private backgroundMode = false;
  private lightsEnabled = true;
  private disposed = false;

  // Reusable math scratch vectors to avoid per-frame allocations
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpBack = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpCamPos = new THREE.Vector3();
  private readonly tmpLookTarget = new THREE.Vector3();

  public init(_renderer: THREE.WebGLRenderer, width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);

    if (this.quadMesh) return;

    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: RAYMARCH_VERTEX_SHADER,
      fragmentShader: RAYMARCH_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: this.viewportWidth / this.viewportHeight },
        uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(55 * 0.5)) },
        uFractalScale: { value: 1.0 },
        uMaxDist: { value: 28.0 },
        uBackgroundMode: { value: 0.0 },
        uLightsEnabled: { value: 1.0 },
        uCameraPos: { value: new THREE.Vector3(0, 0.85, 3.6) },
        uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
        uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
        uCameraForward: { value: new THREE.Vector3(0, 0, -1) },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });

    this.quadMesh = new THREE.Mesh(this.quadGeo, this.material);
    this.quadMesh.frustumCulled = false;
    this.scene.add(this.quadMesh);
    this.applyModeUniforms();
  }

  public resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    if (this.material) {
      this.material.uniforms.uAspect.value =
        this.viewportWidth / Math.max(1, this.viewportHeight);
    }
  }

  public getCameraPreset(): CameraPreset {
    return {
      position: [0.0, 0.72, 3.35],
      target: [0.0, 0.0, 0.0],
      fov: 55,
    };
  }

  public setBackgroundMode(enabled: boolean): void {
    this.backgroundMode = enabled;
    this.applyModeUniforms();
  }

  public setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
    if (this.material) {
      this.material.uniforms.uLightsEnabled.value = enabled ? 1.0 : 0.0;
    }
  }

  public update(
    elapsedSec: number,
    _deltaSec: number,
    camera: THREE.PerspectiveCamera,
    isSandbox: boolean,
  ): void {
    this.elapsedSec = elapsedSec;

    if (!isSandbox && !this.backgroundMode) {
      // Dramatic automated camera path diving around the Mandelbulb fractal
      const t = elapsedSec;
      const orbitAngle = t * 0.38;
      const diveWave = Math.sin(t * 0.42);
      const radius = 3.25 - 1.15 * Math.pow(0.5 + 0.5 * diveWave, 1.35);
      const camX = Math.sin(orbitAngle) * radius;
      const camZ = Math.cos(orbitAngle) * radius;
      const camY = 0.65 * Math.sin(t * 0.52) + 0.35 * Math.cos(t * 0.29);

      camera.position.set(camX, camY, camZ);
      this.tmpLookTarget.set(
        0.18 * Math.sin(t * 0.6),
        0.12 * Math.cos(t * 0.45),
        0.0,
      );
      camera.lookAt(this.tmpLookTarget);
    }

    this.syncCameraUniforms(camera);
  }

  public render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    target?: THREE.WebGLRenderTarget | null,
  ): void {
    if (this.disposed || !this.material) return;

    this.syncCameraUniforms(camera);
    this.material.uniforms.uTime.value = this.elapsedSec;

    const outTarget = target ?? null;
    renderer.setRenderTarget(outTarget);
    renderer.render(this.scene, this.orthoCamera);
    renderer.setRenderTarget(outTarget);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.quadMesh) {
      this.scene.remove(this.quadMesh);
      this.quadMesh = null;
    }
    this.quadGeo?.dispose();
    this.quadGeo = null;
    this.material?.dispose();
    this.material = null;
  }

  private applyModeUniforms(): void {
    if (!this.material) return;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.uniforms.uBackgroundMode.value = this.backgroundMode ? 1.0 : 0.0;
    this.material.uniforms.uFractalScale.value = this.backgroundMode ? 8.2 : 1.0;
    this.material.uniforms.uMaxDist.value = this.backgroundMode ? 180.0 : 28.0;
    this.material.uniforms.uLightsEnabled.value = this.lightsEnabled ? 1.0 : 0.0;
  }

  private syncCameraUniforms(camera: THREE.PerspectiveCamera): void {
    if (!this.material) return;

    camera.matrixWorld.extractBasis(this.tmpRight, this.tmpUp, this.tmpBack);
    this.tmpRight.normalize();
    this.tmpUp.normalize();
    this.tmpForward.copy(this.tmpBack).negate().normalize();
    this.tmpCamPos.setFromMatrixPosition(camera.matrixWorld);

    const uniforms = this.material.uniforms;
    (uniforms.uCameraPos.value as THREE.Vector3).copy(this.tmpCamPos);
    (uniforms.uCameraRight.value as THREE.Vector3).copy(this.tmpRight);
    (uniforms.uCameraUp.value as THREE.Vector3).copy(this.tmpUp);
    (uniforms.uCameraForward.value as THREE.Vector3).copy(this.tmpForward);

    uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    uniforms.uAspect.value =
      camera.aspect > 0
        ? camera.aspect
        : this.viewportWidth / Math.max(1, this.viewportHeight);
  }
}
