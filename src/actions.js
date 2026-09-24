import * as THREE from 'three';
import { DIM } from './character.js';
import { RIM, PLAYER_G, clamp, lerp, smooth, smoother, seg, distXZ } from './constants.js';

// ---------------------------------------------------------------------------
// Keyframe sampling (Catmull-Rom / Hermite through keys => smooth motion)
// All moves are authored for the RIGHT hand; Player mirrors them for lefties.
// ---------------------------------------------------------------------------
function prep(frames) {
  const keys = new Set();
  for (const f of frames) for (const k in f[1]) keys.add(k);
  for (const k of keys) {
    let last;
    for (const f of frames) {
      if (f[1][k] !== undefined) last = f[1][k];
      else if (last !== undefined) f[1][k] = last;
    }
    const first = frames.find((f) => f[1][k] !== undefined)[1][k];
    for (const f of frames) {
      if (f[1][k] === undefined) f[1][k] = first; else break;
    }
  }
  return { frames, keys: [...keys] };
}

function herm(v0, v1, m0, m1, u, h) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m1;
}

export function sample(P, t, anim, weight = 1) {
  const F = anim.frames;
  const n = F.length;
  let i = 0;
  if (t <= F[0][0]) i = -1;
  else if (t >= F[n - 1][0]) i = n - 1;
  else while (i < n - 2 && t >= F[i + 1][0]) i++;
  for (const k of anim.keys) {
    let val;
    if (i < 0 || i >= n - 1) {
      val = F[Math.max(0, Math.min(i, n - 1))][1][k];
      if (i < 0) val = F[0][1][k];
      assign(P, k, val, null, 0, weight);
      continue;
    }
    const t0 = F[i][0], t1 = F[i + 1][0], h = t1 - t0;
    const u = (t - t0) / h;
    const a = F[i][1][k], b = F[i + 1][1][k];
    const pm = i > 0 ? F[i - 1] : null, pp = i + 2 < n ? F[i + 2] : null;
    if (Array.isArray(a)) {
      const out = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const m0 = pm ? (b[c] - pm[1][k][c]) / (t1 - pm[0]) : 0;
        const m1 = pp ? (pp[1][k][c] - a[c]) / (pp[0] - t0) : 0;
        out[c] = herm(a[c], b[c], m0, m1, u, h);
      }
      assign(P, k, out, null, 0, weight);
    } else {
      const m0 = pm ? (b - pm[1][k]) / (t1 - pm[0]) : 0;
      const m1 = pp ? (pp[1][k] - a) / (pp[0] - t0) : 0;
      assign(P, k, herm(a, b, m0, m1, u, h), null, 0, weight);
    }
  }
}

function assign(P, k, val, _a, _b, w) {
  if (Array.isArray(val)) {
    if (w >= 1) P[k] = val.slice();
    else {
      const o = P[k];
      P[k] = [o[0] + (val[0] - o[0]) * w, o[1] + (val[1] - o[1]) * w, o[2] + (val[2] - o[2]) * w];
    }
  } else P[k] = w >= 1 ? val : P[k] + (val - P[k]) * w;
}

const PI = Math.PI;
const A = DIM.ankleH;

// Common arm shapes (right = strong hand)
const DRIB = { uArmR: [-0.15, 0.12, -0.3], fArmR: [-0.95, PI, 0], handR: [0.75, 0, 0], curlR: 0.12 };
const DRIB_L = { uArmL: [-0.15, -0.12, 0.3], fArmL: [-0.95, -PI, 0], handL: [0.75, 0, 0], curlL: 0.12 };
const GUARD_L = { uArmL: [-0.75, -0.1, 0.45], fArmL: [-0.95, -1.3, 0], handL: [0.15, 0, 0], curlL: 0.1 };
const GUARD_R = { uArmR: [-0.75, 0.1, -0.45], fArmR: [-0.95, 1.3, 0], handR: [0.15, 0, 0], curlR: 0.1 };
const CHEST = {
  uArmR: [-0.5, 0, 0.1], fArmR: [-1.5, 1.57, 0], handR: [0.1, 0, 0],
  uArmL: [-0.5, 0, -0.1], fArmL: [-1.5, -1.57, 0], handL: [0.1, 0, 0], curlR: 0.2, curlL: 0.2,
};
const RELAX = {
  uArmR: [0.0, 0, -0.14], fArmR: [-0.45, 1.35, 0], handR: [-0.1, 0, 0],
  uArmL: [0.0, 0, 0.14], fArmL: [-0.45, -1.35, 0], handL: [-0.1, 0, 0],
  spine: [0.08, 0, 0], chest: [0.04, 0, 0], head: [0, 0, 0], neck: [0, 0, 0], pelvisY: -0.06, curlR: 0.35, curlL: 0.35,
};

// ---------------------------------------------------------------------------
// Animation tracks
// ---------------------------------------------------------------------------
const CROSS = prep([
  [0, { ...DRIB, ...GUARD_L, spine: [0.3, 0, 0], chest: [0.05, -0.12, 0], pelvisY: -0.16, pelvisX: 0, head: [-0.1, 0.1, 0] }],
  [0.18, { uArmR: [-0.4, 0.35, 0.08], fArmR: [-0.5, 2.8, 0], handR: [-0.3, 0, 0], spine: [0.38, 0.14, -0.12], chest: [0.05, 0.12, 0], pelvisX: -0.07, pelvisY: -0.21 }],
  [0.5, { uArmR: [-0.45, 0, -0.35], fArmR: [-0.9, 1.4, 0], handR: [0, 0, 0], uArmL: [-0.2, -0.1, 0.35], fArmL: [-0.75, -3.0, 0], handL: [0.3, 0, 0], spine: [0.36, -0.22, 0.16], chest: [0.05, -0.16, 0], pelvisX: 0.11, pelvisY: -0.27, head: [-0.1, -0.1, 0] }],
  [0.8, { ...DRIB_L, ...GUARD_R }],
  [1.0, { spine: [0.3, -0.05, 0.04], chest: [0.05, 0.12, 0], pelvisX: 0.03, pelvisY: -0.16, head: [-0.1, -0.1, 0] }],
]);

