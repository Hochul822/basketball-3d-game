import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMat, addOutline } from './toon.js';
import { numberTexture } from './textures.js';

// Body dimensions in "body units" (a 2.0m tall character). Long limbs on purpose.
export const DIM = {
  thigh: 0.5,
  shin: 0.48,
  ankleH: 0.09,
  hipH: 1.07,
  hipX: 0.1,
  uArm: 0.33,
  fArm: 0.31,
  reach: 2.46,
};

export const JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'clavR', 'uArmL', 'uArmR', 'fArmL', 'fArmR', 'handL', 'handR'];
export const SCALARS = ['pelvisY', 'pelvisX', 'pelvisZ', 'curlL', 'curlR', 'pitchL', 'pitchR'];
export const LEGS = ['ankL', 'ankR'];

export function restPose() {
  return {
    pelvis: [0, 0, 0], spine: [0.04, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    clavL: [0, 0, 0], clavR: [0, 0, 0],
    uArmL: [0.05, 0, 0.12], uArmR: [0.05, 0, -0.12],
    fArmL: [-0.3, -1.45, 0], fArmR: [-0.3, 1.45, 0],
    handL: [-0.1, 0, 0], handR: [-0.1, 0, 0],
    ankL: [0.03, DIM.ankleH, 0], ankR: [-0.03, DIM.ankleH, 0],
    pelvisY: 0, pelvisX: 0, pelvisZ: 0, curlL: 0.35, curlR: 0.35, pitchL: 0, pitchR: 0,
  };
}

export function clonePose(p) {
  const o = {};
  for (const k in p) o[k] = Array.isArray(p[k]) ? p[k].slice() : p[k];
  return o;
}

const SWAP = { clavL: 'clavR', clavR: 'clavL', uArmL: 'uArmR', uArmR: 'uArmL', fArmL: 'fArmR', fArmR: 'fArmL', handL: 'handR', handR: 'handL', ankL: 'ankR', ankR: 'ankL', curlL: 'curlR', curlR: 'curlL', pitchL: 'pitchR', pitchR: 'pitchL' };

/** Mirror a pose left<->right (used so moves can be authored for the right hand only). */
export function mirrorPose(p) {
  const o = {};
  for (const k in p) {
    const dst = SWAP[k] || k;
    const v = p[k];
    if (Array.isArray(v)) {
      if (k === 'ankL' || k === 'ankR') o[dst] = [-v[0], v[1], v[2]];
      else o[dst] = [v[0], -v[1], -v[2]];
    } else if (k === 'pelvisX') o[dst] = -v;
    else o[dst] = v;
  }
  return o;
}

// ---------- geometry helpers ----------
const V2 = THREE.Vector2;

/** Tapered capsule-like limb hanging down from the joint origin along -Y. */
function limbGeo(len, r0, r1, bulge = 0, bulgeAt = 0.5, seg = 16) {
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2);
    pts.push(new V2(Math.max(0.0001, Math.cos(a) * r1), -len + Math.sin(a) * r1 * 0.9));
  }
  const n = 12;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = -len + t * len;
    const b = bulge * Math.exp(-Math.pow((t - bulgeAt) / 0.28, 2));
    pts.push(new V2(r1 + (r0 - r1) * t + b, y));
  }
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push(new V2(Math.max(0.0001, Math.cos(a) * r0), Math.sin(a) * r0 * 0.9));
  }
  return new THREE.LatheGeometry(pts, seg);
}

function latheProfile(arr, seg = 20) {
  return new THREE.LatheGeometry(arr.map(([r, y]) => new V2(Math.max(0.0001, r), y)), seg);
}

