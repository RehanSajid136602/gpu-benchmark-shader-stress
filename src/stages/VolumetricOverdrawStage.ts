import * as THREE from 'three';
import {
  OVERDRAW_CLOUD_FRAG,
  OVERDRAW_CLOUD_VERT,
  VOLUMETRIC_SHAFT_FRAG,
  VOLUMETRIC_SHAFT_VERT,
  VOLUMETRIC_SKY_FRAG,
  VOLUMETRIC_SKY_VERT,
} from '../shaders/volumetricShader.ts';
import type { BenchmarkStage, CameraPreset, StageId } from '../types.ts';
import { mulberry32 } from '../utils/prng.ts';

export const VOLUMETRIC_CLOUD_COUNT = 36_000;
export const VOLUMETRIC_SHAFT_COUNT = 64;

/**
 * Stage 5: Volumetric God-Rays & Alpha Overdraw.
 *
 * Stresses GPU fragment fill-rate, alpha blending overdraw, and volumetric
 * scattering via 36,000 layered Gaussian cloud sprites, 64 instanced volumetric
 * light-shaft cones, and an atmospheric forward-scattering sky dome.
 */
export class VolumetricOverdrawStage implements BenchmarkStage {
  public readonly id: StageId = 'volumetric';
  public readonly name = 'Volumetric God-Rays & Overdraw';
  public readonly description =
    '36,000 layered volumetric sprites and 64 instanced god-ray light shafts stressing alpha overdraw and fragment fill-rate.';
  public readonly weight = 0.2;

  private readonly scene = new THREE.Scene();
  private readonly disposables: Array<{ dispose(): void }> = [];

  private skyMesh: THREE.Mesh | null = null;
  private skyMaterial: THREE.ShaderMaterial | null = null;

  private coreMesh: THREE.Mesh | null = null;
  private coreMaterial: THREE.MeshBasicMaterial | null = null;

  private shaftMesh: THREE.InstancedMesh | null = null;
  private shaftMaterial: THREE.ShaderMaterial | null = null;

  private cloudPoints: THREE.Points | null = null;
  private cloudGeometry: THREE.BufferGeometry | null = null;
  private cloudMaterial: THREE.ShaderMaterial | null = null;

  private seed = 1;
  private instanceScale = 1.0;
  private lightsEnabled = true;
  private pixelRatio = 1.0;

