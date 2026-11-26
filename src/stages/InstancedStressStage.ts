import * as THREE from 'three';
import {
  INSTANCED_BACKDROP_FRAGMENT_SHADER,
  INSTANCED_BACKDROP_VERTEX_SHADER,
  INSTANCED_CRYSTAL_FRAGMENT_SHADER,
  INSTANCED_CRYSTAL_VERTEX_SHADER,
} from '../shaders/instanced.ts';
import type { BenchmarkStage, CameraPreset, StageId } from '../types.ts';

export const INSTANCE_COUNT = 500_000;

interface LightOrbRig {
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
  color: THREE.Color;
  radius: number;
  speed: number;
  phase: number;
  heightAmp: number;
}

/**
 * Stage 1: 500k Instanced Mesh Vertex Stress.
 *
 * Renders 500,000 faceted crystal octahedrons (4,000,000 triangles) in a single
 * GPU-instanced draw call with custom vertex-shader curl/orbital displacement,
 * per-instance InstancedBufferAttributes, and multi-light rim/specular shading.
 */
export class InstancedStressStage implements BenchmarkStage {
  public readonly id: StageId = 'instanced';
  public readonly name = '500k Instanced Crystal Vortex';
  public readonly description =
    '500,000 GPU-instanced crystal octahedrons (4.0M triangles) driven by vertex-shader curl vortex fields and dynamic rim/specular lighting.';
  public readonly weight = 0.25;

  private readonly scene = new THREE.Scene();
  private readonly stageGroup = new THREE.Group();
  private readonly lightsGroup = new THREE.Group();

  private instancedMesh: THREE.InstancedMesh | null = null;
  private crystalMaterial: THREE.ShaderMaterial | null = null;

  private backdropMesh: THREE.Mesh | null = null;
  private backdropMaterial: THREE.ShaderMaterial | null = null;
  private coreMesh: THREE.Mesh | null = null;

  private readonly lightOrbs: LightOrbRig[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  private readonly lightPositions: THREE.Vector3[] = [
    new THREE.Vector3(10, 3, 0),
    new THREE.Vector3(-8, -2, 8),
    new THREE.Vector3(0, 5, -11),
  ];

  private readonly lightColors: THREE.Color[] = [
    new THREE.Color(0x38bdf8).convertSRGBToLinear().multiplyScalar(2.6),
    new THREE.Color(0xf59e0b).convertSRGBToLinear().multiplyScalar(2.5),
    new THREE.Color(0x6366f1).convertSRGBToLinear().multiplyScalar(2.4),
  ];

  private lightsEnabled = true;
  private overlayMode = false;
  private initialized = false;
  private disposed = false;

  public init(_renderer: THREE.WebGLRenderer, _width: number, _height: number): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;

    this.scene.background = null;
    this.scene.add(this.stageGroup);
    this.stageGroup.add(this.lightsGroup);

    this.buildBackdrop();
    this.buildCoreAndBeacons();
    this.buildInstancedCrystalSwarm();
  }

  public resize(_width: number, _height: number): void {
    // Stage 1 renders directly to the active camera/target without resolution-dependent FBOs.
  }

  public getCameraPreset(): CameraPreset {
    return {
      position: [0, 7.5, 25.5],
      target: [0, 0, 0],
      fov: 58,
    };
  }

  public getGroup(): THREE.Group {
    return this.stageGroup;
  }