function ellipsoid(rx, ry, rz, ws = 20, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

const geoCache = new Map();
function cached(key, fn) {
  if (!geoCache.has(key)) geoCache.set(key, fn());
  return geoCache.get(key);
}

const HAIR_STYLES = ['buzz', 'afro', 'headband', 'braids', 'mohawk', 'bald', 'cap'];

export class Rig {
  /**
   * o: { scale, skin, jersey, trim, shorts, shoes, hair, hairColor, number, beard, sleeve, bandColor }
   */
  constructor(o) {
    this.o = o;
    this.S = o.scale ?? 1;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(this.S);
    this.root.add(this.body);
    this.j = {};
    this.meshes = [];
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.build();
  }

  mat(color, extra = {}) {
    return toonMat(color, { rim: 0.3, ...extra });
  }

  add(parent, geo, mat, pos, { outline = 0.011, rot, cast = true, scale } = {}) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = cast;
    m.receiveShadow = true;
    if (outline) addOutline(m, outline);
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  joint(name, parent, x, y, z, order = 'XYZ') {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.order = order;
    parent.add(g);
    this.j[name] = g;
    return g;
  }

  build() {
    const o = this.o;
    const skin = this.mat(o.skin, { rimColor: 0xffd9b8 });
    const jersey = this.mat(o.jersey);
    const trim = this.mat(o.trim);
    const shorts = this.mat(o.shorts);
    const shoe = this.mat(o.shoes);
    const white = this.mat(0xf2f2f2);
    const hairM = this.mat(o.hairColor ?? 0x15110f, { rim: 0.18 });
    const band = this.mat(o.bandColor ?? o.jersey);
    const dark = new THREE.MeshBasicMaterial({ color: 0x0c0a10 });
    this.materials = { skin, jersey, trim, shorts, shoe, white, hairM, band };

    const J = this.j;
    const pelvis = this.joint('pelvis', this.body, 0, DIM.hipH, 0);
    // shorts / hips
    this.add(pelvis, cached('pelvisGeo', () => {
      const g = latheProfile([[0, -0.15], [0.12, -0.14], [0.165, -0.06], [0.17, 0.02], [0.155, 0.1], [0.0, 0.11]]);
      g.scale(1.12, 1, 0.78);
      return g;
    }), shorts, [0, 0, 0]);
    // waistband
    this.add(pelvis, cached('waistGeo', () => {
      const g = new THREE.CylinderGeometry(0.162, 0.168, 0.05, 20, 1, true);
      g.scale(1.12, 1, 0.78);
      return g;
    }), trim, [0, 0.07, 0], { outline: 0 });

    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const thigh = this.joint('thigh' + side, pelvis, s * DIM.hipX, -0.03, 0, 'ZXY');
      this.add(thigh, cached('thighGeo', () => limbGeo(DIM.thigh, 0.082, 0.058, 0.012, 0.6)), skin, [0, 0, 0]);
      // baggy shorts leg
      this.add(thigh, cached('shortLegGeo', () => limbGeo(0.36, 0.112, 0.118, 0.006, 0.4)), shorts, [0, 0.03, 0]);
      this.add(thigh, cached('shortTrimGeo', () => new THREE.CylinderGeometry(0.121, 0.121, 0.035, 18, 1, true)), trim, [0, -0.33, 0], { outline: 0 });
      const shin = this.joint('shin' + side, thigh, 0, -DIM.thigh, 0);
      this.add(shin, cached('shinGeo', () => limbGeo(DIM.shin, 0.058, 0.037, 0.016, 0.72)), skin, [0, 0, 0.005]);
      if (o.sleeve && side === 'L') {
        this.add(shin, cached('legSleeve', () => limbGeo(0.36, 0.064, 0.047, 0.014, 0.7)), trim, [0, -0.02, 0.005], { outline: 0.008 });
      }
      this.add(shin, cached('sockGeo', () => limbGeo(0.13, 0.043, 0.041)), white, [0, -DIM.shin + 0.1, 0], { outline: 0.008 });
      const foot = this.joint('foot' + side, shin, 0, -DIM.shin, 0);
      this.add(foot, cached('shoeGeo', () => new RoundedBoxGeometry(0.125, 0.1, 0.285, 3, 0.04)), shoe, [0, -0.035, 0.055]);
      this.add(foot, cached('soleGeo', () => new RoundedBoxGeometry(0.135, 0.038, 0.3, 2, 0.016)), white, [0, -0.075, 0.055], { outline: 0.008 });
      this.add(foot, cached('shoeStripe', () => new RoundedBoxGeometry(0.128, 0.03, 0.12, 2, 0.012)), white, [0, -0.02, 0.02], { outline: 0 });
    }

    const spine = this.joint('spine', pelvis, 0, 0.08, 0);
    this.add(spine, cached('abdGeo', () => {
      const g = latheProfile([[0, -0.06], [0.125, -0.05], [0.138, 0.04], [0.142, 0.14], [0.148, 0.24], [0.0, 0.27]]);
      g.scale(1.05, 1, 0.72);
      return g;
    }), jersey, [0, 0, 0]);
    const chest = this.joint('chest', spine, 0, 0.24, 0);
    this.add(chest, cached('chestGeo', () => {
      const g = latheProfile([[0, -0.07], [0.14, -0.06], [0.155, 0.02], [0.18, 0.11], [0.195, 0.19], [0.185, 0.245], [0.13, 0.29], [0.05, 0.31], [0, 0.312]]);
      g.scale(1.14, 1, 0.64);
      return g;
    }), jersey, [0, 0, 0]);
    // collar trim + side stripes
    this.add(chest, cached('collarGeo', () => {
      const g = new THREE.TorusGeometry(0.075, 0.014, 8, 20);
      g.rotateX(Math.PI / 2);
      g.scale(1.2, 1, 0.9);
      return g;
    }), trim, [0, 0.285, 0.012], { outline: 0 });
    // jersey numbers (front & back)
    const numTex = numberTexture(o.number ?? 0, o.numberFill ?? '#ffffff', o.numberStroke ?? '#15131c');
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const numGeo = cached('numGeo', () => new THREE.PlaneGeometry(0.2, 0.2));
    const back = new THREE.Mesh(numGeo, numMat);
    back.position.set(0, 0.13, -0.132);
    back.rotation.y = Math.PI;
    chest.add(back);
    const front = new THREE.Mesh(numGeo, numMat);
    front.position.set(0, 0.12, 0.13);
    front.scale.setScalar(0.62);
    front.rotation.x = -0.1;
    chest.add(front);

    const neck = this.joint('neck', chest, 0, 0.3, 0.0);
    this.add(neck, cached('neckGeo', () => new THREE.CylinderGeometry(0.05, 0.058, 0.15, 14)), skin, [0, 0.04, 0], { outline: 0.008 });
    const head = this.joint('head', neck, 0, 0.09, 0.01);
    this.buildHead(head, skin, hairM, band, dark);

    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const clav = this.joint('clav' + side, chest, s * 0.1, 0.235, -0.005);
      // trapezius / shoulder cap
      this.add(clav, cached('deltGeo', () => ellipsoid(0.068, 0.062, 0.07)), skin, [s * 0.1, -0.005, 0]);
      const u = this.joint('uArm' + side, clav, s * 0.115, 0, 0);
      this.add(u, cached('uArmGeo', () => limbGeo(DIM.uArm, 0.054, 0.043, 0.01, 0.35)), skin, [0, 0, 0]);
      const f = this.joint('fArm' + side, u, 0, -DIM.uArm, 0);
      this.add(f, cached('fArmGeo', () => limbGeo(DIM.fArm, 0.046, 0.032, 0.008, 0.25)), skin, [0, 0, 0]);
      if (o.wristband !== false) {
        this.add(f, cached('wristGeo', () => new THREE.CylinderGeometry(0.041, 0.041, 0.07, 14)), band, [0, -DIM.fArm + 0.06, 0], { outline: 0.007 });
      }
      if (o.armSleeve && side === 'R') {
        this.add(u, cached('armSleeve', () => limbGeo(0.29, 0.058, 0.047, 0.01, 0.35)), trim, [0, -0.03, 0], { outline: 0.008 });
        this.add(f, cached('farmSleeve', () => limbGeo(0.24, 0.05, 0.037, 0.008, 0.25)), trim, [0, 0, 0], { outline: 0.008 });
      }
      const hand = this.joint('hand' + side, f, 0, -DIM.fArm, 0);
      this.add(hand, cached('palmGeo', () => new RoundedBoxGeometry(0.085, 0.1, 0.036, 2, 0.015)), skin, [0, -0.05, 0.002], { outline: 0.007 });
      const fingers = new THREE.Group();
      fingers.position.set(0, -0.098, 0.004);
      hand.add(fingers);
      this.add(fingers, cached('fingerGeo', () => new RoundedBoxGeometry(0.082, 0.085, 0.028, 2, 0.012)), skin, [0, -0.04, 0], { outline: 0.007 });
      this.j['fingers' + side] = fingers;
      const thumb = new THREE.Group();
      thumb.position.set(s * 0.036, -0.03, 0.016);
      thumb.rotation.set(-0.45, 0, s * 0.55);
      hand.add(thumb);
      this.add(thumb, cached('thumbGeo', () => new THREE.CapsuleGeometry(0.014, 0.045, 4, 8).translate(0, -0.03, 0)), skin, [0, 0, 0], { outline: 0.006 });
      this.j['thumb' + side] = thumb;
    }
  }

  buildHead(head, skin, hairM, band, dark) {
    const o = this.o;
    this.add(head, cached('skullGeo', () => ellipsoid(0.106, 0.122, 0.112)), skin, [0, 0.11, 0]);
    this.add(head, cached('jawGeo', () => ellipsoid(0.082, 0.07, 0.09)), skin, [0, 0.05, 0.022]);
    // ears
    for (const s of [1, -1]) {
      this.add(head, cached('earGeo', () => ellipsoid(0.018, 0.03, 0.022, 10, 8)), skin, [s * 0.104, 0.1, 0.0], { outline: 0.005 });
    }
    // nose
    this.add(head, cached('noseGeo', () => ellipsoid(0.02, 0.025, 0.022, 10, 8)), skin, [0, 0.085, 0.108], { outline: 0.004 });
    // eyes (anime-ish oval) + white highlight
    const eyeGeo = cached('eyeGeo', () => ellipsoid(0.014, 0.022, 0.008, 10, 8));
    const hiGeo = cached('eyeHi', () => ellipsoid(0.005, 0.006, 0.004, 6, 4));
    const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const s of [1, -1]) {
      const e = new THREE.Mesh(eyeGeo, dark);
      e.position.set(s * 0.041, 0.118, 0.1);
      e.rotation.y = s * 0.3;
      head.add(e);
      const h = new THREE.Mesh(hiGeo, hiMat);
      h.position.set(s * 0.041 + 0.004, 0.126, 0.106);
      head.add(h);
      const brow = new THREE.Mesh(cached('browGeo', () => new RoundedBoxGeometry(0.042, 0.011, 0.012, 1, 0.004)), dark);
      brow.position.set(s * 0.043, 0.149, 0.1);
      brow.rotation.set(0, s * 0.3, -s * 0.22);
      head.add(brow);
    }
    const mouth = new THREE.Mesh(cached('mouthGeo', () => new RoundedBoxGeometry(0.038, 0.007, 0.01, 1, 0.003)), dark);
    mouth.position.set(0, 0.045, 0.106);
    head.add(mouth);

    const style = o.hair ?? 'buzz';
    if (style === 'buzz' || style === 'headband' || style === 'braids' || style === 'mohawk') {
      this.add(head, cached('buzzGeo', () => {
        const g = new THREE.SphereGeometry(1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
        g.scale(0.112, 0.13, 0.118);
        return g;
      }), hairM, [0, 0.118, -0.004], { rot: [-0.25, 0, 0] });
    }
    if (style === 'afro') {
      this.add(head, cached('afroGeo', () => ellipsoid(0.165, 0.14, 0.155, 18, 14)), hairM, [0, 0.19, -0.03]);
    }
    if (style === 'headband') {
      this.add(head, cached('headbandGeo', () => {
        const g = new THREE.TorusGeometry(0.112, 0.018, 8, 26);
        g.rotateX(Math.PI / 2);
        g.scale(1, 1, 1.06);
        return g;
      }), band, [0, 0.165, -0.004], { rot: [-0.18, 0, 0], outline: 0.006 });
    }
    if (style === 'braids') {
      for (let i = -2; i <= 2; i++) {
        this.add(head, cached('braidGeo', () => new THREE.CapsuleGeometry(0.014, 0.16, 4, 8)), hairM, [i * 0.035, 0.07, -0.1], { rot: [0.35, 0, i * 0.08], outline: 0.005 });
      }
    }
    if (style === 'mohawk') {
      this.add(head, cached('mohawkGeo', () => ellipsoid(0.03, 0.07, 0.13, 12, 10)), hairM, [0, 0.23, -0.01], { rot: [-0.2, 0, 0] });
    }
    if (style === 'cap') {
      this.add(head, cached('capGeo', () => {
        const g = new THREE.SphereGeometry(1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
        g.scale(0.118, 0.12, 0.124);
        return g;
      }), band, [0, 0.13, -0.005], { rot: [-0.12, 0, 0] });
      // backwards brim
      this.add(head, cached('brimGeo', () => new RoundedBoxGeometry(0.15, 0.014, 0.1, 2, 0.006)), band, [0, 0.14, -0.14], { rot: [-0.25, 0, 0], outline: 0.006 });
    }
    if (o.beard) {
      this.add(head, cached('beardGeo', () => {
        const g = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
        g.scale(0.09, 0.08, 0.095);
        return g;
      }), hairM, [0, 0.062, 0.02], { outline: 0.005 });
    }
  }

  /**
   * Apply a (world-unit) pose. elev = root elevation above the floor (for leg IK).
   */
  applyPose(p, elev) {
    const J = this.j;
    const S = this.S;
    J.pelvis.position.set(p.pelvisX / S, DIM.hipH + p.pelvisY / S, p.pelvisZ / S);
    for (let i = 0; i < JOINTS.length; i++) {
      const n = JOINTS[i];
      const r = p[n];
      J[n].rotation.set(r[0], r[1], r[2]);
    }
    J.fingersL.rotation.x = -p.curlL * 1.5;
    J.fingersR.rotation.x = -p.curlR * 1.5;
    J.thumbL.rotation.x = -0.45 - p.curlL * 0.6;
    J.thumbR.rotation.x = -0.45 - p.curlR * 0.6;
    this.solveLeg('L', p, elev);
    this.solveLeg('R', p, elev);
  }

  solveLeg(side, p, elev) {
    const S = this.S;
    const s = side === 'L' ? 1 : -1;
    const J = this.j;
    const ank = p['ank' + side];
    const pr = p.pelvis;
    this._e.set(pr[0], pr[1], pr[2], 'XYZ');
    this._q.setFromEuler(this._e);
    // hip joint position in body space
    const hip = this._v.set(s * DIM.hipX, -0.03, 0).applyQuaternion(this._q);
    hip.x += p.pelvisX / S;
    hip.y += DIM.hipH + p.pelvisY / S;
    hip.z += p.pelvisZ / S;
    // ankle target in body space (ank x/z are offsets from the REST hip location)
    const t = this._v2.set(s * DIM.hipX + ank[0] / S, (ank[1] - elev) / S, ank[2] / S);
    t.sub(hip);
    // into pelvis frame
    t.applyQuaternion(this._q.invert());
    const L1 = DIM.thigh, L2 = DIM.shin;
    const dx = t.x, dy = t.y, dz = t.z;
    const zAng = Math.atan2(dx, -dy);
    const v = Math.sqrt(dx * dx + dy * dy);
    let d = Math.sqrt(v * v + dz * dz);
    d = Math.min(Math.max(d, 0.25), L1 + L2 - 0.0008);
    const theta = Math.atan2(dz, v);
    const a = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const k = Math.PI - Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
    const thighX = -(theta + a);
    J['thigh' + side].rotation.set(thighX, s * 0.12, zAng);
    J['shin' + side].rotation.set(k, 0, 0);
    J['foot' + side].rotation.set(-pr[0] - thighX - k + p['pitch' + side], -s * 0.05, -zAng - pr[2]);
  }

  /** Where the ball sits when held against this hand's palm (world space). */
  palmAnchor(side, out) {
    return out.set(0, -0.078, 0.137).applyMatrix4(this.j['hand' + side].matrixWorld);
  }

  handPos(side, out) {
    return out.set(0, -0.08, 0).applyMatrix4(this.j['hand' + side].matrixWorld);
  }

  headPos(out) {
    return out.set(0, 0.12, 0).applyMatrix4(this.j.head.matrixWorld);
  }

  setVisible(v) { this.root.visible = v; }
}

export { HAIR_STYLES };
