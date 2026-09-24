import * as THREE from 'three';
import { Rig, DIM, restPose, mirrorPose, JOINTS, SCALARS, LEGS } from './character.js';
import { RIM, PLAY, PLAYER_G, clamp, lerp, smooth, dampAngle, distXZ, seg, window01 } from './constants.js';
import { ACTIONS } from './actions.js';

const _v = new THREE.Vector3();

export class Player {
  constructor(game, team, slot, def) {
    this.game = game;
    this.team = team;
    this.slot = slot;
    this.def = def;
    this.name = def.name;
    this.attr = def.attr;
    const tc = game.teamColors[team];
    this.rig = new Rig({
      ...def.look,
      jersey: tc.jersey,
      trim: tc.trim,
      shorts: tc.shorts,
      shoes: tc.shoes,
      bandColor: def.look.bandColor ?? tc.jersey,
      number: def.number,
      numberFill: team === 0 ? '#ffffff' : '#0d2b3a',
      scale: def.height / 2.0,
    });
    this.S = def.height / 2.0;
    game.scene.add(this.rig.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.facing = 0;
    this.targetFacing = 0;
    this.move = new THREE.Vector3();
    this.sprint = false;
    this.action = null;
    this.queue = [];
    this.ballHand = 'R';
    this.runPhase = Math.random();
    this.cur = restPose();
    this.stun = 0;
    this.landT = 0;
    this.isUser = false;
    this.defending = false;
    this.guardHigh = false;
    this.cutting = false;
    this.grabLock = 0;
    this.airTime = 0;
    this.lastDribbleMove = -10;
    this.ai = { think: 0, target: new THREE.Vector3(), spotT: 0, cutT: 0, reactT: 0, stealCd: 0, man: null, decision: null };
    this.stepAccum = 0;
    this.buildIndicator(tc);
  }

  buildIndicator(tc) {
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tc.glow).multiplyScalar(2.2), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.game.scene.add(this.ring);
    const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tc.glow).multiplyScalar(2.5), toneMapped: false });
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 4), arrowMat);
    this.arrow.rotation.x = Math.PI;
    this.arrow.visible = false;
    this.game.scene.add(this.arrow);
    // soft blob shadow for readability
  }

  get hasBall() { return this.game.ball.holder === this; }
  get grounded() { return this.pos.y <= 0.001 && this.vy <= 0; }
  get airborne() { return this.pos.y > 0.02; }
  get reach() { return DIM.reach * this.S; }
  forward(out = _v) { return out.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get busy() { return !!this.action; }
  isAction(...names) { return this.action && names.includes(this.action.name); }

  setPosition(x, z, facing) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    if (facing !== undefined) { this.facing = facing; this.targetFacing = facing; }
    this.action = null;
    this.queue.length = 0;
    this.stun = 0;
    this.cutting = false;
  }

  faceTowards(x, z) {
    this.targetFacing = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  startAction(name, opts = {}) {
    const def = ACTIONS[name];
    if (!def) throw new Error('unknown action ' + name);
    if (this.action) this.endAction(true);
    const a = { name, def, t: 0, dur: (opts.dur ?? def.dur) / (opts.speed ?? 1), speed: opts.speed ?? 1, ...opts, fired: {} };
    a.side = opts.side ?? this.ballHand;
    this.action = a;
    def.start?.(this, a, this.game);
    this.game.tutorial?.onAction(this, name, a);
    return a;
  }

  endAction(interrupted = false) {
    const a = this.action;
    if (!a) return;
    this.action = null;
    a.def.end?.(this, a, this.game, interrupted);
    if (!interrupted && this.queue.length) {
      const [n, o] = this.queue.shift();
      this.startAction(n, o);
    }
  }

  /** fire once when action time passes t (in action-normalized 0..1) */
  once(a, key, tn) {
    if (!a.fired[key] && a.t / a.dur >= tn) { a.fired[key] = true; return true; }
    return false;
  }

  update(dt) {
    const g = this.game;
    this.grabLock = Math.max(0, this.grabLock - dt);
    if (this.stun > 0) this.stun -= dt;
    // action
    const a = this.action;
    if (a) {
      a.t += dt;
      a.def.update?.(this, a, g);
      if (this.action === a && a.t >= a.dur) this.endAction();
    }
    const act = this.action;
    const rootCtl = act && act.def.rootControl;
    if (!rootCtl) {
      // horizontal movement
      let maxSpeed = 5.2 * this.attr.speed;
      if (this.sprint) maxSpeed *= 1.32;
      if (this.hasBall) maxSpeed *= 0.94;
      if (this.defending && !this.sprint) maxSpeed *= 0.92;
      let mm = act ? (act.moveMul ?? act.def.moveMul ?? 0) : 1;
      if (this.stun > 0) mm *= 0.2;
      const tvx = this.move.x * maxSpeed * mm, tvz = this.move.z * maxSpeed * mm;
      if (this.grounded) {
        const accel = act ? (act.def.accel ?? 10) : (this.sprint ? 7.5 : 11);
        const k = 1 - Math.exp(-accel * dt);
        this.vel.x += (tvx - this.vel.x) * k;
        this.vel.z += (tvz - this.vel.z) * k;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      // vertical
      if (this.pos.y > 0 || this.vy > 0) {
        this.vy -= PLAYER_G * dt;
        this.pos.y += this.vy * dt;
        this.airTime += dt;
        if (this.pos.y <= 0) {
          this.pos.y = 0;
          const impact = -this.vy;
          this.vy = 0;
          this.onLand(impact);
        }
      }
    }
    // facing
    if (act && act.faceOverride !== undefined) {
      this.facing = act.faceOverride;
    } else {
      if (!act || act.def.turn !== false) {
        const rate = act ? (act.def.turnRate ?? 8) : this.sprint ? 7 : 10;
        this.facing = dampAngle(this.facing, this.targetFacing, rate, dt);
      }
    }
    this.pos.x = clamp(this.pos.x, PLAY.minX, PLAY.maxX);
    this.pos.z = clamp(this.pos.z, PLAY.minZ, PLAY.maxZ);
    // avoid the pole
    const pdx = this.pos.x, pdz = this.pos.z + 2.45;
    const pd = Math.hypot(pdx, pdz);
    if (pd < 0.55) { this.pos.x = (pdx / (pd || 1)) * 0.55; this.pos.z = -2.45 + (pdz / (pd || 1)) * 0.55; }
    this.landT = Math.max(0, this.landT - dt);

    // footstep squeaks
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && sp > 2.5) {
      this.stepAccum += dt * sp;
      if (this.stepAccum > 3.2) {
        this.stepAccum = 0;
        if (Math.random() < 0.35) g.audio.squeak();
        if (sp > 5.5) g.effects.dustPuff(this.pos, 2, 0.5);
      }
    }
  }

  onLand(impact) {
    this.airTime = 0;
    this.landT = 0.22;
    if (impact > 3) this.game.effects.dustPuff(this.pos, 6, clamp(impact / 6, 0.5, 1.4));
    this.action?.def.land?.(this, this.action, this.game);
  }

  jump(vy) {
    this.vy = vy;
    this.pos.y = Math.max(this.pos.y, 0.001);
    this.airTime = 0;
  }

  // ------------------------------------------------------------------
  // Pose composition
  // ------------------------------------------------------------------
  locoPose(dt) {
    const P = restPose();
    const g = this.game;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const f = this.facing;
    const cf = Math.cos(f), sf = Math.sin(f);
    const lx = this.vel.x * cf - this.vel.z * sf; // local left (+x)
    const lz = this.vel.x * sf + this.vel.z * cf; // local forward (+z)
    const w = smooth((sp - 0.2) / 1.3);
    const run = smooth((sp - 2.8) / 3.2);
    const fwdness = sp > 0.1 ? Math.max(0, lz / sp) : 0;
    const dribbling = this.hasBall && g.ball.mode === 'dribble';
    const def = this.defending;
    const t = g.time;

    // posture
    let crouch = 0.06;
    if (dribbling) crouch = 0.13;
    if (def) crouch = 0.24;
    P.pelvisY = -crouch - 0.01 * Math.sin(t * 2.2 + this.slot);
    P.pelvis[0] = 0.08 + (def ? 0.18 : 0);
    P.spine[0] = 0.08 + run * 0.22 * fwdness + (def ? 0.32 : 0) + (dribbling ? 0.18 : 0) + 0.015 * Math.sin(t * 2.2 + this.slot);
    P.chest[0] = 0.04 + (def ? 0.06 : 0);
    P.neck[0] = -0.05 - P.spine[0] * 0.4;
    P.head[0] = -0.05 - P.spine[0] * 0.35;

    // stance
    const wide = def ? 0.2 : dribbling ? 0.1 : 0.05;
    const stagger = dribbling ? 0.1 : def ? 0.08 : 0.02;
    const baseL = [wide, DIM.ankleH, this.ballHand === 'R' ? stagger : -stagger];
    const baseR = [-wide, DIM.ankleH, this.ballHand === 'R' ? -stagger : stagger];

    // gait
    const freq = def && run < 0.5 ? lerp(1.5, 1.9, w) : lerp(1.15, 1.62, run);
    if (w > 0) this.runPhase = (this.runPhase + dt * freq * (0.35 + 0.65 * w)) % 1;
    const duty = def ? 0.55 : lerp(0.6, 0.37, run);
    const travel = (sp * duty) / freq;
    const half = Math.min(travel / 2, 0.72);
    const dx = sp > 0.05 ? lx / sp : 0, dz = sp > 0.05 ? lz / sp : 1;
    const lift = lerp(0.1, 0.3, run) * (def ? 0.5 : 1);
    const legs = [['L', 0, baseL], ['R', 0.5, baseR]];
    const alongs = {};
    for (const [side, off, base] of legs) {
      const psi = (this.runPhase + off) % 1;
      let along, h = 0, pitch = 0;
      if (psi < duty) {
        const s = psi / duty;
        along = half - 2 * half * s;
        pitch = -0.25 * run * seg(s, 0.7, 1);
      } else {
        const s = (psi - duty) / (1 - duty);
        along = -half + 2 * half * smooth(s);
        h = lift * Math.sin(Math.PI * s);
        pitch = 0.5 * run * Math.sin(Math.PI * s) - 0.2 * run * seg(s, 0.8, 1);
      }
      alongs[side] = along;
      const ank = P['ank' + side];
      ank[0] = base[0] * (1 - w * 0.5) + dx * along * w;
      ank[1] = DIM.ankleH + h * w;
      ank[2] = base[2] * (1 - w) + dz * along * w;
      P['pitch' + side] = pitch * w;
    }
    const bob = lerp(0.02, 0.07, run) * w;
    P.pelvisY -= bob * (0.5 + 0.5 * Math.cos(Math.PI * 4 * (this.runPhase - duty / 2)));
    P.pelvis[1] = 0.16 * w * Math.sin(Math.PI * 2 * this.runPhase) * (0.3 + fwdness);
    P.chest[1] = -0.22 * w * Math.sin(Math.PI * 2 * this.runPhase) * (0.3 + fwdness);
    P.pelvis[2] = 0.04 * w * Math.sin(Math.PI * 2 * this.runPhase);
    // lean into lateral motion
    P.spine[2] = -lx * 0.03;

    // arms
    const amp = lerp(0.35, 0.95, run) * w;
    const swing = Math.cos(Math.PI * 2 * this.runPhase);
    P.uArmR = [-0.05 - amp * swing * 0.9, 0, -0.12 - 0.05 * run];
    P.uArmL = [-0.05 + amp * swing * 0.9, 0, 0.12 + 0.05 * run];
    const elbow = -0.35 - 1.05 * run * w - 0.15 * w;
    P.fArmR = [elbow + 0.25 * amp * Math.max(0, -swing), 1.35, 0];
    P.fArmL = [elbow + 0.25 * amp * Math.max(0, swing), -1.35, 0];
    P.handR = [-0.15, 0, 0];
    P.handL = [-0.15, 0, 0];
    P.curlL = P.curlR = 0.3 + 0.3 * run;

    if (!this.hasBall && !def && w < 0.5) {
      // ready stance: hands up a bit, "ball!" when waiting
      const ready = this.team === g.offense && g.state === 'live' ? 1 : 0.3;
      P.uArmR = [-0.35 * ready, 0, -0.22];
      P.uArmL = [-0.35 * ready, 0, 0.22];
      P.fArmR = [-0.9 * ready - 0.3, 1.2, 0];
      P.fArmL = [-0.9 * ready - 0.3, -1.2, 0];
    }

    if (def) {
      const high = this.guardHigh;
      P.uArmR = [-0.35, 0.2, -1.05 + 0.1 * Math.sin(t * 5)];
      P.uArmL = [-0.35, -0.2, 1.05 - 0.1 * Math.sin(t * 5 + 1)];
      P.fArmR = [-0.75, 0.3, 0];
      P.fArmL = [-0.75, -0.3, 0];
      P.handR = [0.2, 0, 0];
      P.handL = [0.2, 0, 0];
      P.curlL = P.curlR = 0.08;
      if (high) {
        P.uArmR = [-2.65, 0.1, -0.35];
        P.fArmR = [-0.35, 1.3, 0];
      }
    }

    if (dribbling) this.dribblePose(P, run, w);

    // airborne default legs
    if (this.airborne) {
      const e = this.pos.y;
      P.ankL = [0.05, e + DIM.ankleH + 0.14, -0.1];
      P.ankR = [-0.05, e + DIM.ankleH + 0.24, 0.06];
      P.pitchL = 0.6; P.pitchR = 0.5;
    }
    if (this.landT > 0) P.pelvisY -= 0.2 * Math.sin(Math.PI * (1 - this.landT / 0.22));
    return P;
  }

  dribblePose(P, run, w) {
    const ph = this.game.ball.dribblePhase;
    let p;
    if (ph >= 0.85 || ph < 0.15) {
      const c = ph >= 0.85 ? (ph - 0.85) / 0.3 : (ph + 0.15) / 0.3;
      p = smooth(c);
    } else {
      p = 1 - smooth((ph - 0.15) / 0.7);
    }
    const S = this.ballHand;
    const M = S === 'R' ? 1 : -1; // mirror sign for y/z
    const u = [-0.12 - 0.35 * run, 0.12 * M, -0.3 * M];
    const fx = -0.95 + 0.45 * p - 0.25 * run;
    P['uArm' + S] = u;
    P['fArm' + S] = [fx, Math.PI * M, 0];
    P['hand' + S] = [0.75 - 0.5 * p, 0, 0];
    P['curl' + S] = 0.12;
    P['clav' + S] = [0, 0, 0];
    // guard (off) arm
    const O = S === 'R' ? 'L' : 'R';
    const threat = this.ai.threat ?? 0;
    if (threat > 0.3 || w < 0.4) {
      P['uArm' + O] = [-0.75 - 0.2 * threat, -0.1 * M, 0.45 * M];
      P['fArm' + O] = [-0.95, -1.3 * M, 0];
      P['hand' + O] = [0.15, 0, 0];
      P['curl' + O] = 0.1;
    }
    P.chest[1] += -0.12 * M;
    P.head[1] += 0.1 * M;
  }

  computePose(dt) {
    let P = this.locoPose(dt);
    const a = this.action;
    if (a && a.def.pose) {
      const mirrored = a.side === 'L' && a.def.mirror !== false;
      if (mirrored) {
        let m = mirrorPose(P);
        a.def.pose(this, a, m, this.game);
        P = mirrorPose(m);
      } else a.def.pose(this, a, P, this.game);
    }
    return P;
  }

  animate(dt) {
    const target = this.computePose(dt);
    const c = this.cur;
    const a = this.action;
    const rate = a?.rate ?? a?.def.rate ?? 16;
    const kArm = 1 - Math.exp(-rate * dt);
    const kLeg = 1 - Math.exp(-(a?.def.legRate ?? 30) * dt);
    const kCore = 1 - Math.exp(-Math.min(rate, 18) * dt);
    for (const n of JOINTS) {
      const k = n.startsWith('uArm') || n.startsWith('fArm') || n.startsWith('hand') || n.startsWith('clav') ? kArm : kCore;
      const cv = c[n], tv = target[n];
      cv[0] += (tv[0] - cv[0]) * k;
      cv[1] += (tv[1] - cv[1]) * k;
      cv[2] += (tv[2] - cv[2]) * k;
    }
    for (const n of LEGS) {
      const cv = c[n], tv = target[n];
      cv[0] += (tv[0] - cv[0]) * kLeg;
      cv[1] += (tv[1] - cv[1]) * kLeg;
      cv[2] += (tv[2] - cv[2]) * kLeg;
    }
    for (const n of SCALARS) {
      const k = n === 'pelvisY' || n.startsWith('pitch') ? kLeg : kArm;
      c[n] += (target[n] - c[n]) * k;
    }
    const root = this.rig.root;
    root.position.copy(this.pos);
    root.rotation.y = this.facing;
    this.rig.applyPose(c, this.pos.y);
    root.updateMatrixWorld(true);
  }

  updateIndicators(time) {
    const show = this.isUser;
    this.ring.visible = show;
    this.arrow.visible = show;
    if (show) {
      this.ring.position.set(this.pos.x, 0.02, this.pos.z);
      const s = 1 + 0.06 * Math.sin(time * 6);
      this.ring.scale.set(s, s, s);
      this.arrow.position.set(this.pos.x, this.pos.y + 2.25 * this.S + 0.25 + 0.06 * Math.sin(time * 5), this.pos.z);
      this.arrow.rotation.y = time * 2;
    }
  }

  chestPos(out) {
    return out.set(this.pos.x, this.pos.y + 1.3 * this.S, this.pos.z);
  }
}
