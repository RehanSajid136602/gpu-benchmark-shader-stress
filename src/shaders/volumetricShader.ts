export const VOLUMETRIC_SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;

void main() {
  vWorldDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const VOLUMETRIC_SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;
uniform vec3 uSunDir;

varying vec3 vWorldDir;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vWorldDir);
  vec3 sunDir = normalize(uSunDir);

  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 zenith = vec3(0.012, 0.020, 0.048);
  vec3 horizon = vec3(0.055, 0.032, 0.078);
  vec3 sky = mix(horizon, zenith, pow(up, 0.8));

  // Mie-like forward scattering around the volumetric core
  float sunDot = max(0.0, dot(dir, sunDir));
  float mie = pow(sunDot, 10.0) * 0.65 + pow(sunDot, 48.0) * 1.15;
  vec3 scatterCol = mix(vec3(0.22, 0.56, 0.95), vec3(1.0, 0.62, 0.25), pow(sunDot, 4.0));
  sky += scatterCol * mie * (uLightsEnabled > 0.5 ? 1.0 : 0.35);

  // Subtle volumetric ray bands radiating from core direction
  float angle = atan(dir.y - sunDir.y, dir.x - sunDir.x + 1e-5);
  float shafts = 0.5 + 0.5 * sin(angle * 14.0 + uTime * 0.35) * cos(angle * 9.0 - uTime * 0.22);
  sky += vec3(0.18, 0.42, 0.72) * pow(shafts, 3.0) * pow(sunDot, 2.5) * 0.35;

  // Starfield
  float starVal = hash31(floor(dir * 160.0));
  float starMask = smoothstep(0.995, 0.9996, starVal);
  sky += vec3(0.65, 0.82, 1.0) * starMask * 0.65;

  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const VOLUMETRIC_SHAFT_VERT = /* glsl */ `
attribute vec4 aShaftData; // x: phase, y: speed, z: intensity, w: hueShift
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vShaftData;

void main() {
  vUv = uv;
  vShaftData = aShaftData;

  vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vViewPos = -mvPos.xyz;
  vNormalView = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * mvPos;
}
`;

export const VOLUMETRIC_SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightsEnabled;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vShaftData;

void main() {
  vec3 viewDir = normalize(vViewPos);
  float edgeFade = pow(abs(dot(normalize(vNormalView), viewDir)), 1.65);

  // Fade softly at both ends of the cone
  float lengthFade = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.12, vUv.y);

  // Animated volumetric noise bands along the shaft
  float pulse = 0.65 + 0.35 * sin(vUv.y * 12.0 - uTime * (1.2 + vShaftData.y) + vShaftData.x);
  float radial = 0.75 + 0.25 * sin(vUv.x * 18.8495 + uTime * 0.8);

  vec3 colA = vec3(0.16, 0.72, 1.0);
  vec3 colB = vec3(0.98, 0.56, 0.18);
  vec3 col = mix(colA, colB, vShaftData.w);

  float alpha = edgeFade * lengthFade * pulse * radial * vShaftData.z * (uLightsEnabled > 0.5 ? 0.22 : 0.09);
  gl_FragColor = vec4(col * alpha * 1.4, alpha);
}
`;

export const OVERDRAW_CLOUD_VERT = /* glsl */ `
attribute vec4 aCloudParams; // x: radius, y: angleOffset, z: speed, w: size
attribute vec3 aCloudColor;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float t = uTime * aCloudParams.z + aCloudParams.y;
  float r = aCloudParams.x * (0.85 + 0.15 * sin(t * 0.7 + aCloudParams.y));

  vec3 pos = position;
  pos.x = cos(t) * r + sin(t * 1.7) * 0.85;
  pos.z = sin(t) * r + cos(t * 1.3) * 0.85;
  pos.y += sin(t * 1.4 + aCloudParams.x * 0.4) * 1.35;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(1.0, -mvPosition.z);

  gl_PointSize = clamp((aCloudParams.w * uPixelRatio * 260.0) / dist, 2.0, 128.0);
  gl_Position = projectionMatrix * mvPosition;

  vColor = aCloudColor;
  vAlpha = 0.085 + 0.045 * sin(t * 2.0);
}
`;

export const OVERDRAW_CLOUD_FRAG = /* glsl */ `
uniform float uTime;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;

  // Soft Gaussian-like volumetric falloff with subtle internal swirl
  float falloff = exp(-r2 * 2.8) * (1.0 - r2);
  float swirl = 0.85 + 0.15 * sin(atan(uv.y, uv.x) * 3.0 + uTime * 1.5);
  float alpha = falloff * swirl * vAlpha;

  gl_FragColor = vec4(vColor * alpha * 1.5, alpha);
}
`;