const BEHIND = prep([
  [0, { ...DRIB, ...GUARD_L, spine: [0.28, 0, 0], chest: [0, 0, 0], pelvisY: -0.15, pelvisX: 0 }],
  [0.25, { uArmR: [0.2, 0, -0.4], fArmR: [-0.5, 1.6, 0], handR: [0.2, 0, 0], spine: [0.3, -0.25, 0.05], chest: [0, -0.2, 0] }],
  [0.45, { uArmR: [0.75, 0.25, -0.05], fArmR: [-0.7, 1.2, 0], handR: [-0.4, 0, 0], uArmL: [0.35, 0, 0.35], fArmL: [-0.5, -1.5, 0] }],
  [0.72, { uArmL: [-0.1, 0, 0.35], fArmL: [-0.8, -2.8, 0], handL: [0.4, 0, 0], uArmR: [-0.4, 0, -0.35], fArmR: [-0.8, 1.3, 0], spine: [0.3, 0.15, -0.05], chest: [0, 0.15, 0], pelvisX: 0.06 }],
  [1.0, { ...DRIB_L, ...GUARD_R, spine: [0.3, 0, 0], chest: [0, 0.1, 0], pelvisX: 0.02 }],
]);

const BETWEEN = prep([
  [0, { ...DRIB, ...GUARD_L, pelvisY: -0.15, spine: [0.3, 0, 0], ankL: [0.1, A, 0.05], ankR: [-0.1, A, -0.05] }],
  [0.28, { ankL: [0.14, A, 0.48], ankR: [-0.14, A, -0.3], pelvisY: -0.33, spine: [0.42, 0, 0], uArmR: [-0.1, 0.35, 0.12], fArmR: [-0.4, 2.8, 0], handR: [-0.1, 0, 0] }],
  [0.5, { uArmR: [-0.25, 0, -0.3], fArmR: [-0.8, 1.4, 0], uArmL: [-0.05, -0.2, 0.25], fArmL: [-0.6, -3.0, 0], handL: [0.4, 0, 0] }],
  [0.75, { ...DRIB_L, ...GUARD_R }],
  [1, { pelvisY: -0.16, spine: [0.3, 0, 0], ankL: [0.1, A, 0.12], ankR: [-0.1, A, -0.08] }],
]);

const SPIN = prep([
  [0, { ...DRIB, ...GUARD_L, spine: [0.3, 0, 0], pelvisY: -0.15 }],
  [0.15, { uArmR: [-0.55, 0, -0.95], fArmR: [-0.4, 1.57, 0], handR: [0, 0, 0], uArmL: [-0.4, 0, 0.9], fArmL: [-1.2, -1.5, 0], spine: [0.38, 0, -0.1], pelvisY: -0.24 }],
  [0.6, { uArmR: [-0.45, 0, -1.25], fArmR: [-0.2, 1.57, 0], uArmL: [-0.3, 0, 1.1] }],
  [0.85, { uArmR: [-0.3, 0.1, -0.4], fArmR: [-0.9, 3.0, 0], handR: [0.5, 0, 0], ...GUARD_L }],
  [1, { ...DRIB, spine: [0.3, 0, 0], pelvisY: -0.15 }],
]);

const STEPBACK = prep([
  [0, { spine: [0.3, 0, 0], pelvisY: -0.15 }],
  [0.3, { spine: [0.0, 0, 0], pelvisY: -0.05, head: [-0.2, 0, 0] }],
  [0.75, { spine: [0.15, 0, 0], pelvisY: -0.3 }],
  [1, { spine: [0.2, 0, 0], pelvisY: -0.18 }],
]);

const SHOT = prep([
  [0, { ...CHEST, pelvisY: -0.12, spine: [0.12, 0, 0], head: [-0.15, 0, 0] }],
  [0.17, { pelvisY: -0.32, spine: [0.22, 0, 0], uArmR: [-0.75, 0, 0.1], fArmR: [-1.65, 1.57, 0], uArmL: [-0.75, 0, -0.1], fArmL: [-1.65, -1.57, 0] }],
  [0.29, { pelvisY: -0.02, spine: [0.02, 0, 0], uArmR: [-1.9, 0.1, 0.1], fArmR: [-1.35, 2.4, 0], handR: [0.8, 0, 0], uArmL: [-1.85, -0.2, -0.3], fArmL: [-1.3, -1.5, 0], head: [-0.25, 0, 0] }],
  [0.4, { uArmR: [-2.3, 0.1, 0.12], fArmR: [-1.0, PI, 0], handR: [1.3, 0, 0], uArmL: [-2.1, -0.2, -0.36], fArmL: [-1.15, -1.5, 0], curlR: 0.25 }],
]);
const FOLLOW = prep([
  [0, { uArmR: [-2.3, 0.1, 0.12], fArmR: [-1.0, PI, 0], handR: [1.3, 0, 0], uArmL: [-2.1, -0.2, -0.36], fArmL: [-1.15, -1.5, 0], curlR: 0.25, spine: [0.02, 0, 0], head: [-0.25, 0, 0] }],
  [0.09, { uArmR: [-2.75, 0, 0.04], fArmR: [-0.08, PI, 0], handR: [-1.9, 0, 0], curlR: 0.75, uArmL: [-2.0, -0.1, -0.55], fArmL: [-0.4, -1.5, 0], curlL: 0.1 }],
  [0.55, { uArmR: [-2.7, 0, 0.04], handR: [-1.8, 0, 0] }],
  [0.95, { ...RELAX }],
]);

const LAYUP = prep([
  [0, { ...CHEST, pelvisY: -0.15, spine: [0.2, 0, 0] }],
  [0.2, { pelvisY: -0.3, spine: [0.3, 0, 0] }],
  [0.34, { uArmR: [-2.2, 0, -0.05], fArmR: [-0.9, 2.6, 0], handR: [0.8, 0, 0], uArmL: [-1.2, 0, 0.35], fArmL: [-0.9, -1.4, 0], handL: [0, 0, 0], spine: [0.05, 0.12, 0], head: [-0.3, 0, 0], pelvisY: 0 }],
  [0.47, { uArmR: [-2.75, 0, -0.05], fArmR: [-0.2, PI, 0], handR: [0.98, 0, 0], curlR: 0.2 }],
  [0.62, { handR: [-0.5, 0, 0], uArmL: [-0.8, 0, 0.55] }],
  [1.05, { ...RELAX }],
]);

