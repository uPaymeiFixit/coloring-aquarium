// GLSL for the tank. World units: the tank is 1000 units tall, x runs right and y runs down.

const CLIP = `
vec4 toClip(vec2 world, vec2 size) {
  return vec4(world.x / size.x * 2.0 - 1.0, 1.0 - world.y / size.y * 2.0, 0.0, 1.0);
}`;

/** The moving web of light that sunlight makes through waves, 0..1. */
const CAUSTIC = `
float caustic(vec2 p, float t) {
  p *= 0.016;
  float a = sin(p.x * 1.9 + sin(p.y * 1.3 + t * 0.55) * 1.6 + t * 0.35);
  float b = sin(p.y * 2.3 + sin(p.x * 1.7 - t * 0.45) * 1.6 - t * 0.3);
  float c = sin((p.x + p.y) * 1.3 + sin(p.x * 0.9 - p.y * 1.1 + t * 0.4) * 1.4 + t * 0.25);
  return pow(1.0 - abs(a + b + c) / 3.0, 8.0);
}`;

export const screenVertex = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Open water: blue gradient, slanted light shafts and a shimmer at the surface. */
export const waterFragment = `#version 300 es
precision highp float;
uniform float uClock;
uniform vec2 uWorld;
in vec2 vUV;
out vec4 outColor;
void main() {
  float y = vUV.y;
  vec3 c = mix(vec3(0.42, 0.83, 0.93), vec3(0.10, 0.52, 0.74), smoothstep(0.0, 0.5, y));
  c = mix(c, vec3(0.04, 0.25, 0.46), smoothstep(0.45, 1.0, y));
  float x = vUV.x * uWorld.x / uWorld.y;
  float s = x + y * 0.4;
  float rays = pow(0.5 + 0.5 * sin(s * 6.0 + uClock * 0.21), 5.0) * 0.55
             + pow(0.5 + 0.5 * sin(s * 11.0 - uClock * 0.16 + 1.7), 7.0) * 0.35
             + pow(0.5 + 0.5 * sin(s * 2.7 + uClock * 0.09 + 0.4), 3.0) * 0.4;
  c += vec3(0.8, 0.97, 1.0) * rays * (1.0 - smoothstep(0.05, 0.9, y)) * 0.2;
  float ripple = 0.5 + 0.5 * sin(x * 38.0 + uClock * 1.8) * sin(x * 21.0 - uClock * 1.1 + y * 40.0);
  c += vec3(0.7, 0.95, 1.0) * ripple * (1.0 - smoothstep(0.0, 0.05, y)) * 0.3;
  outColor = vec4(c, 1.0);
}`;

/** The painted reef backdrop, with caustic light playing over the sand and low corals. */
export const reefFragment = `#version 300 es
precision highp float;
uniform sampler2D uReef;
uniform float uClock;
uniform vec2 uWorld;
in vec2 vUV;
out vec4 outColor;
${CAUSTIC}
void main() {
  vec4 c = texture(uReef, vUV);
  float light = caustic(vUV * uWorld, uClock) * smoothstep(0.6, 0.95, vUV.y);
  c.rgb += c.a * light * vec3(0.5, 0.6, 0.55) * 0.55;
  outColor = c;
}`;

/** Darkens the corners a little. */
export const vignetteFragment = `#version 300 es
precision highp float;
uniform vec2 uWorld;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec2 q = vUV - 0.5;
  q.x *= uWorld.x / uWorld.y * 0.75;
  float a = smoothstep(0.35, 0.95, length(q)) * 0.45;
  outColor = vec4(0.0, 0.02, 0.06, 1.0) * a;
}`;

/**
 * One drawing on a grid mesh. uRig picks the motion: 0 = body wave (fish), 1 = limbs rocking about pivots
 * (turtle), 2 = bell pulse with trailing arms (jellyfish). Art faces right; uFacing mirrors and squeezes it to turn.
 */
