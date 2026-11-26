import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { BenchmarkStage, CameraPreset, StageId } from '../types.ts';

export const COMBINED_MONOLITH_COUNT = 2_400;
export const COMBINED_PARTICLE_COUNT = 48_000;

const DECK_Y = -2.6;
const CORE_CENTER_Y = 1.45;
const ORB_COUNT = 4;

interface PointOrbRig {
  light: THREE.PointLight;
  orbMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  color: THREE.Color;
  radius: number;
  speed: number;
  phase: number;
  baseY: number;
  ampY: number;
}

interface SpotBeaconRig {
  light: THREE.SpotLight;
  target: THREE.Object3D;
  emitter: THREE.Mesh;
  radius: number;
  speed: number;
  phase: number;
}

const BACKDROP_VERT = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BACKDROP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;

varying vec3 vDir;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float horizon = exp(-abs(d.y) * 4.5);
  float upper = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 base = mix(vec3(0.008, 0.011, 0.020), vec3(0.018, 0.032, 0.062), upper * 0.75);
  float swirl = 0.5 + 0.5 * sin(atan(d.z, d.x + 1e-5) * 4.0 + uTime * 0.14);
  vec3 horizonBand = mix(vec3(0.024, 0.088, 0.145), vec3(0.11, 0.048, 0.035), swirl * 0.45);
  base += horizonBand * horizon * (uLightsEnabled > 0.5 ? 0.65 : 0.25);

  // Subtle starfield glints above horizon
  vec3 starCell = floor(d * 140.0);
  float starVal = hash31(starCell);
  float starMask = smoothstep(0.994, 0.9995, starVal) * smoothstep(0.02, 0.35, d.y);
  base += vec3(0.35, 0.68, 0.95) * starMask * 0.55;

  gl_FragColor = vec4(base, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const PLASMA_CORE_VERT = /* glsl */ `
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying float vDisp;

float gyroid(vec3 p) {
  return dot(sin(p), cos(p.yzx));
}

void main() {
  vec3 n = normalize(normal);
  float g1 = gyroid(position * 2.4 + vec3(uTime * 1.1, -uTime * 0.85, uTime * 0.7));
  float g2 = gyroid(position * 5.2 - vec3(uTime * 1.6, uTime * 1.2, -uTime * 1.4));
  float disp = g1 * 0.11 + g2 * 0.045;

  vec3 displaced = position + n * disp;
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);

  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  vLocalPos = position;
  vDisp = disp;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const PLASMA_CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying float vDisp;

float gyroid(vec3 p) {
  return dot(sin(p), cos(p.yzx));
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 p = vLocalPos * 2.8 + vec3(0.0, uTime * 0.65, 0.0);
  float f1 = gyroid(p);
  float f2 = gyroid(p * 2.1 - vec3(uTime * 0.95, -uTime * 0.7, uTime * 0.45));
  float plasma = clamp(0.5 + 0.5 * (f1 * 0.6 + f2 * 0.4), 0.0, 1.0);

  float vein = smoothstep(0.56, 0.92, plasma);
  float hotCore = smoothstep(0.80, 0.98, plasma);
  float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0001, 1.0), 2.4);

  vec3 obsidianShell = vec3(0.03, 0.05, 0.09);
  vec3 cyanPlasma = vec3(0.06, 0.82, 1.15);
  vec3 amberFlare = vec3(1.25, 0.62, 0.14);

  float energyScale = uLightsEnabled > 0.5 ? 1.0 : 0.42;
  vec3 color = mix(obsidianShell, cyanPlasma * 1.45, vein);
  color = mix(color, amberFlare * 1.95, hotCore * (0.65 + 0.35 * sin(uTime * 2.2)));
  color += mix(cyanPlasma, vec3(0.55, 0.88, 1.0), 0.4) * fresnel * 1.15;
  color += vec3(0.25, 0.85, 1.0) * max(vDisp, 0.0) * 2.4;
  color *= energyScale;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const AURA_SHELL_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const AURA_SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = abs(dot(N, V));
  float rim = pow(clamp(1.0 - ndv, 0.0001, 1.0), 2.8) * smoothstep(0.0, 0.38, ndv);

  float pulse = 0.78 + 0.22 * sin(uTime * 2.6 + vWorldPos.y * 2.2);
  vec3 auraCol = mix(vec3(0.06, 0.78, 1.05), vec3(1.0, 0.52, 0.18), 0.3 + 0.25 * sin(uTime * 1.4));
  float alpha = rim * pulse * (uLightsEnabled > 0.5 ? 0.58 : 0.24);

  gl_FragColor = vec4(auraCol * 1.15, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ENERGY_TORUS_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ENERGY_TORUS_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0001, 1.0), 2.2);

  float streamA = sin(vUv.x * 25.1327 - uTime * 4.2 + vUv.y * 6.2831);
  float streamB = cos(vUv.x * 37.6991 + uTime * 3.1 - vUv.y * 12.5663);
  float band = smoothstep(0.25, 0.95, streamA * 0.6 + streamB * 0.4);

  vec3 baseObs = vec3(0.025, 0.036, 0.062);
  vec3 cyanArc = vec3(0.08, 0.88, 1.25) * 1.55;
  vec3 amberArc = vec3(1.25, 0.58, 0.15) * 1.50;

  vec3 arcCol = mix(cyanArc, amberArc, 0.5 + 0.5 * sin(vUv.x * 6.2831 - uTime * 1.5));
  vec3 col = mix(baseObs, arcCol, band) + vec3(0.14, 0.72, 1.0) * fresnel * 0.65;
  col *= (uLightsEnabled > 0.5 ? 1.0 : 0.4);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MONOLITH_VERT = /* glsl */ `
attribute vec4 aMonoData;

uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vLocalY;
varying float vRingSeed;
varying float vGlowPhase;

mat3 rotY(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

void main() {
  float phase = aMonoData.x;
  float ringRate = aMonoData.y;
  float ringSeed = aMonoData.z;
  float waveAmp = aMonoData.w;

  vec3 anchor = instanceMatrix[3].xyz;
  float orbitAngle = uTime * ringRate;
  mat3 orbitMat = rotY(orbitAngle);

  // Kinetic harmonic elevation strictly positive/clamped above the mirror deck
  float lift = max(0.0, 0.65 + sin(uTime * 1.55 + phase) * waveAmp);
  vec3 localScaled = position;

  vec4 instPos = instanceMatrix * vec4(localScaled, 1.0);
  vec3 worldPos = orbitMat * instPos.xyz + vec3(0.0, lift, 0.0);
  worldPos.y = max(worldPos.y, -2.42);

  vec3 worldNorm = normalize(orbitMat * mat3(instanceMatrix) * normal);

  vWorldPos = (modelMatrix * vec4(worldPos, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * worldNorm);
  vLocalY = position.y;
  vRingSeed = ringSeed;
  vGlowPhase = 0.5 + 0.5 * sin(uTime * 2.3 + phase * 1.5);

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const MONOLITH_FRAG = /* glsl */ `
uniform float uLightsEnabled;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vLocalY;
varying float vRingSeed;
varying float vGlowPhase;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 obsidian = vec3(0.022, 0.028, 0.044);
  vec3 col = obsidian * (0.55 + 0.45 * max(N.y, 0.0));

  // Key fill from core center
  vec3 toCore = normalize(vec3(0.0, 1.45, 0.0) - vWorldPos);
  float coreDiff = max(dot(N, toCore), 0.0);
  col += vec3(0.06, 0.22, 0.36) * coreDiff * 0.65;

  if (uLightsEnabled > 0.5) {
    for (int i = 0; i < 4; i++) {
      vec3 toLight = uLightPositions[i] - vWorldPos;
      float distSq = dot(toLight, toLight);
      float dist = sqrt(max(distSq, 0.001));
      vec3 L = toLight / dist;
      float atten = 1.0 / (1.0 + 0.016 * distSq);

      float ndl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0001), 48.0);

      col += obsidian * uLightColors[i] * ndl * atten * 2.2;
      col += uLightColors[i] * spec * atten * 0.95;
    }
  }

  // Emissive crown strip at top + mid-channel + base trim of each hexagonal monolith (local y in 0..2.1)
  float crownBand = smoothstep(1.82, 2.05, vLocalY);
  float midChannel = 1.0 - smoothstep(0.0, 0.06, abs(vLocalY - 1.05));
  float baseTrim = 1.0 - smoothstep(0.0, 0.08, abs(vLocalY - 0.16));
  vec3 accentCol = mix(vec3(0.05, 0.72, 1.05), vec3(1.05, 0.48, 0.12), step(0.55, vRingSeed));
  float emissiveMask = crownBand + midChannel * 0.45 + baseTrim * 0.35;
  float glowStrength = uLightsEnabled > 0.5 ? (0.78 + 0.55 * vGlowPhase) : 0.25;
  col += accentCol * emissiveMask * glowStrength;

  float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0001, 1.0), 3.4);
  col += accentCol * fresnel * (uLightsEnabled > 0.5 ? 0.18 : 0.08);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SHARD_VERT = /* glsl */ `
attribute vec4 aShardData;
attribute vec3 aShardColor;

uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vPulse;

mat3 rotY(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

void main() {
  float phase = aShardData.x;
  float speed = aShardData.y;
  float orbitRate = aShardData.z;
  float verticalAmp = aShardData.w;

  mat3 localSpin = rotY(uTime * 1.8 * speed + phase);
  vec3 localPos = localSpin * position;
  vec3 localNorm = localSpin * normal;

  vec4 instPos = instanceMatrix * vec4(localPos, 1.0);
  vec3 anchor = instanceMatrix[3].xyz;
  mat3 orbitMat = rotY(uTime * orbitRate);

  vec3 orbPos = orbitMat * instPos.xyz;
  vec3 orbAnchor = orbitMat * anchor;

  float waveY = sin(uTime * speed * 1.4 + phase + length(orbAnchor.xz) * 0.25) * verticalAmp;
  vec3 radial = normalize(vec3(orbAnchor.x, 0.0, orbAnchor.z) + vec3(0.0001, 0.0, 0.0));
  vec3 worldPos = orbPos + radial * (sin(uTime * 1.3 + phase) * 0.45) + vec3(0.0, waveY, 0.0);

  // Keep every shard cleanly above the reflective obsidian mirror deck
  worldPos.y = max(worldPos.y, -2.18);

  vWorldPos = (modelMatrix * vec4(worldPos, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * orbitMat * mat3(instanceMatrix) * localNorm);
  vColor = aShardColor;
  vPulse = 0.65 + 0.55 * sin(uTime * 3.1 + phase * 2.0);

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const SHARD_FRAG = /* glsl */ `
uniform float uLightsEnabled;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vPulse;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0001, 1.0), 2.5);

  vec3 col = vColor * (0.42 + 0.52 * max(N.y, 0.0));

  if (uLightsEnabled > 0.5) {
    for (int i = 0; i < 4; i++) {
      vec3 toLight = uLightPositions[i] - vWorldPos;
      float distSq = dot(toLight, toLight);
      float dist = sqrt(max(distSq, 0.001));
      vec3 L = toLight / dist;
      float atten = 1.0 / (1.0 + 0.025 * distSq);
      float ndl = max(dot(N, L), 0.0);
      col += vColor * uLightColors[i] * ndl * atten * 0.95;
    }
    col += vColor * (fresnel * 0.45 + vPulse * 0.35);
  } else {
    col += vColor * fresnel * 0.20;
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MIRROR_DECK_VERT = /* glsl */ `
uniform mat4 uReflectionMatrix;

varying vec3 vWorldPos;
varying vec4 vReflClipPos;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vReflClipPos = uReflectionMatrix * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const MIRROR_DECK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;
uniform float uReflectionStrength;
uniform sampler2D uReflectionMap;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];

varying vec3 vWorldPos;
varying vec4 vReflClipPos;

float causticLayer(vec2 p, float t) {
  float acc = 0.0;
  vec2 q = p;
  for (int n = 0; n < 3; n++) {
    float fn = float(n + 1);
    float angle = float(n) * 1.0472;
    float cs = cos(angle);
    float sn = sin(angle);
    vec2 r = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    vec2 w = vec2(
      r.x + sin(r.y * 1.15 + t * (0.85 + 0.22 * fn)) * 0.85,
      r.y + cos(r.x * 1.15 - t * (0.75 + 0.18 * fn)) * 0.85
    );
    float field = sin(w.x * 2.1 + t * 0.65 * fn) + cos(w.y * 2.1 - t * 0.55 * fn);
    float ridge = clamp(1.0 - abs(field) * 0.72, 0.0001, 1.0);
    acc += pow(ridge, 9.0);
    q *= 1.42;
  }
  return clamp(acc / 1.45, 0.0, 1.0);
}

void main() {
  vec2 xz = vWorldPos.xz;
  float r = length(xz);

  // Multi-wave reactive concentric deck ripples
  float w1 = sin(r * 2.1 - uTime * 2.8);
  float w2 = cos(xz.x * 1.35 + xz.y * 1.15 + uTime * 1.9);
  float w3 = sin(xz.x * 2.4 - xz.y * 2.0 - uTime * 2.3);

  vec2 radialDir = r > 0.001 ? xz / r : vec2(1.0, 0.0);
  vec2 grad = radialDir * (w1 * 0.028) + vec2(w2 * 0.016, w3 * 0.016);
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Exact projective reflection UV distorted by ripple normal
  vec2 projUv = vReflClipPos.xy / max(vReflClipPos.w, 0.0001) * 0.5 + 0.5;
  vec2 reflUv = clamp(projUv + N.xz * 0.075, vec2(0.002), vec2(0.998));
  vec3 reflSample = clamp(texture2D(uReflectionMap, reflUv).rgb, vec3(0.0), vec3(6.0)) * uReflectionStrength;

  // Procedural caustics + concentric precision telemetry grid rings on obsidian deck
  float caust = causticLayer(xz * 0.42, uTime * 0.72);
  float ringWave = 1.0 - smoothstep(0.0, 0.04, abs(fract(r * 0.22 - uTime * 0.08) - 0.5));
  float radialSpoke = 1.0 - smoothstep(0.0, 0.035, abs(sin(atan(xz.y, xz.x + 1e-5) * 12.0)));

  vec3 obsidianBase = vec3(0.010, 0.014, 0.022);
  vec3 causticColor = mix(vec3(0.03, 0.52, 0.80), vec3(0.88, 0.45, 0.14), smoothstep(4.0, 18.0, r) * 0.4);
  vec3 deckSurface = obsidianBase + causticColor * caust * (uLightsEnabled > 0.5 ? 0.52 : 0.18);
  deckSurface += vec3(0.04, 0.52, 0.82) * ringWave * 0.18;
  deckSurface += vec3(0.03, 0.24, 0.40) * radialSpoke * (1.0 - smoothstep(4.0, 26.0, r)) * 0.14;

  // Dynamic orbiting PointLights specular & diffuse reflections on the mirror deck
  vec3 lightAccum = vec3(0.0);
  if (uLightsEnabled > 0.5) {
    for (int i = 0; i < 4; i++) {
      vec3 toLight = uLightPositions[i] - vWorldPos;
      float distSq = dot(toLight, toLight);
      float dist = sqrt(max(distSq, 0.001));
      vec3 L = toLight / dist;
      float atten = 1.0 / (1.0 + 0.016 * distSq);

      float ndl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0001), 96.0);

      lightAccum += uLightColors[i] * (ndl * 0.16 + spec * 1.15) * atten;
    }
  }

  float fresnel = mix(0.20, 0.88, pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0001, 1.0), 3.6));
  vec3 finalColor = mix(deckSurface, reflSample, fresnel) + lightAccum;

  // Smooth fade to obsidian void edge
  float edgeFade = 1.0 - smoothstep(25.0, 43.5, r);
  finalColor = mix(vec3(0.008, 0.011, 0.018), finalColor, edgeFade);

  gl_FragColor = vec4(finalColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

/**
 * Stage 4: Combined Scene with UnrealBloom Post-Processing & Dynamic Lights.
 *
 * Combines:
 * - High-density instanced architectural monolith rings (2,400) & orbital energy shards (48,000)
 * - Custom GLSL plasma centerpiece core + volumetric Fresnel aura shell + helical energy torus + metallic gimbal rings
 * - Real-time planar-reflected, caustic-lit reactive obsidian mirror deck
 * - Multiple dynamic orbiting PointLights + SpotLights with glowing emissive orbs
 * - EffectComposer + RenderPass + UnrealBloomPass + OutputPass
 */
export class CombinedBloomStage implements BenchmarkStage {
  public readonly id: StageId = 'combined';
  public readonly name = 'Combined Bloom & Dynamic Lighting';
  public readonly description =
    'Combines instanced monolith rings & 48k shards, glowing GLSL plasma core, planar mirror deck with caustics, 6 dynamic lights, and UnrealBloom.';
  public readonly weight = 0.20;

  private readonly scene = new THREE.Scene();
  private readonly stageGroup = new THREE.Group();
  private readonly coreGroup = new THREE.Group();
  private readonly lightsGroup = new THREE.Group();

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private reflectionTarget: THREE.WebGLRenderTarget | null = null;
  private readonly reflectionCamera = new THREE.PerspectiveCamera();

  // Offscreen target blit helper when caller provides a non-null target
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMaterial: THREE.ShaderMaterial | null = null;

  private backdropMaterial: THREE.ShaderMaterial | null = null;
  private coreMaterial: THREE.ShaderMaterial | null = null;
  private auraMaterial: THREE.ShaderMaterial | null = null;
  private torusMaterial: THREE.ShaderMaterial | null = null;
  private monolithMaterial: THREE.ShaderMaterial | null = null;
  private shardMaterial: THREE.ShaderMaterial | null = null;
  private floorMesh: THREE.Mesh | null = null;
  private floorMaterial: THREE.ShaderMaterial | null = null;

  private gimbalOuter: THREE.Mesh | null = null;
  private gimbalInner: THREE.Mesh | null = null;
  private torusMesh: THREE.Mesh | null = null;
  private coreMesh: THREE.Mesh | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  private readonly pointOrbs: PointOrbRig[] = [];
  private readonly spotBeacons: SpotBeaconRig[] = [];
  private readonly lightPositions: THREE.Vector3[] = [
    new THREE.Vector3(6, 1, 0),
    new THREE.Vector3(-6, 2, 0),
    new THREE.Vector3(0, 1, 6),
    new THREE.Vector3(0, 2, -6),
  ];
  private readonly lightColorsLinear: THREE.Color[] = [
    new THREE.Color(0x38bdf8).convertSRGBToLinear().multiplyScalar(1.85),
    new THREE.Color(0xf59e0b).convertSRGBToLinear().multiplyScalar(1.75),
    new THREE.Color(0xec4899).convertSRGBToLinear().multiplyScalar(1.70),
    new THREE.Color(0x2dd4bf).convertSRGBToLinear().multiplyScalar(1.65),
  ];

  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchLookTarget = new THREE.Vector3();

  private lightsEnabled = true;
  private lastDeltaSec = 1 / 60;
  private viewportWidth = 1280;
  private viewportHeight = 720;
  private initialized = false;
  private disposed = false;

  public init(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    this.renderer = renderer;
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);

    this.scene.background = null;
    this.scene.add(this.stageGroup);
    this.stageGroup.add(this.coreGroup);
    this.stageGroup.add(this.lightsGroup);

    this.initRenderTargetsAndComposer(renderer, this.viewportWidth, this.viewportHeight);
    this.buildBackdrop();
    this.buildDynamicLights();
    this.buildCenterpieceCore();
    this.buildMirrorDeck();
    this.buildInstancedMonoliths();
    this.buildInstancedEnergyShards();
    this.buildBlitQuad();
  }

  public resize(width: number, height: number): void {
    if (!this.initialized || this.disposed || !this.renderer) return;
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);

    const pixelRatio = this.renderer.getPixelRatio() || 1;
    const drawW = Math.max(1, Math.floor(this.viewportWidth * pixelRatio));
    const drawH = Math.max(1, Math.floor(this.viewportHeight * pixelRatio));

    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(this.viewportWidth, this.viewportHeight);
      this.bloomPass?.setSize(drawW, drawH);
    }

    if (this.reflectionTarget) {
      const reflW = Math.max(2, Math.floor(drawW * 0.5));
      const reflH = Math.max(2, Math.floor(drawH * 0.5));
      this.reflectionTarget.setSize(reflW, reflH);
    }
  }

  public getCameraPreset(): CameraPreset {
    return {
      position: [0, 4.4, 18.5],
      target: [0, 0.9, 0],
      fov: 56,
    };
  }

  public getGroup(): THREE.Group {
    return this.stageGroup;
  }

  public isLightsEnabled(): boolean {
    return this.lightsEnabled;
  }

  public setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
    this.lightsGroup.visible = enabled;
    for (const orb of this.pointOrbs) {
      orb.light.intensity = enabled ? 58 : 0;
    }
    for (const spot of this.spotBeacons) {
      spot.light.intensity = enabled ? 95 : 0;
    }
    if (this.ambientLight) {
      this.ambientLight.intensity = enabled ? 0.55 : 0.28;
    }

    const flag = enabled ? 1.0 : 0.0;
    if (this.backdropMaterial) this.backdropMaterial.uniforms.uLightsEnabled.value = flag;
    if (this.coreMaterial) this.coreMaterial.uniforms.uLightsEnabled.value = flag;
    if (this.auraMaterial) this.auraMaterial.uniforms.uLightsEnabled.value = flag;
    if (this.torusMaterial) this.torusMaterial.uniforms.uLightsEnabled.value = flag;
    if (this.monolithMaterial) this.monolithMaterial.uniforms.uLightsEnabled.value = flag;
    if (this.shardMaterial) this.shardMaterial.uniforms.uLightsEnabled.value = flag;
    if (this.floorMaterial) this.floorMaterial.uniforms.uLightsEnabled.value = flag;
  }

  public setOverlayMode(_enabled: boolean): void {
    // Combined stage always owns its full post-processed pipeline.
  }

  public setBackgroundMode(_enabled: boolean): void {
    // Kept for BenchmarkStage interface compatibility.
  }

  public update(
    elapsedSec: number,
    deltaSec: number,
    camera: THREE.PerspectiveCamera,
    isSandbox: boolean,
  ): void {
    if (!this.initialized || this.disposed) return;
    this.lastDeltaSec = Math.max(0.001, Math.min(deltaSec, 0.25));

    // Animate orbiting dynamic PointLights + visible emissive orbs
    for (let i = 0; i < this.pointOrbs.length; i++) {
      const orb = this.pointOrbs[i]!;
      const angle = elapsedSec * orb.speed + orb.phase;
      const x = Math.cos(angle) * orb.radius;
      const z = Math.sin(angle) * orb.radius;
      const y = orb.baseY + Math.sin(elapsedSec * 1.45 + orb.phase * 1.3) * orb.ampY;

      orb.light.position.set(x, y, z);
      orb.orbMesh.position.set(x, y, z);
      orb.ringMesh.position.set(x, y, z);
      orb.ringMesh.lookAt(camera.position);
      this.lightPositions[i]!.set(x, y, z);
    }

    // Animate sweeping SpotLights aimed across centerpiece & monoliths
    for (let i = 0; i < this.spotBeacons.length; i++) {
      const spot = this.spotBeacons[i]!;
      const angle = elapsedSec * spot.speed + spot.phase;
      const x = Math.cos(angle) * spot.radius;
      const z = Math.sin(angle) * spot.radius;
      const y = 9.2 + Math.sin(elapsedSec * 0.9 + spot.phase) * 1.1;
      spot.light.position.set(x, y, z);
      spot.emitter.position.set(x, y, z);

      const aimAngle = angle + Math.PI * 0.35;
      spot.target.position.set(
        Math.cos(aimAngle) * 2.5,
        -0.4 + Math.sin(elapsedSec * 1.1 + i) * 1.2,
        Math.sin(aimAngle) * 2.5,
      );
      spot.target.updateMatrixWorld();
    }

    // Centerpiece rotation & harmonic breathing
    if (this.coreMesh) {
      this.coreMesh.rotation.y = elapsedSec * 0.35;
      this.coreMesh.rotation.z = Math.sin(elapsedSec * 0.4) * 0.14;
    }
    if (this.torusMesh) {
      this.torusMesh.rotation.x = Math.PI * 0.36 + Math.sin(elapsedSec * 0.55) * 0.25;
      this.torusMesh.rotation.y = elapsedSec * 0.62;
    }
    if (this.gimbalOuter) {
      this.gimbalOuter.rotation.x = elapsedSec * 0.42;
      this.gimbalOuter.rotation.y = elapsedSec * 0.28;
    }
    if (this.gimbalInner) {
      this.gimbalInner.rotation.z = -elapsedSec * 0.58;
      this.gimbalInner.rotation.x = Math.cos(elapsedSec * 0.48) * 0.85;
    }

    // Update shader uniforms
    if (this.backdropMaterial) this.backdropMaterial.uniforms.uTime.value = elapsedSec;
    if (this.coreMaterial) this.coreMaterial.uniforms.uTime.value = elapsedSec;
    if (this.auraMaterial) this.auraMaterial.uniforms.uTime.value = elapsedSec;
    if (this.torusMaterial) this.torusMaterial.uniforms.uTime.value = elapsedSec;
    if (this.monolithMaterial) this.monolithMaterial.uniforms.uTime.value = elapsedSec;
    if (this.shardMaterial) this.shardMaterial.uniforms.uTime.value = elapsedSec;
    if (this.floorMaterial) this.floorMaterial.uniforms.uTime.value = elapsedSec;

    if (!isSandbox) {
      const orbitAngle = elapsedSec * 0.22;
      const radius = 17.5 + Math.sin(elapsedSec * 0.32) * 3.2;
      const elevation = 3.8 + Math.sin(elapsedSec * 0.38) * 2.1;
      camera.position.set(
        Math.sin(orbitAngle) * radius,
        elevation,
        Math.cos(orbitAngle) * radius,
      );
      camera.lookAt(0, 0.85, 0);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    target?: THREE.WebGLRenderTarget | null,
  ): void {
    if (!this.initialized || this.disposed || !this.composer || !this.renderPass) return;

    const prevAutoClear = renderer.autoClear;

    // Pass 1: Render planar reflection from mirrored virtual camera (floor hidden -> zero feedback loop)
    if (this.reflectionTarget && this.floorMesh && this.floorMaterial) {
      const aboveDeck = camera.position.y > DECK_Y + 0.05;
      if (aboveDeck) {
        this.floorMesh.visible = false;
        camera.getWorldDirection(this.scratchDir);
        this.scratchLookTarget.copy(camera.position).add(this.scratchDir);

        this.reflectionCamera.fov = camera.fov;
        this.reflectionCamera.aspect = camera.aspect;
        this.reflectionCamera.near = camera.near;
        this.reflectionCamera.far = camera.far;
        this.reflectionCamera.updateProjectionMatrix();

        this.reflectionCamera.position.set(
          camera.position.x,
          2 * DECK_Y - camera.position.y,
          camera.position.z,
        );
        this.reflectionCamera.up.set(0, 1, 0);
        this.reflectionCamera.lookAt(
          this.scratchLookTarget.x,
          2 * DECK_Y - this.scratchLookTarget.y,
          this.scratchLookTarget.z,
        );
        this.reflectionCamera.updateMatrixWorld(true);

        this.floorMaterial.uniforms.uReflectionMatrix.value.multiplyMatrices(
          this.reflectionCamera.projectionMatrix,
          this.reflectionCamera.matrixWorldInverse,
        );
        this.floorMaterial.uniforms.uReflectionStrength.value = 1.0;

        renderer.autoClear = true;
        renderer.setRenderTarget(this.reflectionTarget);
        renderer.setClearColor(0x04060c, 1);
        renderer.clear(true, true, true);
        renderer.render(this.scene, this.reflectionCamera);

        this.floorMesh.visible = true;
      } else {
        this.floorMaterial.uniforms.uReflectionStrength.value = 0.0;
      }
    }

    // Pass 2: EffectComposer (RenderPass -> UnrealBloomPass -> OutputPass)
    this.renderPass.camera = camera;
    renderer.autoClear = true;

    if (target) {
      this.composer.renderToScreen = false;
      renderer.setRenderTarget(null);
      this.composer.render(this.lastDeltaSec);

      if (this.blitMaterial) {
        this.blitMaterial.uniforms.tDiffuse.value = this.composer.readBuffer.texture;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x04060c, 1);
        renderer.clear(true, true, true);
        renderer.render(this.blitScene, this.blitCamera);
      }
      renderer.setRenderTarget(target);
    } else {
      this.composer.renderToScreen = true;
      renderer.setRenderTarget(null);
      this.composer.render(this.lastDeltaSec);
      renderer.setRenderTarget(null);
    }

    renderer.autoClear = prevAutoClear;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const im of this.instancedMeshes) {
      im.dispose();
    }
    this.instancedMeshes.length = 0;

    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.renderPass?.dispose();
    this.composer?.dispose();
    this.reflectionTarget?.dispose();

    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;

    this.pointOrbs.length = 0;
    this.spotBeacons.length = 0;
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.outputPass = null;
    this.reflectionTarget = null;
    this.blitMaterial = null;
    this.backdropMaterial = null;
    this.coreMaterial = null;
    this.auraMaterial = null;
    this.torusMaterial = null;
    this.monolithMaterial = null;
    this.shardMaterial = null;
    this.floorMesh = null;
    this.floorMaterial = null;
    this.gimbalOuter = null;
    this.gimbalInner = null;
    this.torusMesh = null;
    this.coreMesh = null;
    this.ambientLight = null;
    this.renderer = null;

    this.blitScene.clear();
    this.scene.clear();
  }

  private initRenderTargetsAndComposer(
    renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ): void {
    const pixelRatio = renderer.getPixelRatio() || 1;
    const drawW = Math.max(1, Math.floor(width * pixelRatio));
    const drawH = Math.max(1, Math.floor(height * pixelRatio));

    const canHalfFloat =
      renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('EXT_color_buffer_half_float');
    const rtType = canHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

    const reflW = Math.max(2, Math.floor(drawW * 0.5));
    const reflH = Math.max(2, Math.floor(drawH * 0.5));
    this.reflectionTarget = new THREE.WebGLRenderTarget(reflW, reflH, {
      type: rtType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });

    const composerTarget = new THREE.WebGLRenderTarget(drawW, drawH, {
      type: rtType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });

    this.composer = new EffectComposer(renderer, composerTarget);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);

    const placeholderCamera = new THREE.PerspectiveCamera(56, width / Math.max(1, height), 0.1, 300);
    this.renderPass = new RenderPass(this.scene, placeholderCamera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(drawW, drawH),
      0.42,
      0.44,
      1.08,
    );
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
  }

  private buildBackdrop(): void {
    const geo = new THREE.SphereGeometry(130, 32, 20);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
      },
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -20;
    mesh.frustumCulled = false;

    this.backdropMaterial = mat;
    this.disposables.push(geo, mat);
    this.stageGroup.add(mesh);
  }

  private buildDynamicLights(): void {
    const ambient = new THREE.AmbientLight(0x162238, 0.55);
    this.ambientLight = ambient;
    this.stageGroup.add(ambient);

    const orbGeo = new THREE.SphereGeometry(0.24, 20, 16);
    const ringGeo = new THREE.RingGeometry(0.32, 0.45, 24);
    const spotEmitterGeo = new THREE.OctahedronGeometry(0.22, 0);
    this.disposables.push(orbGeo, ringGeo, spotEmitterGeo);

    const pointSpecs = [
      { hex: 0x38bdf8, radius: 6.4, speed: 0.88, phase: 0.0, baseY: 1.5, ampY: 1.6 },
      { hex: 0xf59e0b, radius: 8.6, speed: -0.72, phase: Math.PI * 0.5, baseY: 1.0, ampY: 1.4 },
      { hex: 0xec4899, radius: 10.4, speed: 0.61, phase: Math.PI, baseY: 2.2, ampY: 1.8 },
      { hex: 0x2dd4bf, radius: 7.4, speed: -0.95, phase: Math.PI * 1.5, baseY: 0.6, ampY: 1.3 },
    ];

    for (let i = 0; i < ORB_COUNT; i++) {
      const spec = pointSpecs[i]!;
      const light = new THREE.PointLight(spec.hex, 48, 42, 1.45);
      const orbMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.hex).multiplyScalar(2.4),
        toneMapped: false,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.hex).multiplyScalar(1.25),
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const orbMesh = new THREE.Mesh(orbGeo, orbMat);
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);

      this.disposables.push(orbMat, ringMat);
      this.lightsGroup.add(light, orbMesh, ringMesh);
      this.pointOrbs.push({
        light,
        orbMesh,
        ringMesh,
        color: this.lightColorsLinear[i]!,
        radius: spec.radius,
        speed: spec.speed,
        phase: spec.phase,
        baseY: spec.baseY,
        ampY: spec.ampY,
      });
    }

    const spotSpecs = [
      { hex: 0x38bdf8, radius: 11.5, speed: 0.34, phase: 0.4 },
      { hex: 0xf59e0b, radius: 11.5, speed: -0.29, phase: Math.PI + 0.4 },
    ];

    for (const spec of spotSpecs) {
      const target = new THREE.Object3D();
      const spot = new THREE.SpotLight(spec.hex, 75, 48, Math.PI * 0.24, 0.55, 1.2);
      spot.target = target;

      const emitterMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.hex).multiplyScalar(2.0),
        toneMapped: false,
      });
      const emitter = new THREE.Mesh(spotEmitterGeo, emitterMat);

      this.disposables.push(emitterMat);
      this.lightsGroup.add(spot, target, emitter);
      this.spotBeacons.push({
        light: spot,
        target,
        emitter,
        radius: spec.radius,
        speed: spec.speed,
        phase: spec.phase,
      });
    }
  }

  private buildCenterpieceCore(): void {
    this.coreGroup.position.set(0, CORE_CENTER_Y, 0);

    // 1. Custom GLSL Plasma Core Sphere
    const coreGeo = new THREE.IcosahedronGeometry(1.52, 5);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
      },
      vertexShader: PLASMA_CORE_VERT,
      fragmentShader: PLASMA_CORE_FRAG,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.coreMesh = coreMesh;
    this.coreMaterial = coreMat;
    this.disposables.push(coreGeo, coreMat);
    this.coreGroup.add(coreMesh);

    // 2. Volumetric Fresnel Corona Aura Shell
    const auraGeo = new THREE.SphereGeometry(2.35, 48, 32);
    const auraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
      },
      vertexShader: AURA_SHELL_VERT,
      fragmentShader: AURA_SHELL_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const auraMesh = new THREE.Mesh(auraGeo, auraMat);
    this.auraMaterial = auraMat;
    this.disposables.push(auraGeo, auraMat);
    this.coreGroup.add(auraMesh);

    // 3. Helical Energy Containment Torus
    const torusGeo = new THREE.TorusGeometry(2.85, 0.20, 32, 128);
    const torusMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
      },
      vertexShader: ENERGY_TORUS_VERT,
      fragmentShader: ENERGY_TORUS_FRAG,
    });
    const torusMesh = new THREE.Mesh(torusGeo, torusMat);
    this.torusMesh = torusMesh;
    this.torusMaterial = torusMat;
    this.disposables.push(torusGeo, torusMat);
    this.coreGroup.add(torusMesh);

    // 4. Counter-rotating metallic obsidian gimbal rings illuminated by PointLights & SpotLights
    const outerGeo = new THREE.TorusGeometry(3.65, 0.11, 20, 128);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.92,
      roughness: 0.16,
      emissive: new THREE.Color(0x0ea5e9),
      emissiveIntensity: 0.35,
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    this.gimbalOuter = outerMesh;

    const innerGeo = new THREE.TorusGeometry(4.25, 0.085, 20, 128);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.90,
      roughness: 0.18,
      emissive: new THREE.Color(0xf59e0b),
      emissiveIntensity: 0.28,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.gimbalInner = innerMesh;

    this.disposables.push(outerGeo, outerMat, innerGeo, innerMat);
    this.coreGroup.add(outerMesh, innerMesh);
  }

  private buildMirrorDeck(): void {
    const floorGeo = new THREE.CircleGeometry(44, 96);
    floorGeo.rotateX(-Math.PI / 2);

    const floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
        uReflectionStrength: { value: 1.0 },
        uReflectionMap: { value: this.reflectionTarget?.texture ?? null },
        uReflectionMatrix: { value: new THREE.Matrix4() },
        uLightPositions: { value: this.lightPositions },
        uLightColors: { value: this.lightColorsLinear },
      },
      vertexShader: MIRROR_DECK_VERT,
      fragmentShader: MIRROR_DECK_FRAG,
    });

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = DECK_Y;
    this.floorMesh = floorMesh;
    this.floorMaterial = floorMat;
    this.disposables.push(floorGeo, floorMat);
    this.stageGroup.add(floorMesh);
  }

  private buildInstancedMonoliths(): void {
    // Hexagonal obsidian prism monoliths whose base sits at local y = 0..2.1
    const geo = new THREE.CylinderGeometry(0.16, 0.24, 2.1, 6);
    geo.translate(0, 1.05, 0);

    const monoData = new Float32Array(COMBINED_MONOLITH_COUNT * 4);
    const dataAttr = new THREE.InstancedBufferAttribute(monoData, 4);
    geo.setAttribute('aMonoData', dataAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
        uLightPositions: { value: this.lightPositions },
        uLightColors: { value: this.lightColorsLinear },
      },
      vertexShader: MONOLITH_VERT,
      fragmentShader: MONOLITH_FRAG,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, COMBINED_MONOLITH_COUNT);
    mesh.frustumCulled = false;
    const matrixArray = mesh.instanceMatrix.array as Float32Array;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const euler = new THREE.Euler();

    let seed = 0x1a2b3c4d;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const ringCounts = [600, 840, 960];
    const ringRadii = [8.2, 13.6, 20.0];
    const ringRates = [0.09, -0.065, 0.045];
    let idx = 0;

    for (let ring = 0; ring < 3; ring++) {
      const count = ringCounts[ring]!;
      const baseR = ringRadii[ring]!;
      const rate = ringRates[ring]!;

      for (let j = 0; j < count; j++) {
        const theta = (j / count) * Math.PI * 2 + (rand() - 0.5) * 0.04;
        const r = baseR + (rand() - 0.5) * (1.8 + ring * 1.1);
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = DECK_Y + 0.1 + ring * 0.12;

        const hScale = 0.65 + (ring * 0.35 + rand() * 0.95);
        const wScale = 0.75 + rand() * 0.55;

        pos.set(x, y, z);
        euler.set(0, -theta, 0);
        quat.setFromEuler(euler);
        scale.set(wScale, hScale, wScale);
        matrix.compose(pos, quat, scale);
        matrixArray.set(matrix.elements, idx * 16);

        const dOffset = idx * 4;
        monoData[dOffset] = theta * 3.0 + rand() * Math.PI;
        monoData[dOffset + 1] = rate;
        monoData[dOffset + 2] = ring / 2 + rand() * 0.35;
        monoData[dOffset + 3] = 0.35 + rand() * 0.7;

        idx++;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.monolithMaterial = mat;
    this.instancedMeshes.push(mesh);
    this.disposables.push(geo, mat);
    this.stageGroup.add(mesh);
  }

  private buildInstancedEnergyShards(): void {
    const geo = new THREE.OctahedronGeometry(0.056, 0);
    geo.scale(0.7, 1.5, 0.7);
    geo.computeVertexNormals();

    const shardData = new Float32Array(COMBINED_PARTICLE_COUNT * 4);
    const shardColors = new Float32Array(COMBINED_PARTICLE_COUNT * 3);
    geo.setAttribute('aShardData', new THREE.InstancedBufferAttribute(shardData, 4));
    geo.setAttribute('aShardColor', new THREE.InstancedBufferAttribute(shardColors, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLightsEnabled: { value: 1.0 },
        uLightPositions: { value: this.lightPositions },
        uLightColors: { value: this.lightColorsLinear },
      },
      vertexShader: SHARD_VERT,
      fragmentShader: SHARD_FRAG,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, COMBINED_PARTICLE_COUNT);
    mesh.frustumCulled = false;
    const matrixArray = mesh.instanceMatrix.array as Float32Array;

    const colCyan = new THREE.Color(0x38bdf8).convertSRGBToLinear().multiplyScalar(0.95);
    const colAmber = new THREE.Color(0xf59e0b).convertSRGBToLinear().multiplyScalar(1.05);
    const colMagenta = new THREE.Color(0xec4899).convertSRGBToLinear().multiplyScalar(0.95);
    const colObsidian = new THREE.Color(0x1e293b).convertSRGBToLinear();
    const scratchCol = new THREE.Color();

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const euler = new THREE.Euler();

    let seed = 0x7349ab12;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < COMBINED_PARTICLE_COUNT; i++) {
      const arm = i % 2 === 0 ? 0 : Math.PI;
      const t = Math.pow(rand(), 0.72);
      const r = 4.6 + t * 18.5;
      const theta = arm + r * 0.34 + (rand() - 0.5) * (0.65 + t * 0.9);
      const y = -1.6 + rand() * 7.8;

      pos.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
      euler.set(rand() * Math.PI, theta, rand() * Math.PI);
      quat.setFromEuler(euler);
      scale.setScalar(0.55 + rand() * 0.95);
      matrix.compose(pos, quat, scale);
      matrixArray.set(matrix.elements, i * 16);

      const dOffset = i * 4;
      shardData[dOffset] = rand() * Math.PI * 2;
      shardData[dOffset + 1] = 0.65 + rand() * 1.1;
      shardData[dOffset + 2] = (i % 2 === 0 ? 0.14 : -0.11) * (0.7 + 0.5 * (1 - t));
      shardData[dOffset + 3] = 0.35 + rand() * 0.75;

      const roll = rand();
      if (roll < 0.42) {
        scratchCol.copy(colCyan).lerp(colObsidian, rand() * 0.35);
      } else if (roll < 0.72) {
        scratchCol.copy(colAmber).lerp(colObsidian, rand() * 0.3);
      } else if (roll < 0.88) {
        scratchCol.copy(colMagenta);
      } else {
        scratchCol.copy(colObsidian);
      }

      const cOffset = i * 3;
      shardColors[cOffset] = scratchCol.r;
      shardColors[cOffset + 1] = scratchCol.g;
      shardColors[cOffset + 2] = scratchCol.b;
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.shardMaterial = mat;
    this.instancedMeshes.push(mesh);
    this.disposables.push(geo, mat);
    this.stageGroup.add(mesh);
  }

  private buildBlitQuad(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
      },
      vertexShader: BLIT_VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const quad = new THREE.Mesh(geo, mat);
    quad.frustumCulled = false;
    this.blitMaterial = mat;
    this.disposables.push(geo, mat);
    this.blitScene.add(quad);
  }
}

export default CombinedBloomStage;
