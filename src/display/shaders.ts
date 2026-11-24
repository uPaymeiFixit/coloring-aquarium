// GLSL for the three.js tank. three.js supplies the position and uv attributes and the matrices. World units:
// X across (0 in the middle), Y up from the sand (the surface is at the tank height), Z toward the viewer.

/** The moving web of light that sunlight makes through waves, 0..1. */
const CAUSTIC = `
float caustic(vec2 p, float t) {
  p *= 0.016;
  float a = sin(p.x * 1.9 + sin(p.y * 1.3 + t * 0.55) * 1.6 + t * 0.35);
  float b = sin(p.y * 2.3 + sin(p.x * 1.7 - t * 0.45) * 1.6 - t * 0.3);
  float c = sin((p.x + p.y) * 1.3 + sin(p.x * 0.9 - p.y * 1.1 + t * 0.4) * 1.4 + t * 0.25);
  return pow(1.0 - abs(a + b + c) / 3.0, 8.0);
}`;

/** Water haze: things further from the viewer fade toward the water's color at their height. */
const FOG = `
uniform vec3 uFogTop;
uniform vec3 uFogDeep;
uniform vec2 uFogRange;
uniform float uFogMax;
uniform float uTankHeight;
vec3 fogged(vec3 color, float alpha, float viewDepth, float height) {
  float amount = smoothstep(uFogRange.x, uFogRange.y, viewDepth) * uFogMax;
  vec3 water = mix(uFogDeep, uFogTop, clamp(height / uTankHeight, 0.0, 1.0));
  return mix(color, water * alpha, amount);
}`;

/** Places a mesh normally and passes on its world position and distance from the viewer. */
const PLACED_VERTEX = `
varying vec2 vUv;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

/** A quad straight onto the screen, for the water behind everything and the vignette over it. */
export const screenVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Open water: blue gradient, slanted light shafts and a shimmer at the top. */
export const waterFragment = `
uniform float uClock;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float y = 1.0 - vUv.y;
  vec3 c = mix(vec3(0.42, 0.83, 0.93), vec3(0.10, 0.52, 0.74), smoothstep(0.0, 0.5, y));
  c = mix(c, vec3(0.04, 0.25, 0.46), smoothstep(0.45, 1.0, y));
  float x = vUv.x * uAspect;
  float s = x + y * 0.4;
  float rays = pow(0.5 + 0.5 * sin(s * 6.0 + uClock * 0.21), 5.0) * 0.55
             + pow(0.5 + 0.5 * sin(s * 11.0 - uClock * 0.16 + 1.7), 7.0) * 0.35
             + pow(0.5 + 0.5 * sin(s * 2.7 + uClock * 0.09 + 0.4), 3.0) * 0.4;
  c += vec3(0.8, 0.97, 1.0) * rays * (1.0 - smoothstep(0.05, 0.9, y)) * 0.2;
  float ripple = 0.5 + 0.5 * sin(x * 38.0 + uClock * 1.8) * sin(x * 21.0 - uClock * 1.1 + y * 40.0);
  c += vec3(0.7, 0.95, 1.0) * ripple * (1.0 - smoothstep(0.0, 0.05, y)) * 0.3;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Darkens the corners a little. */
export const vignetteFragment = `
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  q.x *= uAspect * 0.75;
  float a = smoothstep(0.35, 0.95, length(q)) * 0.45;
  gl_FragColor = vec4(0.0, 0.02, 0.06, 1.0) * a;
}`;

/** Painted scenery standing in the tank (the back wall and the coral clusters), dappled by light and hazed by distance. */
export const sceneryVertex = PLACED_VERTEX;
export const sceneryFragment = `
uniform sampler2D uMap;
uniform float uClock;
uniform float uLight;
varying vec2 vUv;
varying vec3 vWorld;
varying float vDepth;
${FOG}
${CAUSTIC}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.02) discard;
  c.rgb += c.a * caustic(vWorld.xz, uClock) * uLight;
  c.rgb = fogged(c.rgb, c.a, vDepth, vWorld.y);
  gl_FragColor = c;
}`;