const PASS = prep([
  [0, { ...CHEST, spine: [0.15, 0, 0] }],
  [0.3, { uArmR: [-0.85, 0, 0.15], fArmR: [-1.55, 1.57, 0], uArmL: [-0.85, 0, -0.15], fArmL: [-1.55, -1.57, 0], spine: [0.12, 0, 0] }],
  [0.5, { uArmR: [-1.4, 0, -0.12], fArmR: [-0.1, 2.5, 0], handR: [-0.5, 0, 0], uArmL: [-1.4, 0, 0.12], fArmL: [-0.1, -2.5, 0], handL: [-0.5, 0, 0], spine: [0.32, 0, 0], curlR: 0.05, curlL: 0.05 }],
  [0.75, { uArmR: [-1.3, 0, -0.15], uArmL: [-1.3, 0, 0.15] }],
  [1, { ...RELAX }],
]);

const LOB = prep([
  [0, { ...CHEST, spine: [0.15, 0, 0] }],
  [0.35, { uArmR: [-0.4, 0, 0.12], fArmR: [-1.8, 1.57, 0], uArmL: [-0.4, 0, -0.12], fArmL: [-1.8, -1.57, 0], pelvisY: -0.25, spine: [0.3, 0, 0] }],
  [0.55, { uArmR: [-2.5, 0, -0.1], fArmR: [-0.2, 1.8, 0], handR: [-0.6, 0, 0], uArmL: [-2.5, 0, 0.1], fArmL: [-0.2, -1.8, 0], handL: [-0.6, 0, 0], pelvisY: -0.05, spine: [-0.05, 0, 0], head: [-0.35, 0, 0] }],
  [1, { ...RELAX }],
]);

const CATCH = prep([
  [0, { uArmR: [-1.2, 0, 0.05], fArmR: [-0.4, 1.57, 0], uArmL: [-1.2, 0, -0.05], fArmL: [-0.4, -1.57, 0], curlR: 0.1, curlL: 0.1, spine: [0.15, 0, 0] }],
  [0.5, { ...CHEST, spine: [0.22, 0, 0], pelvisY: -0.16 }],
  [1, { ...CHEST, spine: [0.2, 0, 0], pelvisY: -0.12 }],
]);

const STEAL = prep([
  [0, { uArmR: [-0.7, 0, -0.6], fArmR: [-0.6, 1.6, 0], spine: [0.35, 0, 0], pelvisY: -0.22, ...GUARD_L }],
  [0.3, { uArmR: [-1.3, 0.2, 0.1], fArmR: [-0.12, 2.4, 0], handR: [-0.3, 0, 0], curlR: 0.05, spine: [0.52, 0.3, 0], chest: [0.1, 0.2, 0], pelvisY: -0.36, uArmL: [0.35, 0, 0.6], fArmL: [-0.4, -1.4, 0] }],
  [0.55, { uArmR: [-1.0, 0.3, 0.55], spine: [0.5, 0.4, 0] }],
  [1, { uArmR: [-0.4, 0, -0.4], fArmR: [-0.8, 1.4, 0], handR: [0, 0, 0], spine: [0.3, 0, 0], chest: [0, 0, 0], pelvisY: -0.2 }],
]);

const BLOCK = prep([
  [0, { pelvisY: -0.28, spine: [0.25, 0, 0], uArmR: [-1.2, 0, -0.3], fArmR: [-0.8, 1.57, 0], uArmL: [-1.0, 0, 0.3], fArmL: [-0.8, -1.57, 0] }],
  [0.12, { pelvisY: 0, spine: [-0.05, 0, 0], uArmR: [-2.95, 0, -0.18], fArmR: [-0.08, 1.57, 0], handR: [0.3, 0, 0], curlR: 0, uArmL: [-1.7, 0, 0.75], fArmL: [-0.4, -1.4, 0], curlL: 0.05, head: [-0.3, 0, 0] }],
  [0.55, { uArmR: [-2.85, 0, -0.2], uArmL: [-1.5, 0, 0.7] }],
  [0.95, { ...RELAX, pelvisY: -0.15 }],
]);

const REBOUND = prep([
  [0, { pelvisY: -0.3, spine: [0.3, 0, 0], uArmR: [-1.4, 0, -0.2], fArmR: [-0.9, 1.57, 0], uArmL: [-1.4, 0, 0.2], fArmL: [-0.9, -1.57, 0] }],
  [0.14, { pelvisY: 0, spine: [-0.05, 0, 0], uArmR: [-2.95, 0, -0.12], fArmR: [-0.12, 1.57, 0], uArmL: [-2.95, 0, 0.12], fArmL: [-0.12, -1.57, 0], curlR: 0.05, curlL: 0.05, head: [-0.35, 0, 0] }],
  [0.6, { uArmR: [-2.9, 0, -0.12], uArmL: [-2.9, 0, 0.12] }],
  [0.95, { ...RELAX, pelvisY: -0.12 }],
]);

const PICKUP = prep([
  [0, { spine: [0.3, 0, 0], pelvisY: -0.15 }],
  [0.45, { spine: [0.85, 0, 0], pelvisY: -0.42, uArmR: [-0.9, 0, 0.1], fArmR: [-0.3, 1.57, 0], uArmL: [-0.9, 0, -0.1], fArmL: [-0.3, -1.57, 0], head: [-0.4, 0, 0] }],
  [1, { ...CHEST, spine: [0.25, 0, 0], pelvisY: -0.15 }],
]);

const FALL = prep([
  [0, { pelvisX: 0, spine: [0.3, 0, 0], pelvisY: -0.15 }],
  [0.1, { pelvisX: -0.12, spine: [0.1, 0.2, 0.35], chest: [0, 0.2, 0.1], uArmR: [-1.0, 0, -1.4], fArmR: [-0.4, 1.4, 0], uArmL: [-0.4, 0, 1.6], fArmL: [-0.3, -1.4, 0], pelvisY: -0.3, head: [0.1, 0, 0.2], ankL: [0.2, A, 0.1], ankR: [-0.25, A, -0.05] }],
  [0.22, { pelvisY: -0.55, spine: [-0.15, 0.1, 0.1], ankL: [0.18, A, 0.4], ankR: [-0.2, A, 0.3] }],
  [0.32, { pelvisY: -0.8, pelvisX: 0, spine: [-0.35, 0, 0], chest: [-0.1, 0, 0], uArmR: [0.9, 0, -0.4], fArmR: [-0.1, 1.4, 0], uArmL: [0.9, 0, 0.4], fArmL: [-0.1, -1.4, 0], head: [0.25, 0, 0.15], ankL: [0.14, A, 0.72], ankR: [-0.16, A, 0.62] }],
  [0.78, { head: [0.3, 0.3, 0.2], spine: [-0.3, 0, 0] }],
  [0.9, { pelvisY: -0.45, spine: [0.5, 0, 0], ankL: [0.14, A, 0.25], ankR: [-0.16, A, 0.2], uArmR: [-0.5, 0, -0.3], uArmL: [-0.5, 0, 0.3] }],
  [1, { ...RELAX, pelvisY: -0.15, pelvisX: 0, ankL: [0.05, A, 0.02], ankR: [-0.05, A, -0.02] }],
]);

