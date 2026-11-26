/**
 * Shaders for Stage 1 (500k Instanced Mesh Vertex Stress).
 *
 * Uses standard Three.js ShaderMaterial chunks (`#include <tonemapping_fragment>`
 * and `#include <colorspace_fragment>`) so WebGL2 GLSL 300 es compilation,
 * HDR Sandbox Bloom composition, and direct screen tone-mapping all work
 * cleanly with zero redeclaration or precision conflicts.
 */

export const INSTANCED_CRYSTAL_VERTEX_SHADER = /* glsl */ `
attribute vec4 aInstanceData;
attribute vec3 aInstanceColor;

uniform float uTime;
uniform float uLightsEnabled;
uniform vec3 uLightPositions[3];

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vEnergy;
varying float vRadialSeed;

mat3 rotateY(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(
    c, 0.0, -s,
    0.0, 1.0, 0.0,
    s, 0.0, c
  );
}

mat3 rotateAxisTilt(float a, float b) {
  float sa = sin(a);
  float ca = cos(a);
  float sb = sin(b);
  float cb = cos(b);
  return mat3(
    ca, sa * sb, sa * cb,
    0.0, cb, -sb,
    -sa, ca * sb, ca * cb
  );
}

void main() {
  float phase = aInstanceData.x;
  float speed = aInstanceData.y;
  float radialSeed = aInstanceData.z;
  float spinSeed = aInstanceData.w;

  // Local per-instance tumble animated purely on GPU
  float spinAngle = uTime * (0.9 + abs(spinSeed) * 1.4) * sign(spinSeed + 0.001) + phase;
  float tiltAngle = sin(uTime * speed * 1.15 + phase * 1.7) * 0.55;
  mat3 localSpin = rotateAxisTilt(spinAngle, tiltAngle);

  vec3 localPos = localSpin * position;
  vec3 localNorm = localSpin * normal;

  // Apply static base instanceMatrix
  vec4 instPos = instanceMatrix * vec4(localPos, 1.0);
  mat3 instMat3 = mat3(instanceMatrix);
  vec3 instNormal = normalize(instMat3 * localNorm);
  vec3 anchor = instanceMatrix[3].xyz;

  // Global orbital angular rate varies smoothly by radial band
  float baseRadius = max(length(anchor.xz), 0.35);
  float orbitalAngle = uTime * (0.14 + 0.28 / (1.0 + baseRadius * 0.16)) * (0.65 + 0.35 * speed);
  mat3 orbitRot = rotateY(orbitalAngle);

  vec3 orbitedPos = orbitRot * instPos.xyz;
  vec3 orbitedAnchor = orbitRot * anchor;
  vec3 orbitedNormal = normalize(orbitRot * instNormal);

  // Analytical 3D curl-like vortex wave displacement
  float t = uTime * speed;
  float waveA = sin(orbitedAnchor.x * 0.28 + t * 1.35 + phase);
  float waveB = cos(orbitedAnchor.z * 0.28 - t * 1.15 + phase * 1.3);
  float waveC = sin(baseRadius * 0.45 - uTime * 2.1 + phase * 0.5);

  vec3 radialDir = normalize(vec3(orbitedAnchor.x, 0.0, orbitedAnchor.z) + vec3(0.0001, 0.0, 0.0));
  vec3 tangentDir = vec3(-radialDir.z, 0.0, radialDir.x);

  vec3 curlOffset =
    radialDir * (waveC * 0.55 + waveA * 0.32) +
    vec3(0.0, 1.0, 0.0) * (sin(orbitedAnchor.x * 0.22 + orbitedAnchor.z * 0.22 + t * 1.5) * 0.72 + waveB * 0.28) +
    tangentDir * (cos(baseRadius * 0.32 + t * 1.1 + phase) * 0.42);

  // Traveling energy shockwave across the 500k swarm
  float pulseWave = sin(baseRadius * 0.52 - uTime * 2.85 + phase * 0.25);
  float shock = pow(max(pulseWave * 0.5 + 0.5, 0.0001), 4.0);

  // Proximity energy boost from dynamic light beacons when lights are enabled
  float lightBoost = 0.0;
  if (uLightsEnabled > 0.5) {
    for (int i = 0; i < 3; i++) {
      float d = length(orbitedAnchor - uLightPositions[i]);
      lightBoost += exp(-d * 0.22);
    }
  }

  vec3 finalWorldPos = (modelMatrix * vec4(orbitedPos + curlOffset * (0.45 + radialSeed * 0.65), 1.0)).xyz;
  vec3 finalWorldNormal = normalize(mat3(modelMatrix) * orbitedNormal);

  vWorldPos = finalWorldPos;
  vWorldNormal = finalWorldNormal;
  vColor = aInstanceColor;
  vEnergy = clamp(shock * 0.75 + lightBoost * 0.55, 0.0, 1.6);
  vRadialSeed = radialSeed;

  gl_Position = projectionMatrix * viewMatrix * vec4(finalWorldPos, 1.0);
}
`;

