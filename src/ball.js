import * as THREE from 'three';
import { toonMat, addOutline } from './toon.js';
import { ballTexture } from './textures.js';
import { RIM, RIM_R, RIM_TUBE, BALL_R, BALL_G, BOARD, WORLD, POLE_Z, smooth, lerp } from './constants.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Ball {
  constructor(game) {
    this.game = game;
    const mat = toonMat(0xffffff, { map: ballTexture(), rim: 0.35, rimColor: 0xffc890, steps: 3 });
    this.mat = mat;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), mat);
    this.mesh.castShadow = true;
    addOutline(this.mesh, 0.01);
    game.scene.add(this.mesh);
    // glow shell for specials
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.45, 20, 14), this.glowMat);
    this.mesh.add(this.glow);
    this.glowColor = new THREE.Color();
    this.glowAmt = 0;

    this.pos = new THREE.Vector3(0, 1, 5);
    this.vel = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.holder = null;
    this.mode = 'dribble';
    this.dribblePhase = 0;
    this.dribbleRel = new THREE.Vector3();
    this.dribbleFloor = new THREE.Vector3();
    this.transferRel = new THREE.Vector3();
    this.transferFloor = new THREE.Vector3();
    this.transferKey = null;
    this.blend = 1;
    this.lastPos = new THREE.Vector3();
    this.shot = null; // {shooter, points, special, t, rimHit, ...}
    this.pass = null; // {from, to, t}
    this.freeT = 0;
    this.lastTouch = null;
    this.spinAxis = new THREE.Vector3(1, 0, 0);
    this.spinRate = 0;
    this.override = null;
    this.rimCooldown = 0;
  }

  get free() { return !this.holder; }

  give(p, mode = 'hold') {
    this.holder = p;
    this.mode = mode;
    this.shot = null;
    this.pass = null;
    this.blend = 0;
    this.lastTouch = p;
    this.override = null;
    this.transferKey = null;
  }

  resumeDribble(phase = 0.92) {
    this.mode = 'dribble';
    this.dribblePhase = phase;
    this.blend = Math.min(this.blend, 0.3);
  }

  release(vel) {
    this.holder = null;
    this.vel.copy(vel);
    this.freeT = 0;
    this.rimCooldown = 0;
  }

  setGlow(color, amt) {
    this.glowColor.set(color);
    this.glowAmt = amt;
  }

  update(dt) {
    this.prev.copy(this.pos);
    if (this.holder) this.updateHeld(dt);
    else this.updateFree(dt);
    this.mesh.position.copy(this.pos);
    // spin visuals
    if (this.holder && this.mode === 'dribble') {
      this.spinAxis.set(1, 0, 0).applyAxisAngle(_a.set(0, 1, 0), this.holder.facing);
      this.spinRate = 10;
    }
    if (this.spinRate) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.spinAxis, this.spinRate * dt);
      this.mesh.quaternion.premultiply(q);
    }
    const g = this.glowAmt;
    this.glowMat.opacity = Math.min(0.8, g * 0.6);
    this.glowMat.color.copy(this.glowColor).multiplyScalar(1.5 + g);
    this.glow.visible = g > 0.01;
    this.glow.scale.setScalar(1 + 0.15 * Math.sin(this.game.time * 30));
  }

  anchor(p, weights, out) {
    const wr = weights.R ?? 0, wl = weights.L ?? 0;
    out.set(0, 0, 0);
    if (wr > 0) out.addScaledVector(p.rig.palmAnchor('R', _b), wr);
    if (wl > 0) out.addScaledVector(p.rig.palmAnchor('L', _b), wl);
    const s = wr + wl;
    if (s > 0) out.multiplyScalar(1 / s);
    return out;
  }

  updateHeld(dt) {
    const p = this.holder;
    const a = p.action;
    let spec = a && a.def.ballSpec ? a.def.ballSpec(p, a) : null;
    if (spec && a.side === 'L' && a.def.mirror !== false) {
      if (spec.mode === 'hold') spec = { mode: 'hold', R: spec.L, L: spec.R };
      else if (spec.mode === 'transfer') spec = { ...spec, from: spec.from === 'R' ? 'L' : 'R', to: spec.to === 'R' ? 'L' : 'R', floorLocal: [-spec.floorLocal[0], spec.floorLocal[1]] };
    }
    const target = _c;
    if (this.override) {
      target.copy(this.override);
      this.spinRate *= Math.exp(-dt * 4);
    } else if (!spec) {
      // dribble
      this.mode = 'dribble';
      this.updateDribble(dt, p, target);
    } else if (spec.mode === 'hold') {
      this.mode = 'hold';
      this.anchor(p, spec, target);
      this.spinRate *= Math.exp(-dt * 8);
    } else if (spec.mode === 'transfer') {
      this.mode = 'transfer';
      this.updateTransfer(p, spec, target, a);
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.16);
      const k = smooth(this.blend);
      this.pos.lerpVectors(this.lastPos, target, 0.35 + 0.65 * k);
      if (this.blend >= 1) this.pos.copy(target);
    } else this.pos.copy(target);
    this.lastPos.copy(this.pos);
    this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-4));
  }

  updateDribble(dt, p, out) {
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const freq = 1.75 + sp * 0.11;
    const before = this.dribblePhase;
    this.dribblePhase = (this.dribblePhase + dt * freq) % 1;
    const ph = this.dribblePhase;
    const hand = p.rig.palmAnchor(p.ballHand, _a);
    const crossed = (x) => (before < x && ph >= x) || (before > ph && (x > before || x <= ph));
    if (crossed(0.15)) {
      this.dribbleRel.copy(hand);
      const tFloor = 0.35 / freq;
      p.forward(_b);
      this.dribbleFloor.set(hand.x + p.vel.x * tFloor * 1.05 + _b.x * 0.06, BALL_R, hand.z + p.vel.z * tFloor * 1.05 + _b.z * 0.06);
    }
    if (crossed(0.5)) {
      this.game.audio.bounce(0.55);
      if (sp > 4) this.game.effects.dustPuff(this.dribbleFloor, 1, 0.3);
    }
    if (ph >= 0.85 || ph < 0.15) {
      out.copy(hand);
    } else if (ph < 0.5) {
      const s = (ph - 0.15) / 0.35;
      out.x = lerp(this.dribbleRel.x, this.dribbleFloor.x, s);
      out.z = lerp(this.dribbleRel.z, this.dribbleFloor.z, s);
      out.y = this.dribbleRel.y + (BALL_R - this.dribbleRel.y) * (0.55 * s + 0.45 * s * s);
    } else {
      const s = (ph - 0.5) / 0.35;
      const u = 1 - s;
      out.x = lerp(this.dribbleFloor.x, hand.x, s);
      out.z = lerp(this.dribbleFloor.z, hand.z, s);
      out.y = hand.y + (BALL_R - hand.y) * (0.55 * u + 0.45 * u * u);
    }
  }

  updateTransfer(p, spec, out, a) {
    const u = spec.u;
    const key = a;
    if (this.transferKey !== key) {
      this.transferKey = key;
      this.transferReleased = false;
    }
    if (u < spec.rel) {
      this.anchor(p, { [spec.from]: 1 }, out);
      return;
    }
    if (!this.transferReleased) {
      this.transferReleased = true;
      this.transferRel.copy(this.pos);
      // floor point in player local frame -> world, anticipate motion
      const f = p.facing;
      const lx = spec.floorLocal[0], lz = spec.floorLocal[1];
      const tLeft = (spec.floor - spec.rel) * a.dur;
      this.transferFloor.set(
        p.pos.x + Math.cos(f) * lx + Math.sin(f) * lz + p.vel.x * tLeft,
        BALL_R,
        p.pos.z - Math.sin(f) * lx + Math.cos(f) * lz + p.vel.z * tLeft,
      );
    }
    if (u < spec.floor) {
      const s = (u - spec.rel) / (spec.floor - spec.rel);
      out.x = lerp(this.transferRel.x, this.transferFloor.x, s);
      out.z = lerp(this.transferRel.z, this.transferFloor.z, s);
      out.y = this.transferRel.y + (BALL_R - this.transferRel.y) * (0.5 * s + 0.5 * s * s);
      if (!this.transferBounced) this.transferBounced = false;
      return;
    }
    const hand = this.anchor(p, { [spec.to]: 1 }, _a);
    if (u < spec.catch) {
      const s = (u - spec.floor) / (spec.catch - spec.floor);
      const w = 1 - s;
      out.x = lerp(this.transferFloor.x, hand.x, s);
      out.z = lerp(this.transferFloor.z, hand.z, s);
      out.y = hand.y + (BALL_R - hand.y) * (0.5 * w + 0.5 * w * w);
      return;
    }
    out.copy(hand);
  }

  updateFree(dt) {
    this.freeT += dt;
    this.rimCooldown = Math.max(0, this.rimCooldown - dt);
    const g = this.game;
    const steps = 4;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const py = this.pos.y;
      this.vel.y -= BALL_G * h;
      this.pos.addScaledVector(this.vel, h);
      this.collide(h, py);
    }
    // rolling friction
    if (this.pos.y <= BALL_R + 0.001 && Math.abs(this.vel.y) < 0.3) {
      this.vel.x *= Math.exp(-1.2 * dt);
      this.vel.z *= Math.exp(-1.2 * dt);
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.01) {
        this.spinAxis.set(this.vel.z, 0, -this.vel.x).normalize();
        this.spinRate = sp / BALL_R;
      }
    }
    // net interaction
    const dx = this.pos.x - RIM.x, dz = this.pos.z - RIM.z;
    const hd = Math.hypot(dx, dz);
    if (this.pos.y < RIM.y + 0.05 && this.pos.y > RIM.y - 0.5 && hd < RIM_R + 0.05) {
      g.court.netPush(this.pos, BALL_R, this.vel);
      if (this.vel.y < 0 && hd < RIM_R) {
        this.vel.x *= Math.exp(-3 * dt);
        this.vel.z *= Math.exp(-3 * dt);
        this.vel.x -= dx * 6 * dt;
        this.vel.z -= dz * 6 * dt;
        this.vel.y *= Math.exp(-1.2 * dt);
      }
    }
  }

  collide(h, prevY) {
    const g = this.game;
    const p = this.pos, v = this.vel;
    // score detection: crossing the rim plane downward inside the ring
    if (prevY >= RIM.y && p.y < RIM.y && v.y < 0) {
      const d = Math.hypot(p.x - RIM.x, p.z - RIM.z);
      if (d < RIM_R - 0.02) g.onBallThroughHoop(this);
    }
    // rim torus
    _a.set(p.x - RIM.x, 0, p.z - RIM.z);
    let hl = _a.length();
    if (hl < 1e-5) { _a.set(1, 0, 0); hl = 1e-5; }
    _a.multiplyScalar(RIM_R / hl);
    _b.set(RIM.x + _a.x, RIM.y, RIM.z + _a.z);
    _n.subVectors(p, _b);
    const d = _n.length();
    const minD = BALL_R + RIM_TUBE;
    if (d < minD) {
      _n.divideScalar(d || 1);
      p.copy(_b).addScaledVector(_n, minD);
      const vn = v.dot(_n);
      if (vn < 0) {
        v.addScaledVector(_n, -(1 + 0.58) * vn);
        // tangential damping
        const vn2 = v.dot(_n);
        _c.copy(v).addScaledVector(_n, -vn2);
        v.copy(_n).multiplyScalar(vn2).addScaledVector(_c, 0.82);
        if (this.rimCooldown <= 0) {
          g.onRimHit(this, -vn);
          this.rimCooldown = 0.08;
        }
      }
    }
    // rim-to-board connector (small box behind the ring)
    // backboard
    if (p.x > -BOARD.halfW - BALL_R && p.x < BOARD.halfW + BALL_R && p.y > BOARD.bottom - BALL_R && p.y < BOARD.top + BALL_R) {
      const front = BOARD.front;
      if (p.z - BALL_R < front && p.z > front - BOARD.thick - BALL_R) {
        if (v.z < 0 && p.z > front - BOARD.thick * 0.5) {
          p.z = front + BALL_R;
          v.z = -v.z * 0.62;
          v.x *= 0.85; v.y *= 0.85;
          g.onBoardHit(this);
        } else if (v.z > 0 && p.z < front - BOARD.thick * 0.5) {
          p.z = front - BOARD.thick - BALL_R;
          v.z = -v.z * 0.5;
        }
      }
    }
    // pole
    const pdx = p.x, pdz = p.z - POLE_Z;
    const pd = Math.hypot(pdx, pdz);
    if (p.y < 3.5 && pd < 0.2 + BALL_R) {
      const nx = pdx / (pd || 1), nz = pdz / (pd || 1);
      p.x = nx * (0.2 + BALL_R);
      p.z = POLE_Z + nz * (0.2 + BALL_R);
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) { v.x -= 1.6 * vn * nx; v.z -= 1.6 * vn * nz; }
    }
    // floor
    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < 0) {
        const imp = -v.y;
        v.y = imp > 0.6 ? imp * 0.74 : 0;
        v.x *= 0.9; v.z *= 0.9;
        if (imp > 0.8) g.onFloorHit(this, imp);
      }
    }
    // fences / walls
    if (p.x < WORLD.minX + BALL_R) { p.x = WORLD.minX + BALL_R; v.x = Math.abs(v.x) * 0.4; }
    if (p.x > WORLD.maxX - BALL_R) { p.x = WORLD.maxX - BALL_R; v.x = -Math.abs(v.x) * 0.4; }
    if (p.z < WORLD.minZ + BALL_R) { p.z = WORLD.minZ + BALL_R; v.z = Math.abs(v.z) * 0.5; }
    if (p.z > WORLD.maxZ - BALL_R) { p.z = WORLD.maxZ - BALL_R; v.z = -Math.abs(v.z) * 0.4; }
  }

  /** Launch with a velocity so that it reaches `target` after time T. */
  launchTo(target, T) {
    const v = new THREE.Vector3(
      (target.x - this.pos.x) / T,
      (target.y - this.pos.y) / T + 0.5 * BALL_G * T,
      (target.z - this.pos.z) / T,
    );
    this.release(v);
    return v;
  }

  predict(t, out) {
    return out.set(this.pos.x + this.vel.x * t, this.pos.y + this.vel.y * t - 0.5 * BALL_G * t * t, this.pos.z + this.vel.z * t);
  }
}
