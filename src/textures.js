import * as THREE from 'three';
import { ARC_R, BASELINE_Z, CORNER_X, CORNER_Z, FT_Z, HALF_W, KEY_HALF_W, TOP_Z } from './constants.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Simple seeded rng so the environment looks the same each load
let seed = 1337;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function speckle(ctx, w, h, count, colors, maxR = 2, alpha = 0.25) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = rnd() * alpha;
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    const r = rnd() * maxR + 0.3;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx, w, h, n, color, width = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = rnd() * w, y = rnd() * h;
    let a = rnd() * Math.PI * 2;
    ctx.lineWidth = width * (0.5 + rnd());
    ctx.globalAlpha = 0.25 + rnd() * 0.35;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 6 + ((rnd() * 14) | 0);
    for (let s = 0; s < segs; s++) {
      a += (rnd() - 0.5) * 1.2;
      const l = 6 + rnd() * 22;
      x += Math.cos(a) * l; y += Math.sin(a) * l;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function asphaltTexture() {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#34323a';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 9000, ['#1f1e24', '#4a4852', '#2a2930', '#5c5a64'], 1.6, 0.6);
  speckle(ctx, 512, 512, 60, ['#242329', '#3f3d46'], 30, 0.18);
  cracks(ctx, 512, 512, 7, '#17161b', 1.6);
  return tex(c, { repeat: [16, 16] });
}

// Court painted area spans x in [-8, 8], z in [-2.2, 10]
export const COURT_TEX = { minX: -8, maxX: 8, minZ: -2.2, maxZ: 10 };

export function courtTexture() {
  const W = 2048, H = Math.round(2048 * (COURT_TEX.maxZ - COURT_TEX.minZ) / (COURT_TEX.maxX - COURT_TEX.minX));
  const [c, ctx] = canvas(W, H);
  const ppm = W / (COURT_TEX.maxX - COURT_TEX.minX);
  const X = (x) => (x - COURT_TEX.minX) * ppm;
  const Z = (z) => (z - COURT_TEX.minZ) * ppm;

  // margin
  ctx.fillStyle = '#1b2c4c';
  ctx.fillRect(0, 0, W, H);
  // playing surface
  ctx.fillStyle = '#23508e';
  ctx.fillRect(X(-HALF_W), Z(BASELINE_Z), (HALF_W * 2) * ppm, (TOP_Z - BASELINE_Z) * ppm);

  // two point area (inside arc) lighter
  ctx.fillStyle = '#2b62a8';
  ctx.beginPath();
  ctx.moveTo(X(-CORNER_X), Z(BASELINE_Z));
  ctx.lineTo(X(-CORNER_X), Z(CORNER_Z));
  const a0 = Math.atan2(CORNER_Z, -CORNER_X);
  const a1 = Math.atan2(CORNER_Z, CORNER_X);
  // arc drawn in canvas space: angle measured from +x toward +z (canvas y down = +z)
  ctx.arc(X(0), Z(0), ARC_R * ppm, a0, a1, true);
  ctx.lineTo(X(CORNER_X), Z(BASELINE_Z));
  ctx.closePath();
  ctx.fill();

  // key
  ctx.fillStyle = '#e4582a';
  ctx.fillRect(X(-KEY_HALF_W), Z(BASELINE_Z), KEY_HALF_W * 2 * ppm, (FT_Z - BASELINE_Z) * ppm);

  // center (top) circle fill
  ctx.fillStyle = '#e4582a';
  ctx.beginPath();
  ctx.arc(X(0), Z(TOP_Z), 1.8 * ppm, Math.PI, 0);
  ctx.fill();

  // lines
  const lw = 0.055 * ppm;
  ctx.strokeStyle = '#dcd8d0';
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeRect(X(-HALF_W), Z(BASELINE_Z), HALF_W * 2 * ppm, (TOP_Z - BASELINE_Z) * ppm);
  ctx.strokeRect(X(-KEY_HALF_W), Z(BASELINE_Z), KEY_HALF_W * 2 * ppm, (FT_Z - BASELINE_Z) * ppm);
  // 3pt line
  ctx.beginPath();
  ctx.moveTo(X(-CORNER_X), Z(BASELINE_Z));
  ctx.lineTo(X(-CORNER_X), Z(CORNER_Z));
  ctx.arc(X(0), Z(0), ARC_R * ppm, a0, a1, true);
  ctx.lineTo(X(CORNER_X), Z(BASELINE_Z));
  ctx.stroke();
  // FT circle
  ctx.beginPath();
  ctx.arc(X(0), Z(FT_Z), 1.8 * ppm, 0, Math.PI * 2);
  ctx.stroke();
  // restricted arc
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 1.25 * ppm, Math.PI, 0, true);
  ctx.stroke();
  // top circle
  ctx.beginPath();
  ctx.arc(X(0), Z(TOP_Z), 1.8 * ppm, Math.PI, 0);
  ctx.stroke();
  // hash marks on key
  for (const z of [1.2, 2.2, 3.1]) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(X(s * KEY_HALF_W), Z(z));
      ctx.lineTo(X(s * (KEY_HALF_W + 0.18)), Z(z));
      ctx.stroke();
    }
  }

  // court logo near top: stylised star + text
  ctx.save();
  ctx.translate(X(0), Z(TOP_Z - 0.2));
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#101018';
  ctx.lineWidth = 10;
  ctx.font = `900 italic ${Math.round(0.8 * ppm)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('3ON3', 0, -0.62 * ppm);
  ctx.fillText('3ON3', 0, -0.62 * ppm);
  ctx.restore();

  // Baseline graffiti text
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ff5ea8';
  ctx.font = `900 italic ${Math.round(0.45 * ppm)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('STREET KINGS', X(0), Z(BASELINE_Z - 0.18));
  ctx.restore();

  // wear & scuffs
  speckle(ctx, W, H, 26000, ['#0d1526', '#35659f', '#6f8fb8', '#132038'], 2.2, 0.28);
  speckle(ctx, W, H, 180, ['#0f1a30', '#3a6aa8'], 60, 0.06);
  // sneaker scuffs
  ctx.lineCap = 'round';
  for (let i = 0; i < 600; i++) {
    ctx.globalAlpha = 0.05 + rnd() * 0.12;
    ctx.strokeStyle = rnd() < 0.8 ? '#0a0f1c' : '#a7b8d4';
    ctx.lineWidth = 1 + rnd() * 3;
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI * 2, l = 10 + rnd() * 50;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.5, y + Math.sin(a + 0.4) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  cracks(ctx, W, H, 22, '#0b1120', 2.5);
  return tex(c, { aniso: 16 });
}

function brick(ctx, W, H) {
  ctx.fillStyle = '#5a2f2a';
  ctx.fillRect(0, 0, W, H);
  const bw = 34, bh = 12;
  for (let y = 0, row = 0; y < H; y += bh, row++) {
    for (let x = -((row % 2) * bw) / 2; x < W; x += bw) {
      const v = rnd();
      const r = 110 + v * 40, g = 52 + v * 20, b = 44 + v * 14;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  speckle(ctx, W, H, 5000, ['#2a1414', '#8a5a4a', '#1e0e0e'], 1.5, 0.35);
}

function bubbleText(ctx, text, x, y, size, fillA, fillB, outline = '#0d0a12', rot = -0.06) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `900 italic ${size}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // 3D drop
  ctx.fillStyle = '#120a18';
  for (let i = 10; i > 0; i--) ctx.fillText(text, i * 1.2, i * 1.4);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * 0.2;
  ctx.strokeText(text, 0, 0);
  ctx.strokeStyle = outline;
  ctx.lineWidth = size * 0.12;
  ctx.strokeText(text, 0, 0);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, fillA);
  g.addColorStop(1, fillB);
  ctx.fillStyle = g;
  ctx.fillText(text, 0, 0);
  // highlights
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#fff';
  ctx.font = `900 italic ${size}px "Arial Black", Impact, sans-serif`;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-2000, -size / 2, 4000, size * 0.22);
  ctx.clip();
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.restore();
  // drips
  ctx.fillStyle = fillB;
  for (let i = 0; i < 8; i++) {
    const dx = x + (rnd() - 0.5) * text.length * size * 0.55;
    const len = 10 + rnd() * 40;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(dx, y + size * 0.35, 3, len);
    ctx.beginPath();
    ctx.arc(dx + 1.5, y + size * 0.35 + len, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function sprayBlob(ctx, x, y, r, color, n = 400) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6) * r;
    ctx.globalAlpha = 0.15 + rnd() * 0.3;
    ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 2, 2);
  }
  ctx.globalAlpha = 1;
}

export function graffitiWallTexture() {
  const W = 2048, H = 512;
  const [c, ctx] = canvas(W, H);
  brick(ctx, W, H);
  // big painted backdrop blobs
  const blobs = [['#7b2cff', 260, 260, 210], ['#ff2f8f', 700, 250, 190], ['#17d3ff', 1250, 270, 230], ['#ffcc19', 1760, 250, 200]];
  for (const [col, x, y, r] of blobs) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.3, r * 0.75, rnd() - 0.5, 0, Math.PI * 2);
    ctx.fill();
    sprayBlob(ctx, x, y, r * 1.4, col, 1500);
  }
  ctx.globalAlpha = 1;
  bubbleText(ctx, 'STREET', 380, 250, 170, '#ffe14d', '#ff5a1f');
  bubbleText(ctx, '3ON3', 1000, 230, 210, '#6ef7ff', '#2a5bff', '#0d0a12', 0.05);
  bubbleText(ctx, 'HOOPS', 1620, 260, 170, '#ff8ad8', '#c21bff', '#0d0a12', -0.04);
  // tags
  ctx.font = 'italic 700 48px "Brush Script MT", cursive';
  const tags = ['KAI', 'MOE!', 'ICE', 'b-ball 4 life', 'DUNK CITY', 'NO MERCY'];
  for (let i = 0; i < 14; i++) {
    ctx.save();
    ctx.translate(rnd() * W, 60 + rnd() * (H - 120));
    ctx.rotate((rnd() - 0.5) * 0.4);
    ctx.fillStyle = ['#ffffff', '#111', '#44ff9a', '#ff4d4d'][(rnd() * 4) | 0];
    ctx.globalAlpha = 0.7;
    ctx.fillText(tags[(rnd() * tags.length) | 0], 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // stars + crowns
  for (let i = 0; i < 10; i++) {
    const x = rnd() * W, y = rnd() * H, r = 12 + rnd() * 24;
    ctx.fillStyle = ['#fff35c', '#ffffff', '#6ef7ff'][(rnd() * 3) | 0];
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = k % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  // grime at bottom
  const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,5,5,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return tex(c);
}

export function brickTexture() {
  const [c, ctx] = canvas(512, 256);
  brick(ctx, 512, 256);
  sprayBlob(ctx, 300, 120, 90, '#28c8ff', 900);
  return tex(c, { repeat: [1, 1] });
}

export function chainLinkTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#b9c1cc';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(128, 128);
  ctx.moveTo(128, 0); ctx.lineTo(0, 128);
  ctx.moveTo(64, -64); ctx.lineTo(192, 64);
  ctx.moveTo(-64, 64); ctx.lineTo(64, 192);
  ctx.moveTo(64, -64); ctx.lineTo(-64, 64);
  ctx.moveTo(192, 64); ctx.lineTo(64, 192);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f7';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const t = tex(c, { repeat: [1, 1] });
  return t;
}

export function windowsTexture(hue = 0) {
  const [c, ctx] = canvas(256, 512);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 512);
  const cols = ['#ffd27a', '#ffe9b0', '#8fe8ff', '#ff9ad5', '#fff4d6'];
  for (let y = 12; y < 500; y += 22) {
    for (let x = 12; x < 244; x += 20) {
      if (rnd() < 0.42) {
        ctx.fillStyle = cols[(rnd() * cols.length) | 0];
        ctx.globalAlpha = 0.5 + rnd() * 0.5;
        ctx.fillRect(x, y, 11, 13);
      }
    }
  }
  ctx.globalAlpha = 1;
  return tex(c);
}

export function numberTexture(num, fill = '#ffffff', stroke = '#111118') {
  const [c, ctx] = canvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '900 92px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = stroke;
  ctx.strokeText(String(num), 64, 68);
  ctx.fillStyle = fill;
  ctx.fillText(String(num), 64, 68);
  return tex(c);
}

export function crackDecalTexture() {
  const [c, ctx] = canvas(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  const g = ctx.createRadialGradient(256, 256, 10, 256, 256, 250);
  g.addColorStop(0, 'rgba(255,200,90,0.9)');
  g.addColorStop(0.2, 'rgba(255,90,20,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    let a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    let x = 256, y = 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      a += (rnd() - 0.5) * 0.7;
      const l = 14 + rnd() * 22;
      x += Math.cos(a) * l; y += Math.sin(a) * l;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(20,6,2,0.95)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,180,60,1)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  return tex(c);
}

export function ballTexture() {
  const W = 512, H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#e8661e';
  ctx.fillRect(0, 0, W, H);
  // pebble grain
  speckle(ctx, W, H, 9000, ['#b8480f', '#ff8a3c', '#c95414'], 1.2, 0.5);
  ctx.strokeStyle = '#1a0e08';
  ctx.lineWidth = 7;
  // equator + meridians (equirectangular mapping)
  ctx.beginPath();
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  for (const u of [0, 0.5, 1]) {
    ctx.moveTo(u * W, 0); ctx.lineTo(u * W, H);
  }
  ctx.stroke();
  // curved side seams
  for (const off of [0.25, 0.75]) {
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const v = i / 64;
        const lat = (v - 0.5) * Math.PI;
        const x = (off + sgn * 0.13 * Math.cos(lat)) * W;
        if (i === 0) ctx.moveTo(x, v * H); else ctx.lineTo(x, v * H);
      }
      ctx.stroke();
    }
  }
  return tex(c);
}

export function skyGradientColors() {
  return { top: new THREE.Color(0x0c0a2a), mid: new THREE.Color(0x4a1d63), horizon: new THREE.Color(0xff7a45) };
}