export const animalVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUV;
uniform vec2 uWorld;
uniform vec2 uPos;
uniform vec2 uSize;
uniform float uFacing;
uniform float uAngle;
uniform float uScale;
uniform float uTime;
uniform int uRig;
uniform vec4 uParams;
uniform vec4 uJointA[3];
uniform vec4 uJointB[3];
out vec2 vUV;
out vec2 vWorld;
out float vShade;
${CLIP}
vec2 rotate(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
void main() {
  vec2 p = (aUV - 0.5) * uSize;
  float shade = 1.0;
  if (uRig == 0) {
    // uParams: amplitude, waves along the body, tail sweep, where the rigid head starts
    float bend = clamp((uParams.w - aUV.x) / uParams.w, 0.0, 1.0);
    bend *= bend;
    float phase = uTime - aUV.x * uParams.y * 6.2831853;
    p.y += sin(phase) * uParams.x * uSize.y * bend;
    // The tail also swings toward and away from the viewer, which reads as a squeeze along x.
    float sweep = 0.5 + 0.5 * cos(phase);
    float hinge = (uParams.w - 0.5) * uSize.x;
    p.x = hinge + (p.x - hinge) * (1.0 - uParams.z * bend * sweep);
    shade = 1.0 - 0.18 * bend * sweep;
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
      p = pivot + rotate(q, b.y * sin(uTime * b.w + b.z) * weight);
    }
  } else {
    // uParams: where the bell ends (fraction of height), squeeze, arm sway
    float bellEnd = uParams.x;
    float squeeze = pow(0.5 + 0.5 * sin(uTime), 2.0) * uParams.y;
    float top = -0.5 * uSize.y;
    float rim = top + bellEnd * uSize.y;
    if (aUV.y < bellEnd) {
      float k = aUV.y / bellEnd;
      p.x *= 1.0 - squeeze * (0.3 + 0.7 * k);
      p.y = top + (p.y - top) * (1.0 + squeeze * 0.35);
    } else {
      float k = (aUV.y - bellEnd) / (1.0 - bellEnd);
      p.x *= 1.0 - squeeze * 0.7 * (1.0 - k);
      p.y += (rim - top) * squeeze * 0.35;
      p.x += sin(uTime * 0.7 - k * 5.0 + aUV.x * 2.0) * uParams.z * uSize.x * k;
    }
  }
  p.x *= uFacing;
  p = rotate(p, uAngle) * uScale;
  vec2 world = uPos + p;
  vUV = aUV;
  vWorld = world;
  vShade = shade;
  gl_Position = toClip(world, uWorld);
}`;

export const animalFragment = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uFog;
uniform vec3 uFogColor;
uniform float uBright;
uniform float uClock;
in vec2 vUV;
in vec2 vWorld;
in float vShade;
out vec4 outColor;
${CAUSTIC}
void main() {
  vec4 c = texture(uTex, vUV);
  c.rgb *= vShade * uBright;
  c.rgb += c.a * caustic(vWorld, uClock) * 0.09;
  c.rgb = mix(c.rgb, uFogColor * c.a, uFog);
  outColor = c;
}`;

/** Seagrass blades that sway; the root stays put and the tip moves most. */
export const plantVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aRoot;
layout(location = 1) in vec4 aBlade;
layout(location = 2) in vec4 aLook;
uniform vec2 uWorld;
uniform float uClock;
out vec3 vColor;
${CLIP}
void main() {
  float t = aBlade.x;
  float sway = sin(uClock * 0.8 + aLook.w + t * 1.8) * 26.0 * t * t + sin(uClock * 1.9 + aLook.w * 1.7) * 5.0 * t;
  float halfWidth = aBlade.w * 0.5 * (1.0 - t * 0.92);
  vec2 world = aRoot + vec2(sway + aBlade.y * halfWidth, -aBlade.z * t);
  vColor = aLook.rgb * (0.65 + 0.5 * t);
  gl_Position = toClip(world, uWorld);
}`;

export const plantFragment = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}`;

/** Instanced bubbles: each instance is x, y, radius and opacity. */
export const bubbleVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBubble;
uniform vec2 uWorld;
out vec2 vLocal;
out float vAlpha;
${CLIP}
void main() {
  vLocal = aCorner;
  vAlpha = aBubble.w;
  gl_Position = toClip(aBubble.xy + aCorner * aBubble.z, uWorld);
}`;

export const bubbleFragment = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vAlpha;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  if (d > 1.0) discard;
  float rim = smoothstep(0.7, 0.9, d) * (1.0 - smoothstep(0.93, 1.0, d));
  float shine = 1.0 - smoothstep(0.0, 0.28, length(vLocal - vec2(-0.35, -0.38)));
  float a = clamp(rim * 0.75 + 0.1 + shine * 0.8, 0.0, 1.0) * vAlpha;
  outColor = vec4(vec3(0.88, 0.98, 1.0) * a, a * 0.85);
}`;

/** The glow behind a drawing that just arrived, so its owner can find it. Adds light only. */
export const haloVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform vec2 uWorld;
uniform vec2 uCenter;
uniform float uRadius;
out vec2 vLocal;
${CLIP}
void main() {
  vLocal = aCorner;
  gl_Position = toClip(uCenter + aCorner * uRadius, uWorld);
}`;

export const haloFragment = `#version 300 es
precision highp float;
uniform float uStrength;
uniform float uClock;
in vec2 vLocal;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float glow = exp(-d * d * 3.0);
  float rays = pow(0.5 + 0.5 * cos(atan(vLocal.y, vLocal.x) * 7.0 + uClock * 1.2), 10.0) * exp(-d * 2.2);
  float ring = exp(-pow((d - 0.55 - 0.08 * sin(uClock * 3.0)) * 9.0, 2.0)) * 0.5;
  float a = (glow * 0.45 + rays * 0.35 + ring) * uStrength;
  outColor = vec4(vec3(1.0, 0.94, 0.65) * a, 0.0);
}`;
