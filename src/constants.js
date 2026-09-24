import * as THREE from 'three';

// ---- Court geometry (meters). Rim center is the world origin in x/z. ----
export const RIM = new THREE.Vector3(0, 3.05, 0);
export const RIM_R = 0.23; // radius of the rim ring (center line)
export const RIM_TUBE = 0.018;
export const BALL_R = 0.121;
export const BOARD = { front: -0.375, halfW: 0.9, bottom: 2.9, top: 3.95, thick: 0.05 };
export const BASELINE_Z = -1.575;
export const TOP_Z = 9.425;
export const HALF_W = 7.5;
export const ARC_R = 6.75;
export const CORNER_X = 6.6;
export const CORNER_Z = BASELINE_Z + 2.99;
export const KEY_HALF_W = 2.45;
export const FT_Z = BASELINE_Z + 5.8;
export const POLE_Z = -2.45;

// Fence / play bounds for the ball
export const WORLD = { minX: -9.8, maxX: 9.8, minZ: -5.2, maxZ: 13.6 };
// Player movement bounds
export const PLAY = { minX: -8.2, maxX: 8.2, minZ: -1.9, maxZ: 11.5 };

export const BALL_G = 9.8;
export const PLAYER_G = 17.0;

export const TEAM_COLORS = [
  { name: 'BLAZE', jersey: 0xff6a1a, trim: 0x1b1b24, shorts: 0x1e1e2a, shoes: 0xff3d2e, accent: '#ff7a2a', glow: 0xff7a2a },
  { name: 'FROST', jersey: 0x21d4c8, trim: 0xf4f7ff, shorts: 0x10334a, shoes: 0x2ab8ff, accent: '#35e3ff', glow: 0x39e0ff },
];

export function distXZ(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function isThree(pos) {
  if (pos.z < CORNER_Z) return Math.abs(pos.x) > CORNER_X;
  return distXZ(pos, RIM) > ARC_R;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dampAngle(a, b, rate, dt) {
  return a + angleDiff(a, b) * (1 - Math.exp(-rate * dt));
}
// bump: 0 outside [a,b], smooth hill peaking in middle
export function window01(t, a, b) {
  if (t <= a || t >= b) return 0;
  return Math.sin(((t - a) / (b - a)) * Math.PI);
}
export function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }

export function pointSegDistXZ(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz || 1;
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