  public init(renderer: THREE.WebGLRenderer, _width: number, _height: number): void {
    this.pixelRatio = renderer.getPixelRatio();

    // 1. Scattering Sky Dome
    const skyGeom = new THREE.SphereGeometry(90, 32, 24);
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: VOLUMETRIC_SKY_VERT,
      fragmentShader: VOLUMETRIC_SKY_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: this.lightsEnabled ? 1.0 : 0.0 },
        uSunDir: { value: new THREE.Vector3(0.0, 0.2, -1.0).normalize() },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeom, this.skyMaterial);
    this.scene.add(this.skyMesh);
    this.disposables.push(skyGeom, this.skyMaterial);

    // 2. Radiant Core Sphere
    const coreGeom = new THREE.IcosahedronGeometry(1.35, 3);
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfff0d4),
    });
    this.coreMesh = new THREE.Mesh(coreGeom, this.coreMaterial);
    this.scene.add(this.coreMesh);
    this.disposables.push(coreGeom, this.coreMaterial);

    // 3. Instanced Volumetric God-Ray Cones
    const shaftGeom = new THREE.ConeGeometry(2.6, 22, 16, 1, true);
    shaftGeom.translate(0, -11, 0);
    this.shaftMaterial = new THREE.ShaderMaterial({
      vertexShader: VOLUMETRIC_SHAFT_VERT,
      fragmentShader: VOLUMETRIC_SHAFT_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: this.lightsEnabled ? 1.0 : 0.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shaftMesh = new THREE.InstancedMesh(shaftGeom, this.shaftMaterial, VOLUMETRIC_SHAFT_COUNT);
    this.shaftMesh.frustumCulled = false;
    this.scene.add(this.shaftMesh);
    this.disposables.push(shaftGeom, this.shaftMaterial);

    // 4. High-Overdraw Volumetric Sprite Cloud
    this.cloudGeometry = new THREE.BufferGeometry();
    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: OVERDRAW_CLOUD_VERT,
      fragmentShader: OVERDRAW_CLOUD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.cloudPoints = new THREE.Points(this.cloudGeometry, this.cloudMaterial);
    this.cloudPoints.frustumCulled = false;
    this.scene.add(this.cloudPoints);
    this.disposables.push(this.cloudGeometry, this.cloudMaterial);

    this.populateSeededAttributes();
    this.applyInstanceScale();
  }

  public resize(_width: number, _height: number): void {
    // No offscreen FBOs needed for this pass
  }

  public getCameraPreset(): CameraPreset {
    return {
      position: [0, 3.2, 15.5],
      target: [0, 0, 0],
      fov: 56,
    };
  }

  public setSeed(seed: number): void {
    this.seed = seed >>> 0 || 1;
    if (this.shaftMesh && this.cloudGeometry) {
      this.populateSeededAttributes();
    }
  }

  public setInstanceScale(scale: number): void {
    this.instanceScale = Math.min(1.5, Math.max(0.25, scale));
    this.applyInstanceScale();
  }

  public setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uLightsEnabled!.value = enabled ? 1.0 : 0.0;
    }
    if (this.shaftMaterial) {
      this.shaftMaterial.uniforms.uLightsEnabled!.value = enabled ? 1.0 : 0.0;
    }
  }

  public update(
    elapsedSec: number,
    _deltaSec: number,
    camera: THREE.PerspectiveCamera,
    isSandbox: boolean,
  ): void {
    if (!isSandbox) {
      const orbit = elapsedSec * 0.28;
      camera.position.set(
        Math.sin(orbit) * 15.5,
        3.0 + Math.sin(elapsedSec * 0.45) * 1.8,
        Math.cos(orbit) * 15.5,
      );
      camera.lookAt(0, 0, 0);
    }

    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uTime!.value = elapsedSec;
      const sunAngle = elapsedSec * 0.15;
      (this.skyMaterial.uniforms.uSunDir!.value as THREE.Vector3)
        .set(Math.sin(sunAngle) * 0.5, 0.25, -Math.cos(sunAngle))
        .normalize();
    }

    if (this.shaftMaterial) {
      this.shaftMaterial.uniforms.uTime!.value = elapsedSec;
    }

    if (this.shaftMesh) {
      this.shaftMesh.rotation.y = elapsedSec * 0.14;
      this.shaftMesh.rotation.z = Math.sin(elapsedSec * 0.2) * 0.12;
    }

    if (this.cloudMaterial) {
      this.cloudMaterial.uniforms.uTime!.value = elapsedSec;
    }

    if (this.coreMesh) {
      const pulse = 1.0 + 0.08 * Math.sin(elapsedSec * 3.1);
      this.coreMesh.scale.setScalar(pulse);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    target?: THREE.WebGLRenderTarget | null,
  ): void {
    const pr = renderer.getPixelRatio();
    if (this.cloudMaterial && pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.cloudMaterial.uniforms.uPixelRatio!.value = pr;
    }

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target ?? null);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
    this.scene.clear();
  }

  private populateSeededAttributes(): void {
    const rng = mulberry32(this.seed ^ 0x5f3759df);

    if (this.shaftMesh) {
      const dummy = new THREE.Object3D();
      const shaftData = new Float32Array(VOLUMETRIC_SHAFT_COUNT * 4);
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();

      for (let i = 0; i < VOLUMETRIC_SHAFT_COUNT; i++) {
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        dir.set(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        ).normalize();

        dummy.position.set(0, 0, 0);
        dummy.quaternion.setFromUnitVectors(up, dir);
        const s = 0.75 + rng() * 0.75;
        dummy.scale.set(s, 0.8 + rng() * 0.6, s);
        dummy.updateMatrix();
        this.shaftMesh.setMatrixAt(i, dummy.matrix);

        const base = i * 4;
        shaftData[base] = rng() * Math.PI * 2;
        shaftData[base + 1] = 0.5 + rng() * 1.5;
        shaftData[base + 2] = 0.55 + rng() * 0.45;
        shaftData[base + 3] = rng();
      }
      this.shaftMesh.instanceMatrix.needsUpdate = true;
      this.shaftMesh.geometry.setAttribute(
        'aShaftData',
        new THREE.InstancedBufferAttribute(shaftData, 4),
      );
    }

    if (this.cloudGeometry) {
      const positions = new Float32Array(VOLUMETRIC_CLOUD_COUNT * 3);
      const params = new Float32Array(VOLUMETRIC_CLOUD_COUNT * 4);
      const colors = new Float32Array(VOLUMETRIC_CLOUD_COUNT * 3);

      const palette = [
        new THREE.Color(0x38bdf8),
        new THREE.Color(0xf59e0b),
        new THREE.Color(0xa855f7),
        new THREE.Color(0x2dd4bf),
      ];

      for (let i = 0; i < VOLUMETRIC_CLOUD_COUNT; i++) {
        const pBase = i * 3;
        positions[pBase] = 0;
        positions[pBase + 1] = (rng() - 0.5) * 7.5;
        positions[pBase + 2] = 0;

        const qBase = i * 4;
        params[qBase] = 1.8 + Math.pow(rng(), 0.75) * 11.5;
        params[qBase + 1] = rng() * Math.PI * 2;
        params[qBase + 2] = (rng() > 0.5 ? 1 : -1) * (0.12 + rng() * 0.35);
        params[qBase + 3] = 0.65 + rng() * 1.65;

        const c = palette[Math.floor(rng() * palette.length)]!;
        colors[pBase] = c.r;
        colors[pBase + 1] = c.g;
        colors[pBase + 2] = c.b;
      }

      this.cloudGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.cloudGeometry.setAttribute('aCloudParams', new THREE.BufferAttribute(params, 4));
      this.cloudGeometry.setAttribute('aCloudColor', new THREE.BufferAttribute(colors, 3));
    }
  }

  private applyInstanceScale(): void {
    const ratio = Math.min(1.0, Math.max(0.25, this.instanceScale));
    if (this.shaftMesh) {
      this.shaftMesh.count = Math.max(12, Math.round(VOLUMETRIC_SHAFT_COUNT * ratio));
    }
    if (this.cloudGeometry) {
      this.cloudGeometry.setDrawRange(
        0,
        Math.max(4000, Math.round(VOLUMETRIC_CLOUD_COUNT * ratio)),
      );
    }
  }
}