/** The sand floor, with the caustic light playing across it. */
export const floorVertex = PLACED_VERTEX;
export const floorFragment = `
uniform sampler2D uMap;
uniform float uClock;
varying vec2 vUv;
varying vec3 vWorld;
varying float vDepth;
${FOG}
${CAUSTIC}
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  c += caustic(vWorld.xz, uClock) * vec3(0.5, 0.6, 0.55) * 0.55;
  gl_FragColor = vec4(fogged(c, 1.0, vDepth, vWorld.y), 1.0);
}`;

/**
 * One drawing on a grid, bent by its rig. uRig: 0 = body wave (fish), 1 = limbs rocking about pivots (turtle),
 * 2 = bell pulse with trailing arms (jellyfish). Rig math works in template coordinates (x right, y down, faces
 * right); the result is laid in the mesh's plane, and a fish's tail also sways out of it, side to side.
 */
export const animalVertex = `
uniform vec2 uSize;
uniform float uTime;
uniform int uRig;
uniform vec4 uParams;
uniform vec4 uJointA[3];
uniform vec4 uJointB[3];
varying vec2 vUv;
varying vec3 vWorld;
varying float vDepth;
varying float vShade;
vec2 rotate2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
void main() {
  vec2 art = vec2(uv.x, 1.0 - uv.y);
  vec2 p = (art - 0.5) * uSize;
  float sway = 0.0;
  float shade = 1.0;
  if (uRig == 0) {
    // uParams: amplitude, waves along the body, tail sweep, where the rigid head starts
    float bend = clamp((uParams.w - art.x) / uParams.w, 0.0, 1.0);
    bend *= bend;
    float phase = uTime - art.x * uParams.y * 6.2831853;
    p.y += sin(phase) * uParams.x * uSize.y * bend * 0.6;
    sway = sin(phase) * uParams.z * 0.6 * uSize.x * bend;
    shade = 1.0 - 0.12 * bend * (0.5 + 0.5 * cos(phase));
  } else if (uRig == 1) {
    // uJointA: pivot and tip as template fractions; uJointB: half width (fraction of width), amplitude, phase, rate
    for (int i = 0; i < 3; i++) {
      vec4 a = uJointA[i];
      vec4 b = uJointB[i];
      if (b.y == 0.0) continue;
      vec2 pivot = (a.xy - 0.5) * uSize;
      vec2 axis = (a.zw - 0.5) * uSize - pivot;
      float len = length(axis);
      vec2 dir = axis / len;
      vec2 q = p - pivot;
      float along = dot(q, dir) / len;
      float across = abs(q.x * dir.y - q.y * dir.x) / uSize.x;
      float weight = smoothstep(0.05, 0.35, along) * (1.0 - smoothstep(b.x, b.x * 1.6, across));
      p = pivot + rotate2(q, b.y * sin(uTime * b.w + b.z) * weight);
    }
  } else {
    // uParams: where the bell ends (fraction of height), squeeze, arm sway
    float bellEnd = uParams.x;
    float squeeze = pow(0.5 + 0.5 * sin(uTime), 2.0) * uParams.y;
    float top = -0.5 * uSize.y;
    float rim = top + bellEnd * uSize.y;
    if (art.y < bellEnd) {
      float k = art.y / bellEnd;
      p.x *= 1.0 - squeeze * (0.3 + 0.7 * k);
      p.y = top + (p.y - top) * (1.0 + squeeze * 0.35);
    } else {
      float k = (art.y - bellEnd) / (1.0 - bellEnd);
      p.x *= 1.0 - squeeze * 0.7 * (1.0 - k);
      p.y += (rim - top) * squeeze * 0.35;
      p.x += sin(uTime * 0.7 - k * 5.0 + art.x * 2.0) * uParams.z * uSize.x * k;
      sway = cos(uTime * 0.6 - k * 4.0 + art.x * 3.0) * uParams.z * uSize.x * k;
    }
  }
  vUv = uv;
  vShade = shade;
  vec4 world = modelMatrix * vec4(p.x, -p.y, sway, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

export const animalFragment = `
uniform sampler2D uMap;
uniform float uBright;
uniform float uClock;
varying vec2 vUv;
varying vec3 vWorld;
varying float vDepth;
varying float vShade;
${FOG}
${CAUSTIC}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.02) discard;
  c.rgb *= vShade * uBright;
  c.rgb += c.a * caustic(vWorld.xz, uClock) * 0.09;
  c.rgb = fogged(c.rgb, c.a, vDepth, vWorld.y);
  gl_FragColor = c;
}`;

/** Seagrass blades rooted in the sand; the tip sways most. position is the root. */
export const plantVertex = `
attribute vec4 aBlade;
attribute vec4 aLook;
uniform float uClock;
varying vec3 vColor;
varying float vDepth;
varying float vHeight;
void main() {
  float t = aBlade.x;
  float sway = sin(uClock * 0.8 + aLook.w + t * 1.8) * 26.0 * t * t + sin(uClock * 1.9 + aLook.w * 1.7) * 5.0 * t;
  float halfWidth = aBlade.w * 0.5 * (1.0 - t * 0.92);
  vec3 world = vec3(position.x + sway + aBlade.y * halfWidth, aBlade.z * t, position.z + sway * 0.3);
  vColor = aLook.rgb * (0.65 + 0.5 * t);
  vHeight = world.y;
  vec4 view = viewMatrix * vec4(world, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

export const plantFragment = `
varying vec3 vColor;
varying float vDepth;
varying float vHeight;
${FOG}
void main() {
  gl_FragColor = vec4(fogged(vColor, 1.0, vDepth, vHeight), 1.0);
}`;

/** Bubbles as points: aSize is the radius in world units; uScale turns that into pixels at unit distance. */
export const bubbleVertex = `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -view.z;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * view;
}`;

export const bubbleFragment = `
varying float vAlpha;
void main() {
  vec2 local = gl_PointCoord * 2.0 - 1.0;
  float d = length(local);
  if (d > 1.0) discard;
  float rim = smoothstep(0.7, 0.9, d) * (1.0 - smoothstep(0.93, 1.0, d));
  float shine = 1.0 - smoothstep(0.0, 0.28, length(local - vec2(-0.35, -0.38)));
  float a = clamp(rim * 0.75 + 0.1 + shine * 0.8, 0.0, 1.0) * vAlpha;
  gl_FragColor = vec4(vec3(0.88, 0.98, 1.0) * a, a * 0.85);
}`;

/** The glow behind a drawing that just arrived, so its owner can find it. Adds light only. */
export const haloVertex = `
varying vec2 vLocal;
void main() {
  vLocal = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const haloFragment = `
uniform float uStrength;
uniform float uClock;
varying vec2 vLocal;
void main() {
  float d = length(vLocal);
  // Fade everything to nothing before the edge of the quad, so its square never shows.
  float edge = 1.0 - smoothstep(0.6, 1.0, d);
  float glow = exp(-d * d * 4.0);
  float rays = pow(0.5 + 0.5 * cos(atan(vLocal.y, vLocal.x) * 7.0 + uClock * 1.2), 10.0) * exp(-d * 2.6);
  float ring = exp(-pow((d - 0.5 - 0.06 * sin(uClock * 3.0)) * 9.0, 2.0)) * 0.5;
  float a = (glow * 0.45 + rays * 0.35 + ring) * uStrength * edge;
  gl_FragColor = vec4(vec3(1.0, 0.94, 0.65) * a, a);
}`;
