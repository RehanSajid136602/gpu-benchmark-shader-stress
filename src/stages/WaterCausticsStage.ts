import * as THREE from 'three';
import {
  AQUATIC_SCENE_FRAGMENT_SHADER,
  AQUATIC_SCENE_VERTEX_SHADER,
  SKY_DOME_FRAGMENT_SHADER,
  SKY_DOME_VERTEX_SHADER,
  WATER_SURFACE_FRAGMENT_SHADER,
  WATER_SURFACE_VERTEX_SHADER,
} from '../shaders/waterShader.ts';
import type { BenchmarkStage, CameraPreset } from '../types.ts';

const WATER_LEVEL = 0.0;
const SUN_DIRECTION = new THREE.Vector3(0.46, 0.36, -0.81).normalize();

interface OrbitingLightDef {
  mesh: THREE.Mesh;
  baseColor: THREE.Color;
  radius: number;
  speed: number;
  phase: number;
  baseY: number;
  bobAmp: number;
}

export class WaterCausticsStage implements BenchmarkStage {
  public readonly id = 'water' as const;
  public readonly name = 'Water Refraction & Caustics';
  public readonly description =
    'Multi-pass Gerstner wave simulation with dynamic planar reflection, depth-aware refraction, Beer-Lambert absorption, and projected chromatic caustics.';
  public readonly weight = 0.25;