const STUMBLE = prep([
  [0, { pelvisX: 0, spine: [0.3, 0, 0], pelvisY: -0.2 }],
  [0.25, { pelvisX: -0.15, spine: [0.2, 0.25, 0.4], uArmR: [-0.8, 0, -1.3], uArmL: [-0.3, 0, 1.4], fArmR: [-0.3, 1.4, 0], fArmL: [-0.3, -1.4, 0], pelvisY: -0.32, head: [0, 0.2, 0.3] }],
  [0.6, { pelvisX: -0.05, spine: [0.35, 0.1, 0.15], pelvisY: -0.25 }],
  [1, { pelvisX: 0, spine: [0.3, 0, 0], pelvisY: -0.2, ...RELAX }],
]);

const CELEB_PUMP = prep([
  [0, { ...RELAX }],
  [0.15, { uArmR: [-2.6, 0, -0.4], fArmR: [-1.4, 1.4, 0], curlR: 1, spine: [-0.12, 0, 0], head: [-0.35, 0, 0], pelvisY: -0.05 }],
  [0.3, { uArmR: [-1.4, 0, -0.5], fArmR: [-1.9, 1.4, 0], pelvisY: -0.25, spine: [0.15, 0, 0] }],
  [0.45, { uArmR: [-2.7, 0, -0.4], fArmR: [-1.2, 1.4, 0], pelvisY: -0.05, spine: [-0.15, 0, 0] }],
  [0.6, { uArmR: [-1.4, 0, -0.5], fArmR: [-1.9, 1.4, 0], pelvisY: -0.25 }],
  [0.75, { uArmR: [-2.8, 0, -0.35], fArmR: [-0.3, 1.4, 0], curlR: 0.2 }],
  [1, { ...RELAX }],
]);
const CELEB_FLEX = prep([
  [0, { ...RELAX }],
  [0.18, { uArmR: [-0.2, -1.5, -1.45], fArmR: [-1.9, 0, 0], uArmL: [-0.2, 1.5, 1.45], fArmL: [-1.9, 0, 0], curlR: 1, curlL: 1, spine: [-0.18, 0, 0], chest: [-0.1, 0, 0], head: [-0.4, 0, 0], pelvisY: -0.22 }],
  [0.4, { uArmR: [-0.1, -1.5, -1.35], uArmL: [-0.1, 1.5, 1.35], pelvisY: -0.28, head: [-0.5, 0, 0] }],
  [0.8, { uArmR: [-0.2, -1.5, -1.45], uArmL: [-0.2, 1.5, 1.45] }],
  [1, { ...RELAX }],
]);
const CELEB_SKY = prep([
  [0, { ...RELAX }],
  [0.2, { uArmR: [-3.0, 0, -0.3], fArmR: [-0.05, 1.4, 0], curlR: 0.9, uArmL: [-2.9, 0, 0.35], fArmL: [-0.05, -1.4, 0], curlL: 0.9, spine: [-0.25, 0, 0], head: [-0.6, 0, 0] }],
  [0.8, { uArmR: [-2.9, 0, -0.45], uArmL: [-2.85, 0, 0.5] }],
  [1, { ...RELAX }],
]);
const SAD = prep([
  [0, { ...RELAX }],
  [0.25, { spine: [0.35, 0, 0], head: [0.45, 0, 0], uArmR: [-1.9, 0.6, -0.9], fArmR: [-2.2, 1.4, 0], uArmL: [-1.9, -0.6, 0.9], fArmL: [-2.2, -1.4, 0] }],
  [0.85, { head: [0.4, 0.2, 0] }],
  [1, { ...RELAX }],
]);

// ---------------------------------------------------------------------------
function leftVec(p, out) {
  return out.set(Math.cos(p.facing), 0, -Math.sin(p.facing));
}
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function faceRim(p) {
  p.targetFacing = Math.atan2(RIM.x - p.pos.x, RIM.z - p.pos.z);
}

function wrapArms(p) {
  for (const k of ['uArmL', 'uArmR', 'fArmL', 'fArmR', 'handL', 'handR']) {
    const v = p.cur[k];
    while (v[0] > PI) v[0] -= PI * 2;
    while (v[0] < -PI) v[0] += PI * 2;
  }
}