  public setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
    this.lightsGroup.visible = enabled;
    if (this.coreMesh) {
      this.coreMesh.visible = enabled && !this.overlayMode;
    }
    if (this.crystalMaterial) {
      this.crystalMaterial.uniforms.uLightsEnabled.value = enabled ? 1.0 : 0.0;
    }
    if (this.backdropMaterial) {
      this.backdropMaterial.uniforms.uLightsEnabled.value = enabled ? 1.0 : 0.0;
    }
  }

  public setOverlayMode(enabled: boolean): void {
    this.overlayMode = enabled;
    this.scene.background = null;
    if (this.backdropMesh) {
      this.backdropMesh.visible = !enabled;
    }
    if (this.coreMesh) {
      this.coreMesh.visible = this.lightsEnabled && !enabled;
    }
  }

  public setBackgroundMode(_enabled: boolean): void {
    // Kept for BenchmarkStage compatibility.
  }

  public update(
    elapsedSec: number,
    _deltaSec: number,
    camera: THREE.PerspectiveCamera,
    isSandbox: boolean,
  ): void {
    if (!this.initialized || this.disposed) return;

    for (let i = 0; i < this.lightOrbs.length; i++) {
      const orb = this.lightOrbs[i]!;
      const angle = elapsedSec * orb.speed + orb.phase;
      const x = Math.cos(angle) * orb.radius;
      const z = Math.sin(angle) * orb.radius;
      const y = Math.sin(elapsedSec * 1.15 + orb.phase * 1.7) * orb.heightAmp;

      orb.mesh.position.set(x, y, z);
      orb.halo.position.set(x, y, z);
      orb.halo.lookAt(camera.position);
      this.lightPositions[i]!.set(x, y, z);
    }

    if (this.crystalMaterial) {
      this.crystalMaterial.uniforms.uTime.value = elapsedSec;
      this.crystalMaterial.uniforms.uLightsEnabled.value = this.lightsEnabled ? 1.0 : 0.0;
    }
    if (this.backdropMaterial) {
      this.backdropMaterial.uniforms.uTime.value = elapsedSec;
      this.backdropMaterial.uniforms.uLightsEnabled.value = this.lightsEnabled ? 1.0 : 0.0;
    }
    if (this.coreMesh) {
      const pulse = 1.0 + Math.sin(elapsedSec * 2.4) * 0.08;
      this.coreMesh.scale.setScalar(pulse);
    }

    // In Benchmark mode, sweep the camera smoothly around and across the 500k swarm.
    // In Sandbox mode, OrbitControls owns the camera.
    if (!isSandbox) {
      const orbitAngle = elapsedSec * 0.24;
      const radius = 23.5 + Math.sin(elapsedSec * 0.35) * 4.5;
      const elevation = 5.5 + Math.sin(elapsedSec * 0.42) * 5.2;
      camera.position.set(
        Math.sin(orbitAngle) * radius,
        elevation,
        Math.cos(orbitAngle) * radius,
      );
      camera.lookAt(0, Math.sin(elapsedSec * 0.28) * 1.2, 0);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    target?: THREE.WebGLRenderTarget | null,
  ): void {
    if (!this.initialized || this.disposed) return;
    renderer.setRenderTarget(target ?? null);
    renderer.render(this.scene, camera);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.instancedMesh) {
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
    this.lightOrbs.length = 0;
    this.crystalMaterial = null;
    this.backdropMesh = null;
    this.backdropMaterial = null;
    this.coreMesh = null;
    this.scene.clear();
  }

  private buildBackdrop(): void {
    const geo = new THREE.SphereGeometry(140, 32, 20);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
      },
      vertexShader: INSTANCED_BACKDROP_VERTEX_SHADER,
      fragmentShader: INSTANCED_BACKDROP_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;

    this.backdropMesh = mesh;
    this.backdropMaterial = mat;
    this.disposables.push(geo, mat);
    this.stageGroup.add(mesh);
  }

  private buildCoreAndBeacons(): void {
    const coreGeo = new THREE.IcosahedronGeometry(0.95, 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x38bdf8).multiplyScalar(1.85),
      toneMapped: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.coreMesh = coreMesh;
    this.disposables.push(coreGeo, coreMat);
    this.stageGroup.add(coreMesh);

    const orbGeo = new THREE.OctahedronGeometry(0.28, 1);
    const haloGeo = new THREE.RingGeometry(0.36, 0.52, 24);
    this.disposables.push(orbGeo, haloGeo);

    const orbSpecs = [
      { hex: 0x38bdf8, radius: 10.5, speed: 0.72, phase: 0.0, heightAmp: 3.2 },
      { hex: 0xf59e0b, radius: 13.5, speed: -0.58, phase: 2.1, heightAmp: 4.0 },
      { hex: 0x818cf8, radius: 16.0, speed: 0.46, phase: 4.2, heightAmp: 3.6 },
    ];

    for (let i = 0; i < orbSpecs.length; i++) {
      const spec = orbSpecs[i]!;
      const orbMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.hex).multiplyScalar(2.4),
        toneMapped: false,
      });
      const haloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.hex).multiplyScalar(1.3),
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      const halo = new THREE.Mesh(haloGeo, haloMat);

      this.disposables.push(orbMat, haloMat);
      this.lightsGroup.add(mesh, halo);
      this.lightOrbs.push({
        mesh,
        halo,
        color: this.lightColors[i]!,
        radius: spec.radius,
        speed: spec.speed,
        phase: spec.phase,
        heightAmp: spec.heightAmp,
      });
    }
  }

  private buildInstancedCrystalSwarm(): void {
    // Non-indexed elongated octahedron: 8 crisp facets = 4,000,000 triangles across 500,000 instances
    const geometry = new THREE.OctahedronGeometry(0.056, 0);
    geometry.scale(0.68, 1.52, 0.68);
    geometry.computeVertexNormals();

    const instanceData = new Float32Array(INSTANCE_COUNT * 4);
    const instanceColors = new Float32Array(INSTANCE_COUNT * 3);

    const dataAttr = new THREE.InstancedBufferAttribute(instanceData, 4);
    const colorAttr = new THREE.InstancedBufferAttribute(instanceColors, 3);
    geometry.setAttribute('aInstanceData', dataAttr);
    geometry.setAttribute('aInstanceColor', colorAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: this.lightsEnabled ? 1.0 : 0.0 },
        uLightPositions: { value: this.lightPositions },
        uLightColors: { value: this.lightColors },
      },
      vertexShader: INSTANCED_CRYSTAL_VERTEX_SHADER,
      fragmentShader: INSTANCED_CRYSTAL_FRAGMENT_SHADER,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, INSTANCE_COUNT);
    mesh.frustumCulled = false;
    const matrixArray = mesh.instanceMatrix.array as Float32Array;

    const paletteObsidian = new THREE.Color(0x131b2e).convertSRGBToLinear();
    const paletteSlate = new THREE.Color(0x1e293b).convertSRGBToLinear();
    const paletteCyan = new THREE.Color(0x0ea5e9).convertSRGBToLinear();
    const paletteElectric = new THREE.Color(0x38bdf8).convertSRGBToLinear();
    const paletteAmber = new THREE.Color(0xf59e0b).convertSRGBToLinear();
    const paletteIndigo = new THREE.Color(0x6366f1).convertSRGBToLinear();
    const scratchColor = new THREE.Color();

    const dummyPos = new THREE.Vector3();
    const dummyQuat = new THREE.Quaternion();
    const dummyScale = new THREE.Vector3();
    const dummyMatrix = new THREE.Matrix4();
    const euler = new THREE.Euler();

    // Deterministic PRNG so benchmark workloads are repeatable across runs
    let seed = 0x5f3759df;
    const nextRand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < INSTANCE_COUNT; i++) {
      const bandRoll = nextRand();
      let x = 0;
      let y = 0;
      let z = 0;
      let radialNorm = 0;
      let yaw = 0;
      let pitch = 0;
      let roll = 0;
      let scaleFactor = 1.0;

      if (bandRoll < 0.48) {
        // Double-helix orbital torus ribbon
        const u = nextRand() * Math.PI * 2;
        const arm = i % 2 === 0 ? 0 : Math.PI;
        const helixAngle = u * 3.0 + arm + (nextRand() - 0.5) * 0.9;
        const majorR = 10.5 + Math.sin(u * 2.0 + arm) * 1.4;
        const minorR = 1.2 + Math.pow(nextRand(), 0.75) * 2.8;

        const ringR = majorR + Math.cos(helixAngle) * minorR;
        x = Math.cos(u) * ringR;
        z = Math.sin(u) * ringR;
        y = Math.sin(helixAngle) * minorR * 0.95;

        radialNorm = 0.25 + 0.35 * nextRand();
        yaw = -u + Math.PI * 0.5;
        pitch = helixAngle * 0.35;
        roll = (nextRand() - 0.5) * 0.8;
        scaleFactor = 0.65 + nextRand() * 0.85;
      } else if (bandRoll < 0.84) {
        // Outer sweeping galactic accretion disc
        const armIdx = i % 3;
        const t = Math.pow(nextRand(), 0.62);
        const radius = 11.0 + t * 17.5;
        const theta =
          armIdx * ((Math.PI * 2) / 3) +
          radius * 0.28 +
          (nextRand() - 0.5) * (0.55 + t * 0.95);

        x = Math.cos(theta) * radius;
        z = Math.sin(theta) * radius;
        y = (nextRand() - 0.5) * (1.2 + t * 4.4);

        radialNorm = 0.45 + 0.55 * t;
        yaw = -theta;
        pitch = (nextRand() - 0.5) * 1.1;
        roll = (nextRand() - 0.5) * 1.1;
        scaleFactor = 0.55 + nextRand() * 0.95;
      } else {
        // Dense central energy crown & vertical spire
        const t = Math.pow(nextRand(), 0.8);
        const radius = 1.6 + t * 6.4;
        const theta = nextRand() * Math.PI * 2;
        x = Math.cos(theta) * radius;
        z = Math.sin(theta) * radius;
        y = (nextRand() - 0.5) * (7.2 - t * 3.8);

        radialNorm = t * 0.28;
        yaw = theta;
        pitch = (nextRand() - 0.5) * 0.6;
        roll = (nextRand() - 0.5) * 0.6;
        scaleFactor = 0.7 + nextRand() * 1.0;
      }

      dummyPos.set(x, y, z);
      euler.set(pitch, yaw, roll);
      dummyQuat.setFromEuler(euler);
      dummyScale.setScalar(scaleFactor);
      dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
      matrixArray.set(dummyMatrix.elements, i * 16);

      // Per-instance animation metadata
      const dIdx = i * 4;
      instanceData[dIdx] = nextRand() * Math.PI * 2; // phase
      instanceData[dIdx + 1] = 0.55 + nextRand() * 1.15; // speed
      instanceData[dIdx + 2] = radialNorm; // radialSeed
      instanceData[dIdx + 3] = (nextRand() > 0.5 ? 1 : -1) * (0.25 + nextRand() * 0.75); // spinSeed

      // Obsidian + electric cyan / molten amber / indigo palette
      const accentRoll = nextRand();
      if (radialNorm < 0.25) {
        scratchColor.copy(paletteAmber).lerp(paletteObsidian, accentRoll * 0.45);
      } else if (accentRoll < 0.48) {
        scratchColor.copy(paletteObsidian).lerp(paletteSlate, nextRand());
      } else if (accentRoll < 0.76) {
        scratchColor.copy(paletteCyan).lerp(paletteElectric, nextRand());
      } else if (accentRoll < 0.90) {
        scratchColor.copy(paletteIndigo).lerp(paletteObsidian, 0.35);
      } else {
        scratchColor.copy(paletteAmber);
      }

      const cIdx = i * 3;
      instanceColors[cIdx] = scratchColor.r;
      instanceColors[cIdx + 1] = scratchColor.g;
      instanceColors[cIdx + 2] = scratchColor.b;
    }

    mesh.instanceMatrix.needsUpdate = true;

    this.crystalMaterial = material;
    this.instancedMesh = mesh;
    this.disposables.push(geometry, material);
    this.stageGroup.add(mesh);
  }
}

export default InstancedStressStage;