  private readonly scene = new THREE.Scene();
  private readonly reflectionCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);

  private reflectionTarget: THREE.WebGLRenderTarget | null = null;
  private refractionTarget: THREE.WebGLRenderTarget | null = null;
  private useHalfFloatTargets = true;
  private maxTextureSize = 4096;

  private viewportWidth = 1280;
  private viewportHeight = 720;
  private pixelRatio = 1.0;
  private targetPixelWidth = 0;
  private targetPixelHeight = 0;

  private skyMesh: THREE.Mesh | null = null;
  private skyMaterial: THREE.ShaderMaterial | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private waterMaterial: THREE.ShaderMaterial | null = null;

  private readonly sceneMaterials: THREE.ShaderMaterial[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly orbitingLights: OrbitingLightDef[] = [];
  private readonly lightPositions: THREE.Vector3[] = [
    new THREE.Vector3(6, 1.5, 6),
    new THREE.Vector3(-6, -1.2, 5),
    new THREE.Vector3(5, -1.5, -6),
    new THREE.Vector3(-7, 2.2, -5),
  ];
  private readonly lightColors: THREE.Vector3[] = [
    new THREE.Vector3(0.22, 0.85, 1.0),
    new THREE.Vector3(1.0, 0.56, 0.16),
    new THREE.Vector3(0.16, 0.96, 0.68),
    new THREE.Vector3(0.68, 0.42, 1.0),
  ];

  private readonly reflectionMatrix = new THREE.Matrix4();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpBack = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpReflPos = new THREE.Vector3();
  private readonly tmpReflForward = new THREE.Vector3();
  private readonly tmpReflUp = new THREE.Vector3();
  private readonly tmpLookAt = new THREE.Vector3();

  private elapsedSec = 0;
  private overlayMode = false;
  private lightsEnabled = true;
  private disposed = false;

  public init(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.pixelRatio = Math.max(0.25, renderer.getPixelRatio() || 1);
    this.maxTextureSize = renderer.capabilities.maxTextureSize || 4096;
    this.useHalfFloatTargets =
      renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('EXT_color_buffer_half_float');

    if (!this.waterMesh) {
      this.buildSkyDome();
      this.buildAquaticArchitecture();
      this.buildWaterSurface();
    }

    this.allocateRenderTargets();
    this.applySceneSettings();
  }

  public resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    // Recompute render target sizes using current viewport; pixelRatio is synced on next render too
    this.allocateRenderTargets();
  }

  public getCameraPreset(): CameraPreset {
    return {
      position: [0.0, 6.8, 21.5],
      target: [0.0, 0.2, -1.5],
      fov: 55,
    };
  }

  public setOverlayMode(enabled: boolean): void {
    this.overlayMode = enabled;
    this.applySceneSettings();
  }

  public setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
    for (const orb of this.orbitingLights) {
      orb.mesh.visible = enabled;
    }
    for (const mat of this.sceneMaterials) {
      mat.uniforms.uLightsEnabled.value = enabled ? 1.0 : 0.0;
    }
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uLightsEnabled.value = enabled ? 1.0 : 0.0;
    }
  }

  public update(
    elapsedSec: number,
    _deltaSec: number,
    camera: THREE.PerspectiveCamera,
    isSandbox: boolean,
  ): void {
    this.elapsedSec = elapsedSec;

    // Animate dynamic orbiting light beacons
    for (let i = 0; i < this.orbitingLights.length; i++) {
      const orb = this.orbitingLights[i]!;
      const angle = elapsedSec * orb.speed + orb.phase;
      const x = Math.cos(angle) * orb.radius;
      const z = Math.sin(angle) * orb.radius;
      const y = orb.baseY + Math.sin(elapsedSec * 1.45 + orb.phase) * orb.bobAmp;
      orb.mesh.position.set(x, y, z);
      this.lightPositions[i]!.set(x, y, z);
    }

    if (!isSandbox) {
      // Sweeping cinematic tour: low grazing reflection skim -> high refraction & caustics reveal
      const angle = elapsedSec * 0.22 - 0.15;
      const radius = 21.2 - 3.2 * Math.sin(elapsedSec * 0.31);
      const camX = Math.sin(angle) * radius;
      const camZ = Math.cos(angle) * radius;
      const camY = 5.4 + 3.4 * Math.sin(elapsedSec * 0.36 + 0.4);

      camera.position.set(camX, camY, camZ);
      this.tmpLookAt.set(
        Math.sin(elapsedSec * 0.18) * 1.6,
        0.15 + 0.4 * Math.cos(elapsedSec * 0.25),
        -1.0,
      );
      camera.lookAt(this.tmpLookAt);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    target?: THREE.WebGLRenderTarget | null,
  ): void {
    if (this.disposed || !this.waterMesh || !this.waterMaterial) return;

    // Ensure render target resolution stays synchronized with active pixelRatio / resolutionScale
    const currentPr = Math.max(0.25, renderer.getPixelRatio() || 1);
    if (Math.abs(currentPr - this.pixelRatio) > 0.01) {
      this.pixelRatio = currentPr;
      this.allocateRenderTargets();
    }

    if (!this.reflectionTarget || !this.refractionTarget) return;

    const outTarget = target ?? null;
    const prevAutoClear = renderer.autoClear;
    const prevXrEnabled = renderer.xr.enabled;
    const prevClearColor = new THREE.Color();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClearColor);

    renderer.xr.enabled = false;

    const cameraAboveWater = camera.position.y >= WATER_LEVEL;
    this.syncCommonUniforms(camera);

    // ------------------------------------------------------------
    // PASS 1: Dynamic Planar Reflection (mirrored virtual camera)
    // ------------------------------------------------------------
    renderer.autoClear = false;
    this.waterMesh.visible = false;
    if (this.skyMesh) {
      this.skyMesh.visible = !this.overlayMode;
    }

    this.updateReflectionCamera(camera);
    this.setSceneClip(cameraAboveWater ? 1.0 : -1.0, cameraAboveWater ? WATER_LEVEL - 0.08 : WATER_LEVEL + 0.08);

    renderer.setRenderTarget(this.reflectionTarget);
    renderer.setClearColor(0x091628, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.reflectionCamera);

    // ------------------------------------------------------------
    // PASS 2: Underwater Refraction & Depth Pass
    // ------------------------------------------------------------
    if (this.skyMesh) {
      // Only render sky in refraction when camera is underwater looking up (Snell's window)
      this.skyMesh.visible = !cameraAboveWater && !this.overlayMode;
    }
    this.setSceneClip(
      cameraAboveWater ? -1.0 : 1.0,
      cameraAboveWater ? WATER_LEVEL + 0.38 : WATER_LEVEL - 0.38,
    );

    renderer.setRenderTarget(this.refractionTarget);
    renderer.setClearColor(0x030c16, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, camera);

    // ------------------------------------------------------------
    // PASS 3: Final Water Surface + Scene Composite Pass
    // ------------------------------------------------------------
    this.waterMesh.visible = true;
    if (this.skyMesh) {
      this.skyMesh.visible = !this.overlayMode;
    }
    this.setSceneClip(0.0, 0.0);

    this.waterMaterial.uniforms.uReflectionMap.value = this.reflectionTarget.texture;
    this.waterMaterial.uniforms.uRefractionMap.value = this.refractionTarget.texture;
    this.waterMaterial.uniforms.uRefractionDepthMap.value = this.refractionTarget.depthTexture;
    (this.waterMaterial.uniforms.uReflectionMatrix.value as THREE.Matrix4).copy(
      this.reflectionMatrix,
    );

    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(outTarget);
    renderer.autoClear = this.overlayMode ? false : prevAutoClear;
    renderer.render(this.scene, camera);

    // Strictly restore renderer state & render target before returning
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXrEnabled;
    renderer.setRenderTarget(outTarget);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.disposeRenderTargets();

    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
    this.sceneMaterials.length = 0;
    this.orbitingLights.length = 0;

    this.scene.clear();
    this.skyMesh = null;
    this.skyMaterial = null;
    this.waterMesh = null;
    this.waterMaterial = null;
  }

  private allocateRenderTargets(): void {
    const rawW = Math.max(1, Math.floor(this.viewportWidth * this.pixelRatio));
    const rawH = Math.max(1, Math.floor(this.viewportHeight * this.pixelRatio));
    const maxDim = Math.max(256, this.maxTextureSize - 16);
    const scaleClamp = Math.max(rawW, rawH) > maxDim ? maxDim / Math.max(rawW, rawH) : 1.0;

    const refrW = Math.max(1, Math.floor(rawW * scaleClamp));
    const refrH = Math.max(1, Math.floor(rawH * scaleClamp));

    if (refrW === this.targetPixelWidth && refrH === this.targetPixelHeight && this.reflectionTarget && this.refractionTarget) {
      return;
    }

    this.targetPixelWidth = refrW;
    this.targetPixelHeight = refrH;

    this.disposeRenderTargets();

    const texType = this.useHalfFloatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const reflW = Math.max(1, Math.floor(refrW * 0.75));
    const reflH = Math.max(1, Math.floor(refrH * 0.75));

    this.reflectionTarget = new THREE.WebGLRenderTarget(reflW, reflH, {
      type: texType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.reflectionTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

    const depthTexture = new THREE.DepthTexture(refrW, refrH);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    this.refractionTarget = new THREE.WebGLRenderTarget(refrW, refrH, {
      type: texType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
    });
    this.refractionTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  }

  private disposeRenderTargets(): void {
    if (this.reflectionTarget) {
      this.reflectionTarget.dispose();
      this.reflectionTarget = null;
    }
    if (this.refractionTarget) {
      this.refractionTarget.depthTexture?.dispose();
      this.refractionTarget.dispose();
      this.refractionTarget = null;
    }
  }

  private buildSkyDome(): void {
    const geo = new THREE.SphereGeometry(180, 32, 24);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_DOME_VERTEX_SHADER,
      fragmentShader: SKY_DOME_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.skyMesh = mesh;
    this.skyMaterial = mat;
    this.disposables.push(geo, mat);
  }

  private createSceneMaterial(
    materialType: number,
    baseColorHex: number,
    emissiveHex = 0x000000,
    emissiveScale = 1.0,
  ): THREE.ShaderMaterial {
    const baseColor = new THREE.Color(baseColorHex);
    const emissiveColor = new THREE.Color(emissiveHex).multiplyScalar(emissiveScale);

    const mat = new THREE.ShaderMaterial({
      vertexShader: AQUATIC_SCENE_VERTEX_SHADER,
      fragmentShader: AQUATIC_SCENE_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uWaterLevel: { value: WATER_LEVEL },
        uClipSign: { value: 0 },
        uClipPlaneY: { value: 0 },
        uMaterialType: { value: materialType },
        uLightsEnabled: { value: this.lightsEnabled ? 1.0 : 0.0 },
        uBaseColor: { value: baseColor },
        uEmissiveColor: { value: emissiveColor },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uLightPositions: { value: this.lightPositions },
        uLightColors: { value: this.lightColors },
      },
      toneMapped: true,
    });

    this.sceneMaterials.push(mat);
    this.disposables.push(mat);
    return mat;
  }

  private buildAquaticArchitecture(): void {
    const stoneBasinMat = this.createSceneMaterial(0, 0x5c7488);
    const darkBasaltMat = this.createSceneMaterial(0, 0x18222e);
    const deckSlateMat = this.createSceneMaterial(0, 0x121923);
    const marbleColumnMat = this.createSceneMaterial(1, 0x62778d);
    const cyanCrystalMat = this.createSceneMaterial(2, 0x164e63, 0x22d3ee, 1.35);
    const emeraldCrystalMat = this.createSceneMaterial(2, 0x064e3b, 0x10b981, 1.35);
    const amberCrystalMat = this.createSceneMaterial(2, 0x78350f, 0xf59e0b, 1.25);
    const pearlSphereMat = this.createSceneMaterial(3, 0x94a3b8);
    const beaconMat = this.createSceneMaterial(4, 0xffffff, 0x38bdf8, 1.4);

    // 1. Carved Pool Floor & Concentric Stepped Terraces
    const floorGeo = new THREE.BoxGeometry(36, 0.8, 36);
    const floorMesh = new THREE.Mesh(floorGeo, stoneBasinMat);
    floorMesh.position.set(0, -4.6, 0);
    this.scene.add(floorMesh);
    this.disposables.push(floorGeo);

    // Stepped pool terrace frames (outer & mid ring ledges)
    this.addRingBorder(13.2, 16.0, -4.2, -1.65, stoneBasinMat);
    this.addRingBorder(10.6, 13.2, -4.2, -2.9, stoneBasinMat);

    // Central carved sanctuary dais
    const daisGeo = new THREE.CylinderGeometry(4.4, 5.2, 0.9, 8);
    const daisMesh = new THREE.Mesh(daisGeo, darkBasaltMat);
    daisMesh.position.set(0, -3.75, 0);
    this.scene.add(daisMesh);
    this.disposables.push(daisGeo);

    const innerDaisGeo = new THREE.CylinderGeometry(2.6, 3.1, 0.65, 8);
    const innerDaisMesh = new THREE.Mesh(innerDaisGeo, marbleColumnMat);
    innerDaisMesh.position.set(0, -3.0, 0);
    this.scene.add(innerDaisMesh);
    this.disposables.push(innerDaisGeo);

    // Outer perimeter stone coping & broad colonnade deck around pool (prevents void gaps)
    this.addRingBorder(15.85, 26.0, -4.5, 0.55, deckSlateMat);

    // 2. Octagonal Ring of Fluted Columns Piercing Through Waterline
    const colGeo = new THREE.CylinderGeometry(0.62, 0.74, 12.8, 20);
    const plinthGeo = new THREE.BoxGeometry(2.0, 1.1, 2.0);
    const capitalGeo = new THREE.BoxGeometry(2.1, 0.75, 2.1);
    this.disposables.push(colGeo, plinthGeo, capitalGeo);

    const colRadius = 11.4;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      // Leave front-center avenue slightly open for dramatic camera view
      if (Math.abs(Math.sin(angle) - 1.0) < 0.15) continue;

      const cx = Math.cos(angle) * colRadius;
      const cz = Math.sin(angle) * colRadius;

      const plinth = new THREE.Mesh(plinthGeo, darkBasaltMat);
      plinth.position.set(cx, -3.65, cz);
      plinth.rotation.y = -angle;
      this.scene.add(plinth);

      const column = new THREE.Mesh(colGeo, marbleColumnMat);
      column.position.set(cx, 2.2, cz);
      this.scene.add(column);

      const capital = new THREE.Mesh(capitalGeo, darkBasaltMat);
      capital.position.set(cx, 8.85, cz);
      capital.rotation.y = -angle;
      this.scene.add(capital);
    }

    // 3. Towering Above-Water Monolith Arches & Crown Beacons (strong planar reflections!)
    const pierGeo = new THREE.BoxGeometry(1.75, 16.0, 1.75);
    const archBeamGeo = new THREE.BoxGeometry(10.8, 1.15, 1.65);
    const archCrownGeo = new THREE.OctahedronGeometry(0.65, 0);
    this.disposables.push(pierGeo, archBeamGeo, archCrownGeo);

    const archConfigs: Array<{ x: number; z: number; rotY: number }> = [
      { x: 0, z: -15.4, rotY: 0 },
      { x: -15.4, z: 0, rotY: Math.PI / 2 },
      { x: 15.4, z: 0, rotY: Math.PI / 2 },
    ];

    for (const arch of archConfigs) {
      const archGroup = new THREE.Group();
      archGroup.position.set(arch.x, 0, arch.z);
      archGroup.rotation.y = arch.rotY;

      const leftPier = new THREE.Mesh(pierGeo, darkBasaltMat);
      leftPier.position.set(-4.5, 3.8, 0);
      archGroup.add(leftPier);

      const rightPier = new THREE.Mesh(pierGeo, darkBasaltMat);
      rightPier.position.set(4.5, 3.8, 0);
      archGroup.add(rightPier);

      const lintel = new THREE.Mesh(archBeamGeo, stoneBasinMat);
      lintel.position.set(0, 11.4, 0);
      archGroup.add(lintel);

      const beaconL = new THREE.Mesh(archCrownGeo, beaconMat);
      beaconL.position.set(-4.5, 12.6, 0);
      archGroup.add(beaconL);

      const beaconR = new THREE.Mesh(archCrownGeo, beaconMat);
      beaconR.position.set(4.5, 12.6, 0);
      archGroup.add(beaconR);

      this.scene.add(archGroup);
    }

    // 4. Submerged Sunken Pedestals & Iridescent Sanctuary Spheres
    const sunkenColGeo = new THREE.CylinderGeometry(0.55, 0.68, 2.4, 16);
    const sphereGeo = new THREE.SphereGeometry(0.68, 28, 20);
    this.disposables.push(sunkenColGeo, sphereGeo);

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const sx = Math.cos(angle) * 6.4;
      const sz = Math.sin(angle) * 6.4;

      const subCol = new THREE.Mesh(sunkenColGeo, marbleColumnMat);
      subCol.position.set(sx, -3.0, sz);
      this.scene.add(subCol);

      const sphere = new THREE.Mesh(sphereGeo, pearlSphereMat);
      sphere.position.set(sx, -1.25, sz);
      this.scene.add(sphere);
    }

    // Central Sanctuary Iridescent Core Sphere
    const centerSphereGeo = new THREE.IcosahedronGeometry(1.15, 3);
    const centerSphere = new THREE.Mesh(centerSphereGeo, pearlSphereMat);
    centerSphere.position.set(0, -1.55, 0);
    this.scene.add(centerSphere);
    this.disposables.push(centerSphereGeo);

    // 5. Submerged Glowing Crystal Clusters (caustic & refraction focal points)
    const crystalGeos = [
      new THREE.CylinderGeometry(0.02, 0.44, 2.75, 6),
      new THREE.CylinderGeometry(0.02, 0.34, 2.05, 6),
      new THREE.CylinderGeometry(0.02, 0.28, 1.55, 6),
    ];
    this.disposables.push(...crystalGeos);

    const crystalMats = [cyanCrystalMat, emeraldCrystalMat, amberCrystalMat];
    const crystalClusters: Array<{ x: number; z: number; baseH: number; matIdx: number }> = [
      { x: 0.0, z: 3.4, baseH: -3.2, matIdx: 0 },
      { x: -3.2, z: 2.1, baseH: -3.3, matIdx: 1 },
      { x: 3.2, z: 2.1, baseH: -3.3, matIdx: 2 },
      { x: -2.9, z: -2.8, baseH: -3.3, matIdx: 0 },
      { x: 2.9, z: -2.8, baseH: -3.3, matIdx: 1 },
      { x: -8.2, z: 5.5, baseH: -3.4, matIdx: 0 },
      { x: 8.2, z: 5.5, baseH: -3.4, matIdx: 2 },
      { x: -8.8, z: -4.8, baseH: -3.4, matIdx: 1 },
      { x: 8.8, z: -4.8, baseH: -3.4, matIdx: 0 },
      { x: 0.0, z: -7.6, baseH: -3.4, matIdx: 2 },
    ];

    for (let i = 0; i < crystalClusters.length; i++) {
      const c = crystalClusters[i]!;
      const mat = crystalMats[c.matIdx]!;

      const mainSpire = new THREE.Mesh(crystalGeos[0]!, mat);
      mainSpire.position.set(c.x, c.baseH + 1.25, c.z);
      mainSpire.rotation.set(0.08 * Math.sin(i), i * 0.7, 0.1 * Math.cos(i));
      this.scene.add(mainSpire);

      const sideSpire = new THREE.Mesh(crystalGeos[1]!, mat);
      sideSpire.position.set(c.x + 0.55, c.baseH + 0.85, c.z - 0.35);
      sideSpire.rotation.set(0.28, i * 1.1, -0.32);
      this.scene.add(sideSpire);

      const smallSpire = new THREE.Mesh(crystalGeos[2]!, mat);
      smallSpire.position.set(c.x - 0.45, c.baseH + 0.65, c.z + 0.42);
      smallSpire.rotation.set(-0.24, i * 1.5, 0.29);
      this.scene.add(smallSpire);
    }

    // 6. Dynamic Orbiting Light Orb Meshes
    const orbGeo = new THREE.SphereGeometry(0.24, 16, 16);
    this.disposables.push(orbGeo);

    const orbSpecs = [
      { hex: 0x38bdf8, radius: 8.2, speed: 0.52, phase: 0.0, baseY: 1.4, bobAmp: 0.8 },
      { hex: 0xf59e0b, radius: 7.4, speed: -0.44, phase: 1.57, baseY: -1.6, bobAmp: 0.7 },
      { hex: 0x10b981, radius: 9.0, speed: 0.38, phase: 3.14, baseY: -1.4, bobAmp: 0.6 },
      { hex: 0xa855f7, radius: 8.6, speed: -0.48, phase: 4.71, baseY: 2.1, bobAmp: 0.9 },
    ];

    for (const spec of orbSpecs) {
      const orbMat = this.createSceneMaterial(4, spec.hex, spec.hex, 1.3);
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      mesh.visible = this.lightsEnabled;
      this.scene.add(mesh);

      this.orbitingLights.push({
        mesh,
        baseColor: new THREE.Color(spec.hex),
        radius: spec.radius,
        speed: spec.speed,
        phase: spec.phase,
        baseY: spec.baseY,
        bobAmp: spec.bobAmp,
      });
    }
  }

  private addRingBorder(
    innerRadius: number,
    outerRadius: number,
    bottomY: number,
    topY: number,
    material: THREE.ShaderMaterial,
  ): void {
    const thickness = outerRadius - innerRadius;
    const height = topY - bottomY;
    const centerY = (topY + bottomY) * 0.5;
    const midOffset = (innerRadius + outerRadius) * 0.5;
    const fullSpan = outerRadius * 2;
    const innerSpan = innerRadius * 2;

    const northSouthGeo = new THREE.BoxGeometry(fullSpan, height, thickness);
    const eastWestGeo = new THREE.BoxGeometry(thickness, height, innerSpan);
    this.disposables.push(northSouthGeo, eastWestGeo);

    const north = new THREE.Mesh(northSouthGeo, material);
    north.position.set(0, centerY, -midOffset);
    this.scene.add(north);

    const south = new THREE.Mesh(northSouthGeo, material);
    south.position.set(0, centerY, midOffset);
    this.scene.add(south);

    const west = new THREE.Mesh(eastWestGeo, material);
    west.position.set(-midOffset, centerY, 0);
    this.scene.add(west);

    const east = new THREE.Mesh(eastWestGeo, material);
    east.position.set(midOffset, centerY, 0);
    this.scene.add(east);
  }

  private buildWaterSurface(): void {
    // 200x200 subdivided water plane => 80,000 triangles for Gerstner vertex stress + crisp curves
    const waterGeo = new THREE.PlaneGeometry(32, 32, 200, 200);
    waterGeo.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_SURFACE_VERTEX_SHADER,
      fragmentShader: WATER_SURFACE_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uWaterLevel: { value: WATER_LEVEL },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 400.0 },
        uLightsEnabled: { value: this.lightsEnabled ? 1.0 : 0.0 },
        uReflectionMap: { value: null },
        uRefractionMap: { value: null },
        uRefractionDepthMap: { value: null },
        uReflectionMatrix: { value: new THREE.Matrix4() },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uLightPositions: { value: this.lightPositions },
        uLightColors: { value: this.lightColors },
      },
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
      toneMapped: true,
    });

    this.waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
    this.waterMesh.position.set(0, WATER_LEVEL, 0);
    this.scene.add(this.waterMesh);

    this.disposables.push(waterGeo, this.waterMaterial);
  }

  private updateReflectionCamera(camera: THREE.PerspectiveCamera): void {
    camera.matrixWorld.extractBasis(this.tmpRight, this.tmpUp, this.tmpBack);
    this.tmpForward.copy(this.tmpBack).negate().normalize();
    this.tmpUp.normalize();

    this.tmpReflPos.set(
      camera.position.x,
      2.0 * WATER_LEVEL - camera.position.y,
      camera.position.z,
    );
    this.tmpReflForward.set(
      this.tmpForward.x,
      -this.tmpForward.y,
      this.tmpForward.z,
    );
    this.tmpReflUp.set(this.tmpUp.x, -this.tmpUp.y, this.tmpUp.z);

    this.reflectionCamera.fov = camera.fov;
    this.reflectionCamera.aspect = camera.aspect;
    this.reflectionCamera.near = camera.near;
    this.reflectionCamera.far = camera.far;
    this.reflectionCamera.updateProjectionMatrix();

    this.reflectionCamera.position.copy(this.tmpReflPos);
    this.reflectionCamera.up.copy(this.tmpReflUp);
    this.tmpLookAt.copy(this.tmpReflPos).add(this.tmpReflForward);
    this.reflectionCamera.lookAt(this.tmpLookAt);
    this.reflectionCamera.updateMatrixWorld(true);

    this.reflectionMatrix.multiplyMatrices(
      this.reflectionCamera.projectionMatrix,
      this.reflectionCamera.matrixWorldInverse,
    );
  }

  private setSceneClip(clipSign: number, clipPlaneY: number): void {
    for (const mat of this.sceneMaterials) {
      mat.uniforms.uClipSign.value = clipSign;
      mat.uniforms.uClipPlaneY.value = clipPlaneY;
    }
  }

  private syncCommonUniforms(camera: THREE.PerspectiveCamera): void {
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uTime.value = this.elapsedSec;
    }

    const lightsFlag = this.lightsEnabled ? 1.0 : 0.0;
    for (const mat of this.sceneMaterials) {
      mat.uniforms.uTime.value = this.elapsedSec;
      mat.uniforms.uLightsEnabled.value = lightsFlag;
      const posArr = mat.uniforms.uLightPositions.value as THREE.Vector3[];
      for (let i = 0; i < this.lightPositions.length; i++) {
        posArr[i]!.copy(this.lightPositions[i]!);
      }
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = this.elapsedSec;
      this.waterMaterial.uniforms.uCameraNear.value = camera.near;
      this.waterMaterial.uniforms.uCameraFar.value = camera.far;
      this.waterMaterial.uniforms.uLightsEnabled.value = lightsFlag;
      const waterPosArr = this.waterMaterial.uniforms.uLightPositions.value as THREE.Vector3[];
      for (let i = 0; i < this.lightPositions.length; i++) {
        waterPosArr[i]!.copy(this.lightPositions[i]!);
      }
    }
  }

  private applySceneSettings(): void {
    if (this.skyMesh) {
      this.skyMesh.visible = !this.overlayMode;
    }
    this.scene.background = null;
  }
}