export const INSTANCED_CRYSTAL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;
uniform vec3 uLightPositions[3];
uniform vec3 uLightColors[3];

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vEnergy;
varying float vRadialSeed;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Obsidian metallic base shaded by key directional rim
  vec3 keyDir = normalize(vec3(0.45, 0.78, 0.42));
  float keyDiff = max(dot(N, keyDir), 0.0);
  vec3 keyH = normalize(keyDir + V);
  float keySpec = pow(max(dot(N, keyH), 0.0001), 42.0);

  // Cool sky/ground ambient hemisphere
  float hemi = N.y * 0.5 + 0.5;
  vec3 ambientCol = mix(vec3(0.014, 0.018, 0.032), vec3(0.055, 0.095, 0.16), hemi);

  vec3 baseAlbedo = vColor;
  vec3 color = baseAlbedo * (ambientCol * 1.45 + vec3(0.28, 0.36, 0.48) * keyDiff) +
               vec3(0.18, 0.26, 0.38) * keySpec * 0.55;

  // Fresnel rim accent (electric cyan -> molten amber gradient)
  float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0001, 1.0), 3.0);
  vec3 rimTint = mix(vec3(0.04, 0.68, 0.98), vec3(1.0, 0.56, 0.14), smoothstep(0.15, 0.85, 1.0 - vRadialSeed));

  if (uLightsEnabled > 0.5) {
    // 3 orbiting high-energy point lights for specular & colored scatter
    for (int i = 0; i < 3; i++) {
      vec3 toLight = uLightPositions[i] - vWorldPos;
      float distSq = dot(toLight, toLight);
      float dist = sqrt(max(distSq, 0.001));
      vec3 L = toLight / dist;
      float atten = 1.0 / (1.0 + 0.018 * distSq);

      float ndl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0001), 56.0);

      color += baseAlbedo * uLightColors[i] * (ndl * atten * 2.2);
      color += uLightColors[i] * (spec * atten * 2.4);
    }

    // Traveling shockwave & rim glow (HDR values > 1.0 bloom cleanly in Sandbox)
    color += rimTint * fresnel * (0.55 + vEnergy * 0.95);
    color += mix(baseAlbedo, rimTint, 0.65) * (vEnergy * 0.52);
  } else {
    color += rimTint * fresnel * 0.18;
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const INSTANCED_BACKDROP_VERTEX_SHADER = /* glsl */ `
varying vec3 vLocalDir;

void main() {
  vLocalDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const INSTANCED_BACKDROP_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;

varying vec3 vLocalDir;

void main() {
  vec3 dir = normalize(vLocalDir);
  float horizon = exp(-abs(dir.y) * 5.2);
  float zenith = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 deepObsidian = vec3(0.010, 0.014, 0.024);
  vec3 indigoSpace = vec3(0.022, 0.036, 0.068);
  vec3 horizonGlow = vec3(0.028, 0.095, 0.145);

  float azimuthWave = 0.5 + 0.5 * sin(atan(dir.z, dir.x + 1e-5) * 3.0 + uTime * 0.18);
  vec3 bandTint = mix(horizonGlow, vec3(0.11, 0.055, 0.022), azimuthWave * 0.45);

  vec3 color = mix(deepObsidian, indigoSpace, zenith * 0.65);
  color += bandTint * horizon * (uLightsEnabled > 0.5 ? 0.55 : 0.22);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
