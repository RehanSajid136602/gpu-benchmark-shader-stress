export const RAYMARCH_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const RAYMARCH_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
uniform float uTanHalfFov;
uniform float uFractalScale;
uniform float uMaxDist;
uniform float uBackgroundMode;
uniform float uLightsEnabled;

uniform vec3 uCameraPos;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uCameraForward;

#define MAX_RAY_STEPS 88
#define MIN_SURF_DIST 0.0014
#define PI_VAL 3.14159265359

mat2 rot2D(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

vec3 safeNormalize(vec3 v) {
  float len = length(v);
  return len > 1e-6 ? v / len : vec3(0.0, 1.0, 0.0);
}

// Fast 3D gyroid field for volumetric cosmic nebula filaments
float gyroidField(vec3 p) {
  return dot(sin(p), cos(p.yzx));
}

float nebulaFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.55;
  vec3 q = p;
  for (int i = 0; i < 3; i++) {
    sum += amp * abs(gyroidField(q));
    q = q * 2.07 + vec3(1.31, -0.87, 1.74);
    amp *= 0.48;
  }
  return sum;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

// Hybrid animated Mandelbulb + octahedral Menger fold accent + orbital rings
// Returns vec2(signedDistance, materialSelector), plus orbit trap for iridescence
vec2 mapFractal(vec3 worldPos, out vec4 outTrap) {
  vec3 shiftedWorld = worldPos - vec3(0.0, 3.2 * uBackgroundMode, 0.0);
  float invScale = 1.0 / max(uFractalScale, 0.001);
  vec3 p = shiftedWorld * invScale;

  // Gentle global breathing twist around Y
  p.xz = rot2D(uTime * 0.14) * p.xz;

  // Bounding sphere early-out so distant ray steps travel fast
  float boundR = length(p);
  if (boundR > 2.35) {
    outTrap = vec4(boundR, 1.0, 1.0, 1.0);
    float shellDist = (boundR - 1.55) * uFractalScale;
    // Also evaluate outer orbital ring so it stays visible from afar
    vec3 rp = shiftedWorld * invScale;
    rp.xy = rot2D(uTime * 0.25 + 0.55) * rp.xy;
    rp.yz = rot2D(0.45) * rp.yz;
    float outerRing = sdTorus(rp, vec2(1.48, 0.024)) * uFractalScale;
    if (outerRing < shellDist) {
      return vec2(outerRing, 2.0);
    }
    return vec2(shellDist, 0.0);
  }

  vec3 z = p;
  float dr = 1.0;
  float r = 0.0;
  float power = 8.0 + 0.75 * sin(uTime * 0.35);
  vec4 trap = vec4(abs(z), dot(z, z));

  for (int i = 0; i < 7; i++) {
    r = length(z);
    if (r > 3.2) {
      break;
    }

    // Subtle Menger-style fold accent on odd iterations for crisp geometric facets
    if (i == 1 || i == 3) {
      z = abs(z) - vec3(0.035 * sin(uTime * 0.22));
      if (z.x < z.y) z.xy = z.yx;
      if (z.x < z.z) z.xz = z.zx;
      if (z.y < z.z) z.yz = z.zy;
      z -= vec3(0.02);
    }

    float safeR = max(r, 1e-5);
    float theta = acos(clamp(z.z / safeR, -1.0, 1.0));
    float phi = atan(z.y, z.x);
    dr = pow(safeR, power - 1.0) * power * dr + 1.0;

    float zr = pow(safeR, power);
    float nTheta = theta * power + 0.18 * sin(uTime * 0.28);
    float nPhi = phi * power + 0.25 * cos(uTime * 0.21);

    float sinT = sin(nTheta);
    z = zr * vec3(
      sinT * cos(nPhi),
      sinT * sin(nPhi),
      cos(nTheta)
    ) + p;

    trap = min(trap, vec4(abs(z), dot(z, z)));
  }

  float bulbDist = 0.5 * log(max(r, 1.0001)) * r / max(dr, 1e-4);

  // Inner glowing energy core + precision orbital ring
  float coreDist = length(p) - 0.36;
  vec3 ringP = shiftedWorld * invScale;
  ringP.xy = rot2D(uTime * 0.25 + 0.55) * ringP.xy;
  ringP.yz = rot2D(0.45) * ringP.yz;
  float ringDist = sdTorus(ringP, vec2(1.48, 0.024));

  outTrap = trap;

  float d = bulbDist;
  float matId = 0.0;

  if (coreDist < d) {
    d = coreDist;
    matId = 1.0;
  }
  if (ringDist < d) {
    d = ringDist;
    matId = 2.0;
  }

  return vec2(d * uFractalScale, matId);
}

float mapDistanceOnly(vec3 worldPos) {
  vec4 unusedTrap = vec4(0.0);
  return mapFractal(worldPos, unusedTrap).x;
}

// Tetrahedron finite-difference normal (4 SDF taps)
vec3 calcNormal(vec3 p, float eps) {
  vec2 e = vec2(1.0, -1.0) * 0.57735027 * eps;
  return safeNormalize(
    e.xyy * mapDistanceOnly(p + e.xyy) +
    e.yyx * mapDistanceOnly(p + e.yyx) +
    e.yxy * mapDistanceOnly(p + e.yxy) +
    e.xxx * mapDistanceOnly(p + e.xxx)
  );
}

float calcAO(vec3 pos, vec3 nor, float scale) {
  float occ = 0.0;
  float weight = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = (0.025 + 0.075 * float(i)) * scale;
    float d = mapDistanceOnly(pos + h * nor);
    occ += (h - d) * weight;
    weight *= 0.52;
  }
  return clamp(1.0 - 2.6 * occ / max(scale, 1e-4), 0.08, 1.0);
}

float calcSoftShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 16; i++) {
    float h = mapDistanceOnly(ro + rd * t);
    if (h < 0.001) {
      return 0.04;
    }
    res = min(res, k * h / max(t, 1e-4));
    t += clamp(h, 0.025 * uFractalScale, 0.35 * uFractalScale);
    if (t > maxt) {
      break;
    }
  }
  return clamp(res, 0.04, 1.0);
}

// Thin-film iridescent color cosine palette
vec3 spectralPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.2831853 * (c * t + d));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rayDir = normalize(
    uCameraForward +
    ndc.x * uAspect * uTanHalfFov * uCameraRight +
    ndc.y * uTanHalfFov * uCameraUp
  );
  vec3 rayOrigin = uCameraPos;

  // Dynamic orbiting energy light positions in world space
  float orbitT = uTime * 0.72;
  vec3 keyLightDir = normalize(vec3(
    0.58 * cos(uTime * 0.12) + 0.25,
    0.66,
    0.52 * sin(uTime * 0.12) + 0.35
  ));
  vec3 cyanOrbPos = vec3(cos(orbitT) * 2.1, sin(orbitT * 1.3) * 0.9, sin(orbitT) * 2.1) * uFractalScale;
  vec3 amberOrbPos = vec3(cos(-orbitT * 0.85 + 2.1) * 1.9, cos(orbitT * 1.1) * 1.1, sin(-orbitT * 0.85 + 2.1) * 1.9) * uFractalScale;

  float t = 0.0;
  float hitMat = -1.0;
  vec4 hitTrap = vec4(0.0);
  float minClose = 1e5;
  vec3 glowAccum = vec3(0.0);
  float nebulaAccum = 0.0;

  float stepSurfEps = MIN_SURF_DIST * max(1.0, uFractalScale * 0.55);

  for (int i = 0; i < MAX_RAY_STEPS; i++) {
    vec3 pos = rayOrigin + rayDir * t;
    vec4 trap = vec4(0.0);
    vec2 res = mapFractal(pos, trap);
    float d = res.x;

    minClose = min(minClose, d / max(t, 0.25));

    // Volumetric glow accumulation near fractal ridges & orbital ring
    float glowDensity = exp(-abs(d) * (4.8 / max(uFractalScale, 0.5)));
    vec3 glowTint = mix(vec3(0.05, 0.38, 0.78), vec3(0.72, 0.26, 0.12), clamp(trap.w * 0.45, 0.0, 1.0));
    if (res.y > 1.5) {
      glowTint = vec3(0.18, 0.72, 0.98) * 1.25;
    }
    glowAccum += glowTint * glowDensity * 0.0028;

    // Lightweight volumetric nebula sampling along ray
    if (t < uMaxDist * 0.65 && mod(float(i), 2.0) < 0.5) {
      vec3 nebPos = (pos - vec3(0.0, 3.2 * uBackgroundMode, 0.0)) * (0.65 / max(uFractalScale, 0.5)) + vec3(0.0, uTime * 0.05, uTime * 0.03);
      float neb = nebulaFbm(nebPos);
      float radialFade = exp(-length(pos - vec3(0.0, 3.2 * uBackgroundMode, 0.0)) * (0.42 / max(uFractalScale, 0.5)));
      nebulaAccum += clamp(1.12 - neb, 0.0, 1.0) * radialFade * 0.0085;
    }

    if (d < stepSurfEps) {
      hitMat = res.y;
      hitTrap = trap;
      break;
    }

    t += max(d * 0.88, stepSurfEps * 0.75);
    if (t > uMaxDist) {
      break;
    }
  }

  // Deep midnight-indigo cosmic sky gradient
  float horizon = clamp(rayDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 skyCol = mix(vec3(0.003, 0.005, 0.012), vec3(0.008, 0.018, 0.044), pow(max(horizon, 1e-5), 1.6));
  float sunHalo = pow(max(dot(rayDir, keyLightDir), 1e-5), 20.0);
  skyCol += vec3(0.06, 0.14, 0.28) * sunHalo * 0.35;

  // Subtle volumetric cosmic nebula color
  vec3 nebulaColor = mix(vec3(0.03, 0.14, 0.36), vec3(0.30, 0.07, 0.42), clamp(rayDir.y * 0.5 + 0.5, 0.0, 1.0));
  skyCol += nebulaColor * nebulaAccum * 0.85;

  vec3 col = skyCol;

  if (hitMat >= 0.0) {
    vec3 hitPos = rayOrigin + rayDir * t;
    vec3 nor = calcNormal(hitPos, stepSurfEps * 1.6);
    vec3 viewDir = -rayDir;

    float ao = calcAO(hitPos, nor, uFractalScale);
    float aoContrast = pow(ao, 1.8);
    float shadow = calcSoftShadow(hitPos + nor * stepSurfEps * 3.0, keyLightDir, 0.03 * uFractalScale, 5.0 * uFractalScale, 10.0);

    float ndotl = max(dot(nor, keyLightDir), 0.0);
    vec3 halfVec = safeNormalize(keyLightDir + viewDir);
    float spec = pow(max(dot(nor, halfVec), 1e-5), 64.0);
    float fresnel = pow(clamp(1.0 - max(dot(nor, viewDir), 0.0), 1e-5, 1.0), 3.6);

    if (hitMat > 1.5) {
      // Precision glowing orbital ring
      vec3 ringCol = vec3(0.10, 0.56, 0.92) * (0.72 + 0.55 * fresnel);
      col = ringCol * (0.45 + 0.55 * ao) + vec3(0.75, 0.92, 1.0) * spec * 0.8;
    } else if (hitMat > 0.5) {
      // Inner molten core
      float pulse = 0.85 + 0.35 * sin(uTime * 2.4 + hitPos.y * 5.0);
      col = mix(vec3(0.88, 0.28, 0.05), vec3(0.14, 0.72, 0.98), fresnel) * 1.4 * pulse;
    } else {
      // Mandelbulb surface with rich obsidian-cobalt-violet-gold iridescence
      float trapIndex = clamp(hitTrap.w * 0.52 + hitTrap.x * 0.34, 0.0, 1.0);
      vec3 baseAlbedo = spectralPalette(
        trapIndex + uTime * 0.03,
        vec3(0.075, 0.095, 0.155),
        vec3(0.085, 0.105, 0.145),
        vec3(1.0, 1.0, 1.0),
        vec3(0.05, 0.22, 0.48)
      );
      vec3 iridescence = spectralPalette(
        fresnel * 1.25 + trapIndex * 0.6,
        vec3(0.16, 0.18, 0.24),
        vec3(0.18, 0.20, 0.24),
        vec3(1.0, 1.0, 1.0),
        vec3(0.0, 0.33, 0.67)
      );

      vec3 surfAlbedo = mix(baseAlbedo, iridescence, 0.28 + 0.48 * fresnel);

      // Ambient sky + key light + rim backlight with deep crevice shadows
      vec3 ambientLight = mix(vec3(0.012, 0.020, 0.045), vec3(0.045, 0.085, 0.16), nor.y * 0.5 + 0.5);
      vec3 keyColor = vec3(1.05, 0.92, 0.78);
      vec3 rimDir = normalize(vec3(-keyLightDir.x, 0.25, -keyLightDir.z));
      float rim = pow(clamp(1.0 - max(dot(nor, viewDir), 0.0), 1e-5, 1.0), 3.0) * max(dot(nor, rimDir), 0.0);

      vec3 lit = surfAlbedo * (ambientLight * aoContrast + keyColor * ndotl * shadow * 0.95 * aoContrast);
      lit += vec3(0.65, 0.84, 1.0) * spec * shadow * ao * 0.55;
      lit += vec3(0.12, 0.68, 0.96) * rim * 0.45 * aoContrast;
      lit += iridescence * (1.0 - ao) * 0.04;

      // Dynamic orbiting energy lights (saturated, non-white-clipping)
      if (uLightsEnabled > 0.5) {
        vec3 toCyan = cyanOrbPos - hitPos;
        float distC = max(length(toCyan), 0.05);
        vec3 dirC = toCyan / distC;
        float attC = 1.0 / (1.0 + 0.55 * distC * distC / max(uFractalScale * uFractalScale, 0.25));
        lit += surfAlbedo * vec3(0.08, 0.72, 1.0) * max(dot(nor, dirC), 0.0) * attC * aoContrast * 1.45;

        vec3 toAmber = amberOrbPos - hitPos;
        float distA = max(length(toAmber), 0.05);
        vec3 dirA = toAmber / distA;
        float attA = 1.0 / (1.0 + 0.55 * distA * distA / max(uFractalScale * uFractalScale, 0.25));
        lit += surfAlbedo * vec3(1.0, 0.42, 0.08) * max(dot(nor, dirA), 0.0) * attA * aoContrast * 1.45;
      }

      // Distance atmospheric blend into cosmic nebula
      float fogFactor = 1.0 - exp(-pow(max(t / max(uMaxDist * 0.85, 1.0), 1e-5), 2.2));
      col = mix(lit, skyCol, clamp(fogFactor, 0.0, 0.85));
    }
  } else {
    // Rim corona when rays graze near the fractal silhouette
    float corona = exp(-minClose * 9.5);
    col += vec3(0.08, 0.38, 0.78) * corona * 0.35;
  }

  // Add soft-saturated accumulated volumetric scattering & glow without washing out fractal surface
  vec3 softGlow = 1.0 - exp(-glowAccum);
  float glowScale = (hitMat >= 0.0 ? 0.14 : 0.65) * mix(1.0, 0.68, uBackgroundMode);
  col += softGlow * glowScale;

  // Subtle vignette only in standalone mode
  if (uBackgroundMode < 0.5) {
    vec2 q = vUv - 0.5;
    float vig = clamp(1.0 - dot(q, q) * 0.42, 0.68, 1.0);
    col *= vig;
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
