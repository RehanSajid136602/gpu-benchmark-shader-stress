export const SKY_DOME_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const SKY_DOME_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldDir;

uniform float uTime;
uniform vec3 uSunDir;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbmClouds(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.08 + vec2(4.7, -3.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  vec3 sunDir = normalize(uSunDir);

  float h = clamp(dir.y, -0.25, 1.0);
  float upMix = smoothstep(-0.08, 0.68, h);

  // Moody twilight ocean zenith transitioning to slate-teal & amber horizon
  vec3 zenithCol = vec3(0.025, 0.055, 0.135);
  vec3 midSkyCol = vec3(0.08, 0.21, 0.34);
  vec3 horizonCol = vec3(0.24, 0.34, 0.42);

  vec3 col = mix(horizonCol, midSkyCol, smoothstep(0.0, 0.24, max(h, 0.0)));
  col = mix(col, zenithCol, upMix);

  // Atmospheric sun glow & solar disc
  float sunCos = max(dot(dir, sunDir), 0.0);
  float sunHalo = pow(max(sunCos, 1e-5), 8.0);
  float sunCorona = pow(max(sunCos, 1e-5), 96.0);
  float sunDisc = smoothstep(0.9986, 0.9994, sunCos);

  col += vec3(0.85, 0.42, 0.18) * sunHalo * 0.42 * (1.0 - smoothstep(0.25, 0.85, max(h, 0.0)));
  col += vec3(1.4, 0.88, 0.52) * sunCorona * 0.85;
  col += vec3(4.2, 3.3, 2.2) * sunDisc;

  // High-altitude drifting cloud ribbons above horizon
  if (dir.y > 0.02) {
    vec2 cloudUv = dir.xz / (dir.y + 0.18) * 1.45 + vec2(uTime * 0.018, uTime * 0.008);
    float c = fbmClouds(cloudUv);
    float cloudMask = smoothstep(0.48, 0.82, c) * smoothstep(0.02, 0.22, dir.y);
    vec3 cloudDark = vec3(0.07, 0.12, 0.21);
    vec3 cloudLit = mix(vec3(0.28, 0.38, 0.50), vec3(1.15, 0.68, 0.42), pow(max(sunCos, 1e-5), 4.0));
    col = mix(col, mix(cloudDark, cloudLit, smoothstep(0.45, 0.78, c)), cloudMask * 0.72);
  }

  // Deep abyss darken below horizon
  if (dir.y < 0.0) {
    col = mix(col, vec3(0.015, 0.04, 0.07), 1.0 - smoothstep(-0.25, 0.0, dir.y));
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const AQUATIC_SCENE_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const AQUATIC_SCENE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform float uTime;
uniform float uWaterLevel;
uniform float uClipSign;
uniform float uClipPlaneY;
uniform float uMaterialType;
uniform float uLightsEnabled;

uniform vec3 uBaseColor;
uniform vec3 uEmissiveColor;
uniform vec3 uSunDir;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];

vec3 safeNormalize(vec3 v) {
  float len = length(v);
  return len > 1e-6 ? v / len : vec3(0.0, 1.0, 0.0);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Crisp cellular Voronoi bisector filament web for projected underwater caustics
float voronoiCaustic(vec2 uv, float t) {
  vec2 n = floor(uv);
  vec2 f = fract(uv);
  float d1 = 8.0;
  float d2 = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 neighbor = vec2(float(i), float(j));
      vec2 rnd = hash22(n + neighbor);
      vec2 pt = 0.5 + 0.42 * sin(t + 6.283185 * rnd);
      vec2 diff = neighbor + pt - f;
      float d = length(diff);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  // Optical focus ridge along Voronoi cell boundaries where refracted rays converge
  float edge = max(d2 - d1, 0.0);
  return exp(-9.5 * edge);
}

vec3 computeProjectedCaustics(vec3 worldPos, vec3 worldNormal, float depthBelow) {
  vec3 sunDir = safeNormalize(uSunDir);
  vec3 refractedSun = refract(-sunDir, vec3(0.0, 1.0, 0.0), 0.75);
  float tSurf = depthBelow / max(-refractedSun.y, 0.25);
  vec2 surfCoord = worldPos.xz - refractedSun.xz * tSurf;

  // Dual counter-drifting optical interference octaves with chromatic RGB dispersion
  float disp = 0.024 * clamp(depthBelow * 0.45, 0.25, 1.8);
  vec2 flow1 = vec2(uTime * 0.16, -uTime * 0.11);
  vec2 flow2 = vec2(-uTime * 0.13, uTime * 0.18);

  float rA = voronoiCaustic(surfCoord * 0.46 + flow1 + vec2(disp, 0.0), uTime * 1.35);
  float gA = voronoiCaustic(surfCoord * 0.46 + flow1, uTime * 1.35);
  float bA = voronoiCaustic(surfCoord * 0.46 + flow1 - vec2(disp, 0.0), uTime * 1.35);

  float rB = voronoiCaustic(surfCoord * 0.72 + flow2 + vec2(3.7 + disp, 1.9), -uTime * 1.12);
  float gB = voronoiCaustic(surfCoord * 0.72 + flow2 + vec2(3.7, 1.9), -uTime * 1.12);
  float bB = voronoiCaustic(surfCoord * 0.72 + flow2 + vec2(3.7 - disp, 1.9), -uTime * 1.12);

  vec3 layerA = vec3(rA, gA, bA);
  vec3 layerB = vec3(rB, gB, bB);
  vec3 causticNet = (layerA + layerB) * 0.55 + layerA * layerB * 1.25;

  float facing = clamp(dot(worldNormal, -refractedSun) * 0.8 + 0.25, 0.15, 1.0);
  float depthFade = smoothstep(0.0, 0.22, depthBelow) * exp(-depthBelow * 0.075);

  return causticNet * facing * depthFade * vec3(1.15, 1.45, 1.40);
}

// Procedural masonry block seams & surface micro-grain
float stoneTilePattern(vec3 p) {
  vec2 xzTile = abs(fract(p.xz * 0.38) - 0.5);
  float gridXZ = smoothstep(0.46, 0.495, max(xzTile.x, xzTile.y));
  float grain = 0.5 + 0.5 * sin(p.x * 3.1 + sin(p.z * 2.7)) * cos(p.y * 4.3 + p.z * 1.9);
  return mix(grain * 0.18, -0.22, gridXZ);
}

void main() {
  if (uClipSign > 0.5 && vWorldPos.y < uClipPlaneY) {
    discard;
  }
  if (uClipSign < -0.5 && vWorldPos.y > uClipPlaneY) {
    discard;
  }

  vec3 N = safeNormalize(vWorldNormal);
  vec3 V = safeNormalize(cameraPosition - vWorldPos);
  vec3 sunDir = safeNormalize(uSunDir);

  vec3 albedo = uBaseColor;
  float roughness = 0.62;
  float metallic = 0.08;
  vec3 emissive = uEmissiveColor;

  if (uMaterialType < 0.5) {
    // 0: Carved stone basin / monolith basalt
    float pat = stoneTilePattern(vWorldPos);
    albedo *= (0.92 + pat * 0.45);
    roughness = clamp(0.68 - pat * 0.2, 0.35, 0.92);
  } else if (uMaterialType < 1.5) {
    // 1: Fluted temple stone column
    float angle = atan(vWorldPos.z, vWorldPos.x);
    float flutes = sin(angle * 24.0 + vWorldPos.x * 2.0) * 0.08;
    albedo *= (0.95 + flutes);
    roughness = 0.48;
  } else if (uMaterialType < 2.5) {
    // 2: Bioluminescent submerged crystal
    float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 1e-5, 1.0), 2.4);
    float pulse = 0.85 + 0.25 * sin(uTime * 2.6 + vWorldPos.x * 0.7 + vWorldPos.z * 0.7);
    emissive = uEmissiveColor * (0.9 + 1.4 * fresnel) * pulse;
    roughness = 0.16;
    metallic = 0.15;
  } else if (uMaterialType < 3.5) {
    // 3: Iridescent metallic / pearl sanctuary sphere
    float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 1e-5, 1.0), 3.0);
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fresnel * 1.3 + vec3(0.0, 0.33, 0.67)));
    albedo = mix(uBaseColor, irid, 0.52);
    roughness = 0.14;
    metallic = 0.88;
  } else {
    // 4: Above-water crown beacon
    float pulse = 0.9 + 0.2 * sin(uTime * 3.1 + vWorldPos.x);
    emissive = uEmissiveColor * 2.2 * pulse;
    roughness = 0.15;
  }

  // Wetness darkening just above waterline
  float wetBand = 1.0 - smoothstep(0.0, 0.48, abs(vWorldPos.y - uWaterLevel));
  if (vWorldPos.y >= uWaterLevel - 0.05 && vWorldPos.y < uWaterLevel + 0.48) {
    albedo *= mix(1.0, 0.62, wetBand);
    roughness = mix(roughness, 0.18, wetBand);
  }

  // Direct sunlight + Blinn-Phong/GGX specular
  float ndotl = max(dot(N, sunDir), 0.0);
  vec3 halfDir = safeNormalize(sunDir + V);
  float specPow = mix(14.0, 140.0, 1.0 - roughness);
  float specMask = mix(0.015, 0.90, pow(max(1.0 - roughness, 1e-5), 2.6));
  float spec = pow(max(dot(N, halfDir), 1e-5), specPow) * specMask;

  // Ambient hemisphere sky/floor bounce
  vec3 skyAmbient = mix(vec3(0.035, 0.085, 0.14), vec3(0.18, 0.26, 0.38), N.y * 0.5 + 0.5);
  vec3 sunColor = vec3(1.45, 1.05, 0.72);
  vec3 sunContrib = (albedo * (1.0 - metallic * 0.6) * ndotl + mix(vec3(1.0), albedo, metallic) * spec) * sunColor;

  // Attenuate sunlight below water surface
  bool isSubmerged = vWorldPos.y < uWaterLevel;
  float depthBelow = max(0.0, uWaterLevel - vWorldPos.y);
  if (isSubmerged) {
    vec3 waterTint = exp(-vec3(0.32, 0.09, 0.06) * depthBelow);
    sunContrib *= waterTint;
  }

  vec3 lit = albedo * skyAmbient + sunContrib + emissive;

  // Dynamic orbiting bioluminescent / torch lights
  if (uLightsEnabled > 0.5) {
    for (int i = 0; i < 4; i++) {
      vec3 toLight = uLightPositions[i] - vWorldPos;
      float dist = max(length(toLight), 0.15);
      vec3 lDir = toLight / dist;
      float att = 1.0 / (1.0 + 0.085 * dist * dist);
      float lNdotL = max(dot(N, lDir), 0.0);
      vec3 lHalf = safeNormalize(lDir + V);
      float lSpec = pow(max(dot(N, lHalf), 1e-5), specPow * 0.75) * 0.65;
      lit += (albedo * lNdotL + lSpec) * uLightColors[i] * att * 2.8;
    }
  }

  // Project animated chromatic caustics onto submerged architecture
  if (isSubmerged && uMaterialType < 1.8) {
    vec3 caustics = computeProjectedCaustics(vWorldPos, N, depthBelow);
    lit += (albedo * 0.8 + vec3(0.28, 0.46, 0.52)) * caustics * 2.15;
  }

  // Subtle underwater depth tint in refraction pass
  if (isSubmerged) {
    float fogT = 1.0 - exp(-depthBelow * 0.055);
    lit = mix(lit, vec3(0.02, 0.14, 0.22), clamp(fogT, 0.0, 0.42));
  }

  gl_FragColor = vec4(max(lit, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const WATER_SURFACE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uWaterLevel;
uniform mat4 uReflectionMatrix;

varying vec3 vWorldPos;
varying vec3 vFlatWorldPos;
varying vec3 vWaveNormal;
varying vec3 vViewPos;
varying vec4 vClipPos;
varying vec4 vReflClipPos;
varying float vWaveHeight;

void addGerstnerWave(
  vec2 xz,
  vec2 dir,
  float steepness,
  float wavelength,
  float speedScale,
  inout vec3 offset,
  inout vec3 tangentX,
  inout vec3 tangentZ
) {
  float k = 6.2831853 / wavelength;
  float c = sqrt(9.8 / k) * speedScale;
  vec2 d = normalize(dir);
  float f = k * (dot(d, xz) - c * uTime);
  float a = steepness / k;

  float sinF = sin(f);
  float cosF = cos(f);

  offset.x += d.x * (a * cosF);
  offset.y += a * sinF;
  offset.z += d.y * (a * cosF);

  float wa = k * a;
  tangentX += vec3(
    -d.x * d.x * (steepness * sinF),
    d.x * (wa * cosF),
    -d.x * d.y * (steepness * sinF)
  );
  tangentZ += vec3(
    -d.x * d.y * (steepness * sinF),
    d.y * (wa * cosF),
    -d.y * d.y * (steepness * sinF)
  );
}

void main() {
  vec4 baseWorld = modelMatrix * vec4(position, 1.0);
  vec2 xz = baseWorld.xz;

  vec3 offset = vec3(0.0);
  vec3 tangentX = vec3(1.0, 0.0, 0.0);
  vec3 tangentZ = vec3(0.0, 0.0, 1.0);

  // 6 directional Gerstner waves with bounded total steepness so crests never fold
  addGerstnerWave(xz, vec2(0.88, 0.47), 0.14, 7.6, 1.05, offset, tangentX, tangentZ);
  addGerstnerWave(xz, vec2(-0.55, 0.83), 0.12, 5.2, 1.15, offset, tangentX, tangentZ);
  addGerstnerWave(xz, vec2(0.28, -0.96), 0.10, 3.6, 1.25, offset, tangentX, tangentZ);
  addGerstnerWave(xz, vec2(-0.92, -0.39), 0.08, 2.3, 1.35, offset, tangentX, tangentZ);
  addGerstnerWave(xz, vec2(0.65, 0.76), 0.06, 1.55, 1.45, offset, tangentX, tangentZ);
  addGerstnerWave(xz, vec2(-0.34, 0.94), 0.05, 1.05, 1.60, offset, tangentX, tangentZ);

  vec3 displacedWorld = vec3(
    baseWorld.x + offset.x,
    uWaterLevel + offset.y,
    baseWorld.z + offset.z
  );

  vFlatWorldPos = vec3(baseWorld.x, uWaterLevel, baseWorld.z);
  vWorldPos = displacedWorld;
  vWaveHeight = offset.y;
  vWaveNormal = normalize(cross(tangentZ, tangentX));

  vec4 viewPos = viewMatrix * vec4(displacedWorld, 1.0);
  vViewPos = viewPos.xyz;
  vClipPos = projectionMatrix * viewPos;
  vReflClipPos = uReflectionMatrix * vec4(vFlatWorldPos, 1.0);

  gl_Position = vClipPos;
}
`;

export const WATER_SURFACE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uWaterLevel;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uLightsEnabled;

uniform sampler2D uReflectionMap;
uniform sampler2D uRefractionMap;
uniform sampler2D uRefractionDepthMap;

uniform vec3 uSunDir;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];

varying vec3 vWorldPos;
varying vec3 vFlatWorldPos;
varying vec3 vWaveNormal;
varying vec3 vViewPos;
varying vec4 vClipPos;
varying vec4 vReflClipPos;
varying float vWaveHeight;

float rippleHeight(vec2 p, float t) {
  float h = 0.0;
  h += sin(p.x * 2.6 + p.y * 1.9 + t * 2.2) * 0.45;
  h += sin(p.x * -3.7 + p.y * 3.1 - t * 2.8) * 0.32;
  h += cos(p.x * 5.8 - p.y * 4.4 + t * 3.4) * 0.18;
  h += sin(p.x * 9.3 + p.y * 7.6 - t * 4.1) * 0.10;
  return h;
}

vec3 computeMicroNormal(vec2 xz, float t, float camDist) {
  float eps = 0.06;
  float hL = rippleHeight(xz - vec2(eps, 0.0), t);
  float hR = rippleHeight(xz + vec2(eps, 0.0), t);
  float hD = rippleHeight(xz - vec2(0.0, eps), t);
  float hU = rippleHeight(xz + vec2(0.0, eps), t);

  float strength = 0.095 * exp(-camDist * 0.022);
  return normalize(vec3((hL - hR) * strength, 1.0, (hD - hU) * strength));
}

float linearizeDepth(float depthSample) {
  float ndcZ = depthSample * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / max(uCameraFar + uCameraNear - ndcZ * (uCameraFar - uCameraNear), 1e-4);
}

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float camDist = length(toCam);
  vec3 V = toCam / max(camDist, 1e-4);
  vec3 sunDir = normalize(uSunDir);

  // Combine analytic Gerstner normal with animated capillary micro-ripples
  vec3 microN = computeMicroNormal(vWorldPos.xz, uTime, camDist);
  vec3 N = normalize(vec3(
    vWaveNormal.x + microN.x * 0.65,
    vWaveNormal.y,
    vWaveNormal.z + microN.z * 0.65
  ));

  bool underWaterView = !gl_FrontFacing || (cameraPosition.y < uWaterLevel - 0.02);
  if (underWaterView) {
    N = -N;
  }

  vec2 screenUV = (vClipPos.xy / max(vClipPos.w, 1e-4)) * 0.5 + 0.5;
  float edgeFade =
    smoothstep(0.0, 0.08, screenUV.x) *
    (1.0 - smoothstep(0.92, 1.0, screenUV.x)) *
    smoothstep(0.0, 0.08, screenUV.y) *
    (1.0 - smoothstep(0.92, 1.0, screenUV.y));

  // Refraction UV distortion with depth-aware above-water leak rejection
  vec2 distort = N.xz * 0.048 * edgeFade;
  vec2 refrUV = clamp(screenUV + distort, vec2(0.002), vec2(0.998));

  float waterLinearZ = max(-vViewPos.z, 0.05);
  float sceneLinearZ = linearizeDepth(texture2D(uRefractionDepthMap, refrUV).r);

  if (sceneLinearZ < waterLinearZ - 0.08) {
    refrUV = clamp(screenUV, vec2(0.002), vec2(0.998));
    distort = vec2(0.0);
    sceneLinearZ = linearizeDepth(texture2D(uRefractionDepthMap, refrUV).r);
  }

  float waterDepth = max(0.0, sceneLinearZ - waterLinearZ);

  // Subtle chromatic dispersion across RGB channels in refracted underwater view
  vec2 dispDelta = distort * 0.09;
  float rRefr = texture2D(uRefractionMap, clamp(refrUV + dispDelta, vec2(0.002), vec2(0.998))).r;
  float gRefr = texture2D(uRefractionMap, refrUV).g;
  float bRefr = texture2D(uRefractionMap, clamp(refrUV - dispDelta, vec2(0.002), vec2(0.998))).b;
  vec3 refrSample = vec3(rRefr, gRefr, bRefr);

  // Beer-Lambert optical absorption & volumetric subsurface scattering
  vec3 sigma = vec3(0.32, 0.095, 0.062);
  vec3 transmittance = exp(-sigma * waterDepth);
  vec3 deepAquaColor = vec3(0.018, 0.135, 0.22);
  vec3 refractedColor = mix(deepAquaColor, refrSample, transmittance);

  float sssAlignment = pow(max(dot(V, normalize(-sunDir + N * 0.55)), 1e-5), 3.0);
  float crestMask = smoothstep(-0.02, 0.22, vWaveHeight);
  refractedColor += vec3(0.04, 0.46, 0.52) * sssAlignment * crestMask * 0.65;

  // Dynamic planar reflection sampling
  vec2 reflUV = (vReflClipPos.xy / max(vReflClipPos.w, 1e-4)) * 0.5 + 0.5;
  reflUV = clamp(reflUV + N.xz * 0.056 * edgeFade, vec2(0.002), vec2(0.998));
  vec3 reflectedColor = texture2D(uReflectionMap, reflUV).rgb;

  // Schlick Fresnel reflection/refraction blend
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(max(1.0 - cosTheta, 1e-5), 5.0);
  if (underWaterView) {
    // Total internal reflection outside Snell's window
    fresnel = (1.0 - smoothstep(0.12, 0.45, cosTheta)) * 0.88 + 0.12;
  }

  vec3 waterColor = mix(refractedColor, reflectedColor, clamp(fresnel, 0.04, 0.96));

  // Crisp dual-lobe GGX-inspired solar glints
  vec3 halfVec = normalize(length(sunDir + V) > 1e-5 ? sunDir + V : vec3(0.0, 1.0, 0.0));
  float ndoth = max(dot(N, halfVec), 0.0);
  float tightGlint = pow(max(ndoth, 1e-5), 420.0) * 3.8;
  float broadSheen = pow(max(ndoth, 1e-5), 44.0) * 0.22;
  waterColor += vec3(1.65, 1.28, 0.88) * (tightGlint + broadSheen);

  // Orbiting dynamic light specular highlights across waves
  if (uLightsEnabled > 0.5) {
    for (int i = 0; i < 4; i++) {
      vec3 toLight = uLightPositions[i] - vWorldPos;
      float dist = max(length(toLight), 0.2);
      vec3 lDir = toLight / dist;
      vec3 lHalf = normalize(length(lDir + V) > 1e-5 ? lDir + V : vec3(0.0, 1.0, 0.0));
      float att = 1.0 / (1.0 + 0.06 * dist * dist);
      float lSpec = pow(max(dot(N, lHalf), 1e-5), 140.0);
      waterColor += uLightColors[i] * lSpec * att * 2.6;
    }
  }

  // Subtle shoreline / submerged-column meniscus foam
  float foamMask = (1.0 - smoothstep(0.02, 0.26, waterDepth)) * smoothstep(0.0, 0.06, waterDepth);
  float foamNoise = 0.5 + 0.5 * sin(vWorldPos.x * 7.5 + vWorldPos.z * 6.5 + uTime * 3.0);
  waterColor = mix(waterColor, vec3(0.68, 0.86, 0.94), foamMask * foamNoise * 0.42);

  gl_FragColor = vec4(max(waterColor, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