function dribbleEnd(p, a, g, intr, newHand) {
  if (!p.hasBall) return;
  if (newHand) p.ballHand = newHand;
  g.ball.resumeDribble(0.92);
}

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------
export const ACTIONS = {
  crossover: {
    dur: 0.42, moveMul: 0.8, rate: 24, accel: 6,
    start(p, a, g) {
      const toSide = a.side === 'R' ? 1 : -1;
      p.vel.addScaledVector(leftVec(p, _v), 2.8 * toSide * (a.special ? 1.4 : 1));
      g.audio.whoosh(0.5);
      p.lastDribbleMove = g.time;
    },
    update(p, a, g) {
      if (p.once(a, 'ank', 0.42)) g.checkAnkles(p, 'crossover', a);
      if (p.once(a, 'bounce', 0.46)) { g.audio.bounce(0.8); g.effects.dustPuff(g.ball.pos, 3, 0.4); }
    },
    ballSpec: (p, a) => ({ mode: 'transfer', from: 'R', to: 'L', u: a.t / a.dur, rel: 0.18, floor: 0.46, catch: 0.8, floorLocal: [0.02, 0.45] }),
    pose(p, a, P) { sample(P, a.t / a.dur, CROSS); },
    end(p, a, g, intr) { if (!intr) dribbleEnd(p, a, g, intr, a.side === 'R' ? 'L' : 'R'); },
  },

  behindBack: {
    dur: 0.52, moveMul: 0.85, rate: 22, accel: 6,
    start(p, a, g) {
      const toSide = a.side === 'R' ? 1 : -1;
      p.vel.addScaledVector(leftVec(p, _v), 1.8 * toSide * (a.special ? 1.4 : 1));
      g.audio.whoosh(0.4);
      p.lastDribbleMove = g.time;
    },
    update(p, a, g) {
      if (p.once(a, 'ank', 0.5)) g.checkAnkles(p, 'behindBack', a);
      if (p.once(a, 'bounce', 0.58)) g.audio.bounce(0.7);
    },
    ballSpec: (p, a) => ({ mode: 'transfer', from: 'R', to: 'L', u: a.t / a.dur, rel: 0.42, floor: 0.6, catch: 0.84, floorLocal: [0.12, -0.28] }),
    pose(p, a, P) { sample(P, a.t / a.dur, BEHIND); },
    end(p, a, g, intr) { if (!intr) dribbleEnd(p, a, g, intr, a.side === 'R' ? 'L' : 'R'); },
  },

  betweenLegs: {
    dur: 0.5, moveMul: 0.3, rate: 22, accel: 8,
    start(p, a, g) { g.audio.whoosh(0.35); p.lastDribbleMove = g.time; },
    update(p, a, g) {
      if (p.once(a, 'ank', 0.45)) g.checkAnkles(p, 'betweenLegs', a);
      if (p.once(a, 'bounce', 0.42)) g.audio.bounce(0.7);
    },
    ballSpec: (p, a) => ({ mode: 'transfer', from: 'R', to: 'L', u: a.t / a.dur, rel: 0.24, floor: 0.42, catch: 0.68, floorLocal: [0.0, 0.1] }),
    pose(p, a, P) { sample(P, a.t / a.dur, BETWEEN); },
    end(p, a, g, intr) { if (!intr) dribbleEnd(p, a, g, intr, a.side === 'R' ? 'L' : 'R'); },
  },

  spin: {
    dur: 0.62, moveMul: 0.95, rate: 22, accel: 5, turn: false,
    start(p, a, g) {
      a.f0 = p.facing;
      a.dir = a.side === 'R' ? -1 : 1;
      const mv = p.move.lengthSq() > 0.01 ? _v.copy(p.move).normalize() : p.forward(_v);
      p.vel.addScaledVector(mv, 2.0);
      g.audio.whoosh(0.8);
      p.lastDribbleMove = g.time;
    },
    update(p, a, g) {
      const u = a.t / a.dur;
      a.faceOverride = a.f0 + a.dir * PI * 2 * smoother(u);
      if (p.once(a, 'ank', 0.45)) g.checkAnkles(p, 'spin', a);
      if (u > 0.2 && u < 0.8 && Math.random() < 0.5) g.effects.dustPuff(p.pos, 1, 0.5);
    },
    ballSpec: (p, a) => ({ mode: 'hold', R: 1, L: 0 }),
    pose(p, a, P) { sample(P, a.t / a.dur, SPIN); },
    end(p, a, g, intr) {
      p.facing = a.f0;
      p.targetFacing = a.f0;
      if (!intr) dribbleEnd(p, a, g, intr);
    },
  },

  stepBack: {
    dur: 0.52, moveMul: 0, rate: 18, accel: 1.5,
    start(p, a, g) {
      p.forward(_v);
      p.vel.set(-_v.x * 4.6, 0, -_v.z * 4.6);
      p.jump(2.6);
      g.audio.squeak();
      p.lastDribbleMove = g.time;
      p.stepBackT = g.time;
    },
    update(p, a, g) {
      faceRim(p);
      if (p.once(a, 'ank', 0.4)) g.checkAnkles(p, 'stepBack', a);
    },
    pose(p, a, P) { sample(P, a.t / a.dur, STEPBACK); },
    land(p, a, g) { g.effects.dustPuff(p.pos, 5, 0.8); g.audio.squeak(); },
  },

  shoot: {
    dur: 1.25, moveMul: 0, rate: 20, turnRate: 14, accel: 14,
    start(p, a, g) {
      a.jumpT = a.special ? 0.3 : 0.19;
      a.vy = a.special ? 6.2 : 3.2 + 0.6 * p.attr.jump;
      a.airT = (2 * a.vy) / PLAYER_G;
      a.ideal = a.jumpT + (a.vy / PLAYER_G) * 0.88;
      a.released = false;
      a.userHold = !!a.userHold;
      faceRim(p);
      if (p.stepBackT && g.time - p.stepBackT < 0.8) a.fade = true;
      g.onShotStart(p, a);
    },
    update(p, a, g) {
      faceRim(p);
      if (!a.jumped && a.t >= a.jumpT) {
        a.jumped = true;
        p.jump(a.vy);
        if (a.fade) { p.forward(_v); p.vel.set(-_v.x * 1.4, 0, -_v.z * 1.4); }
      }
      if (!a.released) {
        const early = a.jumpT + 0.02;
        const late = a.jumpT + a.airT * 0.9;
        let go = false;
        if (a.userHold) {
          if (!a.holding && a.t >= early) go = true;
          if (a.t >= late) go = true;
        } else if (a.t >= (a.aiRelease ?? a.ideal)) go = true;
        if (go) {
          a.released = true;
          a.relT = a.t;
          const err = Math.abs(a.t - a.ideal);
          a.quality = a.special ? 1 : clamp(1 - err / 0.17, 0, 1);
          a.timing = err < 0.035 ? 'perfect' : a.t < a.ideal ? 'early' : 'late';
          g.releaseShot(p, a);
        }
      }
    },
    ballSpec(p, a) {
      if (a.released) return null;
      const w = smooth((a.t - 0.24) / 0.14);
      return { mode: 'hold', R: 0.5 + 0.5 * w, L: 0.5 - 0.5 * w };
    },
    pose(p, a, P) {
      if (!a.released) sample(P, Math.min(a.t, 0.4), SHOT);
      else sample(P, a.t - a.relT, FOLLOW);
      if (a.special && a.released) {
        P.uArmL = [-2.8, 0, 0.9];
        P.fArmL = [-0.2, -1.5, 0];
      }
      if (a.fade && p.airborne) P.spine[0] -= 0.25;
    },
  },

  layup: {
    dur: 1.05, moveMul: 0.4, rate: 18, turnRate: 12, accel: 3,
    start(p, a, g) {
      a.jumpT = 0.22;
      a.relT = 0.47;
      faceRim(p);
      g.onShotStart(p, a);
    },
    update(p, a, g) {
      faceRim(p);
      if (!a.jumped && a.t >= a.jumpT) {
        a.jumped = true;
        const vy = 4.3;
        const air = (2 * vy) / PLAYER_G;
        _v.set(p.pos.x - RIM.x, 0, p.pos.z - RIM.z);
        const d = _v.length();
        _v.normalize();
        const tx = RIM.x + _v.x * 0.72, tz = RIM.z + _v.z * 0.72;
        const vx = (tx - p.pos.x) / (air * 0.62), vz = (tz - p.pos.z) / (air * 0.62);
        const m = Math.hypot(vx, vz), cap = 5.5;
        p.vel.set(m > cap ? (vx / m) * cap : vx, 0, m > cap ? (vz / m) * cap : vz);
        void d;
        p.jump(vy);
      }
      if (!a.released && a.t >= a.relT) {
        a.released = true;
        g.releaseLayup(p, a);
      }
    },
    ballSpec(p, a) {
      if (a.released) return null;
      const w = smooth((a.t - 0.25) / 0.12);
      return { mode: 'hold', R: 0.5 + 0.5 * w, L: 0.5 - 0.5 * w };
    },
    pose(p, a, P) {
      sample(P, a.t, LAYUP);
      if (p.airborne) {
        const e = p.pos.y;
        P.ankR = [-0.04, e + A + 0.55, 0.28];
        P.ankL = [0.05, e + A + 0.08, -0.16];
        P.pitchR = 0.5; P.pitchL = 0.7;
      }
    },
  },

  dunk: {
    dur: 1.6, moveMul: 0, rate: 20, rootControl: true, legRate: 22,
    start(p, a, g) {
      a.type = a.type || 'oneHand';
      a.p0 = p.pos.clone();
      _v.set(p.pos.x - RIM.x, 0, p.pos.z - RIM.z);
      const dist = Math.max(0.1, _v.length());
      _v.normalize();
      if (a.oop) {
        // approach phase: run toward take-off spot first
        a.takeoff = new THREE.Vector3(RIM.x + _v.x * 2.2, 0, RIM.z + _v.z * 2.2);
      }
      a.dir = _v.clone();
      const hangOff = 0.6;
      a.hang = new THREE.Vector3(RIM.x + _v.x * hangOff, 0, RIM.z + _v.z * hangOff);
      a.elev = RIM.y + 0.32 - p.reach;
      const meteor = a.type === 'meteor';
      a.jumpT = a.oop ? a.jumpT : meteor ? 0.5 : 0.2;
      a.flight = a.oop ? a.flight : meteor ? 1.15 : clamp(0.34 + dist * 0.055, 0.38, 0.6);
      a.slamT = a.jumpT + a.flight;
      a.hangEnd = a.slamT + (meteor ? 0.55 : 0.38);
      a.dur = a.hangEnd + 0.55;
      a.arc = meteor ? 2.3 : a.type === 'reverse360' ? 0.45 : 0.18;
      a.facing0 = Math.atan2(-a.dir.x, -a.dir.z);
      a.spin = meteor || a.type === 'reverse360' ? (a.side === 'R' ? -1 : 1) : 0;
      a.slammed = false;
      if (!a.oop) g.onShotStart(p, a);
    },
    update(p, a, g) {
      const t = a.t;
      if (t < a.jumpT) {
        if (a.oop && a.takeoff) {
          // run to take-off
          _v.subVectors(a.takeoff, p.pos);
          _v.y = 0;
          const d = _v.length();
          const need = Math.max(0.05, a.jumpT - t);
          const sp = Math.min(9, d / need);
          if (d > 0.01) p.pos.addScaledVector(_v.normalize(), Math.min(d, sp * g.dt));
          p.vel.copy(_v).multiplyScalar(sp);
          p.targetFacing = Math.atan2(RIM.x - p.pos.x, RIM.z - p.pos.z);
          a.faceOverride = undefined;
          p.facing = p.facing + ((p.targetFacing - p.facing + PI * 3) % (PI * 2) - PI) * Math.min(1, g.dt * 12);
          a.p0.copy(p.pos);
          a.p0.y = 0;
        } else {
          p.vel.multiplyScalar(Math.exp(-8 * g.dt));
          p.pos.addScaledVector(p.vel, g.dt);
          a.p0.copy(p.pos);
          a.faceOverride = a.facing0;
        }
        return;
      }
      if (!a.launched) {
        a.launched = true;
        a.p0.copy(p.pos);
        a.p0.y = 0;
        g.onDunkLaunch(p, a);
      }
      if (t < a.slamT) {
        const s = (t - a.jumpT) / a.flight;
        const sh = 0.4 * s + 0.6 * smooth(s);
        const prevX = p.pos.x, prevZ = p.pos.z, prevY = p.pos.y;
        p.pos.x = lerp(a.p0.x, a.hang.x, sh);
        p.pos.z = lerp(a.p0.z, a.hang.z, sh);
        p.pos.y = a.elev * (1 - (1 - s) * (1 - s)) + a.arc * Math.sin(PI * s) * (1 - s * 0.3);
        p.vel.set((p.pos.x - prevX) / g.dt, 0, (p.pos.z - prevZ) / g.dt);
        p.vy = (p.pos.y - prevY) / g.dt;
        a.faceOverride = a.facing0 + a.spin * PI * 2 * smoother(seg(s, 0.1, 0.9));
        g.onDunkFlight(p, a, s);
        return;
      }
      a.faceOverride = a.facing0;
      if (!a.slammed) {
        a.slammed = true;
        g.slamDunk(p, a);
        wrapArms(p);
      }
      if (t < a.hangEnd) {
        const h = (t - a.slamT) / (a.hangEnd - a.slamT);
        p.pos.x = a.hang.x + a.dir.x * 0.05 * Math.sin(h * PI);
        p.pos.z = a.hang.z + a.dir.z * 0.05 * Math.sin(h * PI);
        p.pos.y = a.elev + 0.04 - 0.12 * h;
        p.vel.set(0, 0, 0);
        p.vy = 0;
        return;
      }
      // drop
      if (!a.dropped) { a.dropped = true; p.vy = 0.5; p.vel.set(a.dir.x * 1.0, 0, a.dir.z * 1.0); }
      if (p.pos.y > 0 || p.vy > 0) {
        p.vy -= PLAYER_G * g.dt;
        p.pos.y += p.vy * g.dt;
        p.pos.x += p.vel.x * g.dt;
        p.pos.z += p.vel.z * g.dt;
        if (p.pos.y <= 0) {
          p.pos.y = 0;
          const imp = -p.vy;
          p.vy = 0;
          p.onLand(imp);
        }
      } else {
        p.vel.multiplyScalar(Math.exp(-10 * g.dt));
      }
    },
    ballSpec(p, a) {
      if (a.slammed) return null;
      if (a.oop && !a.caught) return null;
      const both = a.type === 'twoHand' || a.type === 'reverse360';
      const t = a.t;
      if (t < a.jumpT + 0.08 && !a.oop) return { mode: 'hold', R: 0.5, L: 0.5 };
      if (both) return { mode: 'hold', R: 0.5, L: 0.5 };
      const w = a.oop ? 1 : smooth((t - a.jumpT) / 0.12);
      return { mode: 'hold', R: 0.5 + 0.5 * w, L: 0.5 - 0.5 * w };
    },
    pose(p, a, P) {
      const t = a.t;
      const type = a.type;
      if (t < a.jumpT) {
        if (a.oop) {
          // running approach, eyes up
          P.head[0] -= 0.3;
          return;
        }
        const u = t / a.jumpT;
        Object.assign(P, { ...CHEST });
        P.pelvisY = -0.18 - 0.2 * u - (type === 'meteor' ? 0.15 * u : 0);
        P.spine = [0.25 + 0.2 * u, 0, 0];
        P.head = [-0.3, 0, 0];
        return;
      }
      const e = p.pos.y;
      if (t < a.slamT) {
        const s = (t - a.jumpT) / a.flight;
        P.pelvisY = 0;
        P.spine = [-0.1 - 0.15 * s, 0, 0];
        P.head = [-0.35, 0, 0];
        // legs: knees up, split
        P.ankR = [-0.06, e + A + 0.3 + 0.2 * Math.sin(PI * s), 0.18];
        P.ankL = [0.06, e + A + 0.12, -0.22];
        P.pitchL = 0.8; P.pitchR = 0.6;
        const L_OFF = { uArmL: [-1.3, 0, 0.7], fArmL: [-0.6, -1.4, 0], handL: [0, 0, 0] };
        if (a.oop && !a.caught) {
          Object.assign(P, { uArmR: [-2.9, 0, -0.2], fArmR: [-0.3, 1.57, 0], uArmL: [-2.9, 0, 0.2], fArmL: [-0.3, -1.57, 0], curlR: 0.1, curlL: 0.1 });
        } else if (type === 'twoHand' || type === 'reverse360') {
          Object.assign(P, { uArmR: [-2.95, 0, 0.18], fArmR: [-1.05, 1.57, 0], handR: [0.2, 0, 0], uArmL: [-2.95, 0, -0.18], fArmL: [-1.05, -1.57, 0], handL: [0.2, 0, 0] });
        } else if (type === 'tomahawk') {
          Object.assign(P, { uArmR: [-3.1 - 0.45 * smooth(s), 0, -0.1], fArmR: [-1.35 - 0.3 * s, PI, 0], handR: [0.6, 0, 0], ...L_OFF });
          P.spine = [-0.3 * s, 0, 0];
        } else if (type === 'windmill' || type === 'meteor') {
          const ang = lerp(-0.6, 4.2, smoother(seg(s, 0.05, 0.95)));
          Object.assign(P, { uArmR: [ang, 0, -0.18], fArmR: [-0.2, PI, 0], handR: [0.4, 0, 0], ...L_OFF });
          if (type === 'meteor') { P.uArmL = [-2.2, 0, 1.2]; P.fArmL = [-0.3, -1.4, 0]; }
        } else {
          Object.assign(P, { uArmR: [-2.95, 0, -0.1], fArmR: [-1.25, PI, 0], handR: [0.6, 0, 0], ...L_OFF });
        }
        if (s > 0.86 && !(a.oop && !a.caught)) {
          // slam wind-down
          const k = seg(s, 0.86, 1);
          const windmill = type === 'windmill' || type === 'meteor';
          P.uArmR = [lerp(P.uArmR[0], windmill ? 4.1 : -2.25, k), 0, P.uArmR[2]];
          P.fArmR = [lerp(P.fArmR[0], -0.15, k), P.fArmR[1], 0];
          P.handR = [lerp(P.handR[0], -0.9, k), 0, 0];
          if (type === 'twoHand' || type === 'reverse360') {
            P.uArmL = [lerp(P.uArmL[0], -2.3, k), 0, P.uArmL[2]];
            P.fArmL = [lerp(P.fArmL[0], -0.15, k), P.fArmL[1], 0];
          }
        }
        return;
      }
      if (t < a.hangEnd) {
        // hanging on the rim
        const windmill = type === 'windmill' || type === 'meteor';
        const two = type === 'twoHand' || type === 'reverse360' || a.oop;
        P.uArmR = [windmill ? -2.95 + PI * 2 : -2.95, 0, -0.12];
        P.fArmR = [-0.1, 1.57, 0];
        P.handR = [0.4, 0, 0];
        P.curlR = 1;
        if (two) { P.uArmL = [-2.95, 0, 0.12]; P.fArmL = [-0.1, -1.57, 0]; P.handL = [0.4, 0, 0]; P.curlL = 1; }
        else { P.uArmL = [-0.6, 0, 0.6]; P.fArmL = [-0.9, -1.4, 0]; }
        const h = (t - a.slamT) / (a.hangEnd - a.slamT);
        P.pelvisY = 0;
        P.spine = [-0.15 + 0.1 * Math.sin(h * PI), 0, 0];
        P.head = [-0.1, 0, 0];
        P.ankR = [-0.07, e + A + 0.2 + 0.15 * Math.sin(h * PI), 0.25 * Math.sin(h * PI * 1.3)];
        P.ankL = [0.07, e + A + 0.15, -0.1 + 0.2 * Math.sin(h * PI)];
        P.pitchL = P.pitchR = 0.6;
        return;
      }
      // dropping / landing: relax arms, use locomotion legs
      const k = seg(t, a.hangEnd, a.hangEnd + 0.3);
      if (k < 1) {
        P.uArmR = [lerp(-2.4, 0, k), 0, -0.2];
        P.uArmL = [lerp(-1.5, 0, k), 0, 0.3];
      }
      P.head[0] -= 0.1;
    },
    end(p, a, g, intr) {
      wrapArms(p);
      p.vel.set(0, 0, 0);
      if (p.pos.y > 0) p.vy = Math.min(p.vy, 0);
    },
  },

  pass: {
    dur: 0.42, moveMul: 0.35, rate: 20, turnRate: 16, mirror: false,
    start(p, a, g) {
      a.relAt = a.lob ? 0.52 : 0.45;
      if (a.target) p.faceTowards(a.target.pos.x, a.target.pos.z);
    },
    update(p, a, g) {
      if (a.target && !a.released) p.faceTowards(a.target.pos.x, a.target.pos.z);
      if (!a.released && a.t / a.dur >= a.relAt) { a.released = true; g.releasePass(p, a); }
    },
    ballSpec: (p, a) => (a.released ? null : { mode: 'hold', R: 0.5, L: 0.5 }),
    pose(p, a, P) {
      sample(P, a.t / a.dur, a.lob ? LOB : PASS);
      if (a.bounce) { P.spine[0] += 0.18; P.uArmR[0] += 0.3; P.uArmL[0] += 0.3; }
      if (a.noLook) { P.head[1] += a.noLook; P.neck[1] += a.noLook * 0.5; }
    },
  },

  catch: {
    dur: 0.3, moveMul: 0.5, rate: 22, mirror: false,
    ballSpec: () => ({ mode: 'hold', R: 0.5, L: 0.5 }),
    pose(p, a, P) { sample(P, a.t / a.dur, CATCH); },
    end(p, a, g, intr) { if (!intr) dribbleEnd(p, a, g, intr); },
  },

  pickup: {
    dur: 0.36, moveMul: 0.3, rate: 22, mirror: false,
    ballSpec: (p, a) => ({ mode: 'hold', R: 0.5, L: 0.5 }),
    pose(p, a, P) { sample(P, a.t / a.dur, PICKUP); },
    end(p, a, g, intr) { if (!intr) dribbleEnd(p, a, g, intr); },
  },

  steal: {
    dur: 0.5, moveMul: 0.15, rate: 24, accel: 4,
    start(p, a, g) {
      if (a.target) {
        _v.subVectors(a.target.pos, p.pos);
        _v.y = 0;
        _v.normalize();
        p.vel.addScaledVector(_v, 2.4);
        p.faceTowards(a.target.pos.x, a.target.pos.z);
      }
      g.audio.whoosh(0.4);
    },
    update(p, a, g) {
      if (p.once(a, 'try', 0.34)) g.trySteal(p, a);
    },
    pose(p, a, P) { sample(P, a.t / a.dur, STEAL); },
  },

  block: {
    dur: 0.95, moveMul: 0, rate: 24, accel: 3,
    start(p, a, g) {
      a.jumpT = a.special ? 0.12 : 0.07;
      a.vy = a.special ? 8.2 : 4.3 + 1.3 * p.attr.block;
      if (a.target) {
        _v.subVectors(a.target, p.pos);
        _v.y = 0;
        const d = _v.length();
        _v.normalize();
        p.vel.copy(_v).multiplyScalar(Math.min(a.special ? 6 : 2.2, d * 1.4));
        p.faceTowards(a.target.x, a.target.z);
      }
      if (a.special) a.dur = 1.3;
    },
    update(p, a, g) {
      if (!a.jumped && a.t >= a.jumpT) { a.jumped = true; p.jump(a.vy); }
    },
    pose(p, a, P) {
      sample(P, a.t, BLOCK);
      if (a.special) { P.uArmL = [-3.0, 0, 0.2]; P.fArmL = [-0.1, -1.57, 0]; }
    },
  },

  rebound: {
    dur: 0.95, moveMul: 0, rate: 24, mirror: false,
    start(p, a, g) {
      a.jumpT = 0.08;
      a.vy = 4.0 + 1.2 * p.attr.jump;
      if (a.target) {
        _v.subVectors(a.target, p.pos);
        _v.y = 0;
        const d = _v.length();
        _v.normalize();
        p.vel.copy(_v).multiplyScalar(Math.min(3, d * 2));
      }
    },
    update(p, a, g) {
      if (!a.jumped && a.t >= a.jumpT) { a.jumped = true; p.jump(a.vy); }
    },
    ballSpec: (p, a) => (p.hasBall ? { mode: 'hold', R: 0.5, L: 0.5 } : null),
    pose(p, a, P) {
      sample(P, a.t, REBOUND);
      if (p.hasBall) {
        const k = smooth((a.t - (a.caughtT ?? a.t)) / 0.2);
        const c = CHEST;
        for (const key of ['uArmR', 'fArmR', 'uArmL', 'fArmL']) {
          P[key] = P[key].map((v, i) => lerp(v, c[key][i], k));
        }
      }
    },
    end(p, a, g, intr) { if (!intr) dribbleEnd(p, a, g, intr); },
  },

  ankleBroken: {
    dur: 2.1, moveMul: 0, rate: 16, legRate: 14, mirror: false,
    start(p, a, g) { p.stun = a.dur; p.vel.multiplyScalar(0.3); },
    pose(p, a, P) { sample(P, a.t / a.dur, FALL); },
  },

  stumble: {
    dur: 0.75, moveMul: 0.15, rate: 18, mirror: false,
    start(p, a, g) { p.stun = a.dur * 0.8; },
    pose(p, a, P) { sample(P, a.t / a.dur, STUMBLE); },
  },

  celebrate: {
    dur: 1.7, moveMul: 0.2, rate: 14, mirror: false,
    start(p, a) { a.anim = [CELEB_PUMP, CELEB_FLEX, CELEB_SKY][a.variant ?? ((Math.random() * 3) | 0)]; },
    pose(p, a, P) { sample(P, a.t / a.dur, a.anim); },
  },

  dejected: {
    dur: 1.6, moveMul: 0.3, rate: 10, mirror: false,
    pose(p, a, P) { sample(P, a.t / a.dur, SAD); },
  },

  // special defensive dash steal
  pickpocket: {
    dur: 0.42, moveMul: 0, rate: 26, rootControl: true,
    start(p, a, g) { a.p0 = p.pos.clone(); g.audio.whoosh(1.2); },
    update(p, a, g) {
      const tgt = a.target;
      if (tgt) {
        _v.subVectors(tgt.pos, p.pos);
        _v.y = 0;
        const d = _v.length();
        if (d > 0.7) p.pos.addScaledVector(_v.normalize(), Math.min(d - 0.7, 16 * g.dt));
        p.faceTowards(tgt.pos.x, tgt.pos.z);
        a.faceOverride = p.targetFacing;
      }
      if (Math.random() < 0.6) g.effects.ghost(p.rig, g.teamColors[p.team].glow, 0.25);
      if (p.once(a, 'take', 0.7)) g.pickpocket(p, a);
    },
    pose(p, a, P) { sample(P, 0.3 + (a.t / a.dur) * 0.4, STEAL); },
  },
};
