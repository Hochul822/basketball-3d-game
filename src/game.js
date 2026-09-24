import * as THREE from 'three';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { updateAI, openness } from './ai.js';
import {
  RIM, RIM_R, BALL_R, ARC_R, TEAM_COLORS, BALL_G,
  distXZ, isThree, clamp, lerp, rand, pick, smooth, damp,
} from './constants.js';

const ROSTERS = [
  [
    { name: 'J.FLASH', number: 3, height: 1.93, pos: 'G', attr: { speed: 1.08, shoot: 0.78, three: 0.82, dunk: 0.62, handle: 0.95, defense: 0.6, steal: 0.8, block: 0.35, jump: 0.8, rebound: 0.4 }, look: { skin: 0x8d5524, hair: 'headband', hairColor: 0x120c08, bandColor: 0xffffff, armSleeve: true } },
    { name: 'BIG MO', number: 34, height: 2.1, pos: 'C', attr: { speed: 0.92, shoot: 0.5, three: 0.28, dunk: 0.96, handle: 0.45, defense: 0.8, steal: 0.35, block: 0.95, jump: 0.75, rebound: 0.95 }, look: { skin: 0x4a2c1d, hair: 'bald', beard: true, hairColor: 0x0d0907, sleeve: true } },
    { name: 'KAI', number: 23, height: 2.02, pos: 'F', attr: { speed: 1.02, shoot: 0.7, three: 0.66, dunk: 0.86, handle: 0.72, defense: 0.7, steal: 0.6, block: 0.6, jump: 0.95, rebound: 0.65 }, look: { skin: 0xe0ac69, hair: 'afro', hairColor: 0x2a1a10 } },
  ],
  [
    { name: 'ICE', number: 1, height: 1.9, pos: 'G', attr: { speed: 1.1, shoot: 0.8, three: 0.85, dunk: 0.5, handle: 0.92, defense: 0.62, steal: 0.82, block: 0.3, jump: 0.75, rebound: 0.4 }, look: { skin: 0xf1c27d, hair: 'cap', hairColor: 0x3b2a1a, bandColor: 0x10334a } },
    { name: 'TOWER', number: 50, height: 2.14, pos: 'C', attr: { speed: 0.9, shoot: 0.48, three: 0.25, dunk: 0.95, handle: 0.4, defense: 0.82, steal: 0.3, block: 0.97, jump: 0.72, rebound: 0.96 }, look: { skin: 0x5a3825, hair: 'mohawk', hairColor: 0x1a120c, sleeve: true } },
    { name: 'VEGA', number: 7, height: 2.0, pos: 'F', attr: { speed: 1.02, shoot: 0.72, three: 0.68, dunk: 0.85, handle: 0.74, defense: 0.7, steal: 0.6, block: 0.6, jump: 0.92, rebound: 0.62 }, look: { skin: 0xc68642, hair: 'braids', hairColor: 0x140d08, armSleeve: true } },
  ],
];

const DIFF = {
  easy: { react: 0.6, blockReact: 0.28, block: 0.3, steal: 0.22, rebound: 0.55, cpuShot: 0.82, special: 0.6, aiRelErr: 0.07, userBonus: 1.12 },
  normal: { react: 0.4, blockReact: 0.2, block: 0.45, steal: 0.42, rebound: 0.75, cpuShot: 1.0, special: 1, aiRelErr: 0.05, userBonus: 1.0 },
  hard: { react: 0.26, blockReact: 0.14, block: 0.6, steal: 0.65, rebound: 0.9, cpuShot: 1.1, special: 1.3, aiRelErr: 0.035, userBonus: 0.93 },
};
const TEAMMATE = { react: 0.38, blockReact: 0.2, block: 0.45, steal: 0.4, rebound: 0.75, cpuShot: 1.0, special: 1, aiRelErr: 0.045 };

const DUNKS_BY_SKILL = [
  [0.0, 'oneHand'], [0.0, 'twoHand'], [0.6, 'tomahawk'], [0.78, 'windmill'], [0.85, 'reverse360'],
];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();

export class Game {
  constructor({ scene, camera, court, effects, audio, ui, input }) {
    this.scene = scene;
    this.camera = camera;
    this.court = court;
    this.effects = effects;
    this.audio = audio;
    this.ui = ui;
    this.input = input;
    this.teamColors = TEAM_COLORS;
    this.time = 0;
    this.dt = 0.016;
    this.timeScale = 1;
    this.slowT = 0;
    this.slowScale = 1;
    this.difficulty = 'normal';
    this.teams = [0, 1].map((t) => ({ idx: t, score: 0, power: 0.35, name: TEAM_COLORS[t].name, players: [] }));
    this.players = [];
    for (let t = 0; t < 2; t++) {
      ROSTERS[t].forEach((def, i) => {
        const p = new Player(this, t, i, def);
        this.teams[t].players.push(p);
        this.players.push(p);
      });
    }
    this.ball = new Ball(this);
    this.ballTrail = effects.newTrail({ length: 30, width: 0.13, color: 0xffa040, color2: 0xff2a00, intensity: 3 });
    this.ballTrail.headFn = () => this.ball.pos;
    this.handTrails = [effects.newTrail({ length: 14, width: 0.05, color: 0xffffff, intensity: 1.6 }), effects.newTrail({ length: 14, width: 0.05, color: 0xffffff, intensity: 1.6 })];
    this.state = 'menu';
    this.stateT = 0;
    this.offense = 0;
    this.clearNeeded = false;
    this.shotClock = 12;
    this.gameClock = 240;
    this.target = 21;
    this.user = null;
    this.userTeam = 0;
    this.demo = false;
    this.cam = {
      pos: new THREE.Vector3(0, 7, 16),
      look: new THREE.Vector3(0, 1.5, 3),
      focus: new THREE.Vector3(0, 0, 5),
      cine: null,
      fov: 50,
    };
    this.lastGhost = 0;
    this.overtime = false;
    this.paused = false;
    this.layoutMenu();
  }

  diffFor(p) {
    if (p.team === this.userTeam && !this.demo) return TEAMMATE;
    return DIFF[this.difficulty];
  }

  // -------------------------------------------------------------------------
  // Setup / flow
  // -------------------------------------------------------------------------
  layoutMenu() {
    // idle scene for title screen: players shooting around
    const spots = [[-2, 4], [2.5, 3], [0, 6.5], [-4.5, 2], [4, 5.5], [1, 1.5]];
    this.players.forEach((p, i) => p.setPosition(spots[i][0], spots[i][1], Math.atan2(-spots[i][0], -spots[i][1])));
    this.ball.give(this.players[0], 'dribble');
  }

  start(difficulty = 'normal', demo = false) {
    this.difficulty = difficulty;
    this.demo = demo;
    for (const t of this.teams) { t.score = 0; t.power = 0.35; }
    this.gameClock = 240;
    this.overtime = false;
    this.state = 'intro';
    this.stateT = 0;
    this.setupCheck(0, true);
    this.state = 'intro';
    this.ui.bigText('STREET 3ON3', 'tip');
    this.ui.message('21점 선취 · 4분', 2);
    this.audio.whistle();
  }

  setupCheck(team) {
    this.offense = team;
    this.clearNeeded = false;
    this.shotClock = 12;
    const off = this.teams[team].players;
    const def = this.teams[1 - team].players;
    const handler = off.slice().sort((a, b) => b.attr.handle - a.attr.handle)[0];
    const others = off.filter((p) => p !== handler);
    const side = Math.random() < 0.5 ? 1 : -1;
    const spots = [[0, 8.4], [-5.0 * side, 4.6], [5.8 * side, 1.4]];
    const place = (p, x, z) => { p.setPosition(x, z, Math.atan2(RIM.x - x, RIM.z - z)); p.ai.checkSpot = new THREE.Vector3(x, 0, z); };
    place(handler, spots[0][0], spots[0][1]);
    others.forEach((p, i) => place(p, spots[i + 1][0], spots[i + 1][1]));
    const offOrder = [handler, ...others];
    // match defenders by slot type
    const defs = def.slice().sort((a, b) => b.attr.handle - a.attr.handle);
    defs.forEach((d, i) => {
      const man = offOrder[i];
      d.ai.man = man;
      _v.set(RIM.x - man.pos.x, 0, RIM.z - man.pos.z).normalize();
      const gap = i === 0 ? 1.15 : 1.6;
      const x = man.pos.x + _v.x * gap, z = man.pos.z + _v.z * gap;
      d.setPosition(x, z, Math.atan2(man.pos.x - x, man.pos.z - z));
      d.ai.checkSpot = new THREE.Vector3(x, 0, z);
    });
    for (const p of this.players) { p.ai.decision = null; p.ai.spot = null; p.ai.spotT = 0; p.ai.think = 0.6; p.cutting = false; p.defending = p.team !== team; }
    this.ball.give(handler, 'dribble');
    this.ball.pos.copy(handler.pos).setY(1);
    this.ball.lastPos.copy(this.ball.pos);
    this.ball.setGlow(0xffffff, 0);
    this.ballTrail.stop();
    this.setUser(team === this.userTeam ? handler : defs[0]);
    this.state = 'check';
    this.stateT = 0;
    this.ui.message(team === this.userTeam ? 'CHECK BALL · 공격' : 'CHECK BALL · 수비', 1.3);
    this.cam.cine = null;
  }

  setUser(p) {
    if (this.demo) { this.user = null; for (const q of this.players) q.isUser = false; return; }
    if (this.user) this.user.isUser = false;
    this.user = p;
    if (p) p.isUser = true;
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  update(rdt) {
    rdt = Math.min(rdt, 1 / 20);
    if (this.paused) return;
    // slow motion
    if (this.slowT > 0) {
      this.slowT -= rdt;
      this.timeScale = damp(this.timeScale, this.slowScale, 12, rdt);
    } else this.timeScale = damp(this.timeScale, 1, 5, rdt);
    const dt = rdt * this.timeScale;
    this.dt = dt;
    this.rdt = rdt;
    this.time += dt;
    this.realTime = (this.realTime || 0) + rdt;
    this.stateT += dt;

    const inMenu = this.state === 'menu';
    if (inMenu) this.menuUpdate(dt);
    else {
      this.flow(dt);
      if (this.user && !this.demo) this.userControl(dt);
      for (const p of this.players) if (!p.isUser || this.demo) updateAI(this, p, dt);
    }

    for (const p of this.players) p.update(dt);
    this.separate();
    for (const p of this.players) p.animate(dt);
    this.ball.update(dt);
    if (this.ball.shot) this.ball.shot.t += dt;
    if (!inMenu) {
      this.checkBlocks();
      this.checkGrabs();
    }
    this.specialFx(dt);
    for (const p of this.players) p.updateIndicators(this.time);
    this.court.update(dt, this.time);
    this.effects.update(dt, rdt);
    this.updateCamera(rdt);
    this.ui.update(this, rdt);
    this.input.endFrame();
  }

  menuUpdate(dt) {
    // title screen: CPU shoots around lazily
    const h = this.ball.holder;
    for (const p of this.players) {
      p.defending = false;
      p.move.set(0, 0, 0);
    }
    if (h && !h.busy && this.stateT > 2.2) {
      this.stateT = 0;
      if (Math.random() < 0.5 && distXZ(h.pos, RIM) < 7) this.startShotContext(h, false);
      else this.doMove(h, pick(['crossover', 'behindBack', 'spin', 'betweenLegs']));
    }
    if (h) h.faceTowards(RIM.x, RIM.z);
    if (!h && !this.ball.shot && this.ball.pos.y < 1.2) {
      // give to someone else after a shot
      const p = pick(this.players);
      this.ball.give(p, 'dribble');
      this.ball.lastPos.copy(this.ball.pos);
      this.stateT = 0;
    }
  }

  flow(dt) {
    const s = this.state;
    if (s === 'intro') {
      if (this.stateT > 2.2) { this.state = 'check'; this.stateT = 0; this.ui.message('CHECK BALL', 1.2); }
      return;
    }
    if (s === 'check') {
      if (this.stateT > 1.35) {
        this.state = 'live';
        this.stateT = 0;
        this.ui.bigText('GO!', 'go');
        this.audio.whistle();
      }
      return;
    }
    if (s === 'live') {
      this.gameClock -= dt;
      const h = this.ball.holder;
      if (h || (!this.ball.shot && !this.ball.holder)) this.shotClock -= dt;
      if (this.clearNeeded && h && h.team === this.offense && isThree(h.pos)) {
        this.clearNeeded = false;
        if (h.team === this.userTeam) this.ui.message('CLEARED ✓', 0.8);
      }
      if (this.shotClock <= 0 && h) {
        this.audio.buzzer();
        this.ui.bigText('SHOT CLOCK!', 'bad');
        this.turnover(1 - this.offense, 'shotclock');
        return;
      }
      if (this.gameClock <= 0) {
        this.gameClock = 0;
        if (this.teams[0].score !== this.teams[1].score && !this.ball.shot) { this.endGame(); return; }
        if (!this.overtime && this.teams[0].score === this.teams[1].score) {
          this.overtime = true;
          this.ui.bigText('SUDDEN DEATH', 'tip');
        }
      }
      return;
    }
    if (s === 'scored' || s === 'turnover') {
      if (this.stateT > (s === 'scored' ? 2.3 : 1.6) && !this.wipeStarted) {
        this.wipeStarted = true;
        this.ui.wipe(() => {
          this.wipeStarted = false;
          if (this.state === 'over') return;
          this.setupCheck(this.nextOffense);
        });
      }
      return;
    }
  }

  turnover(toTeam, reason) {
    this.state = 'turnover';
    this.stateT = 0;
    this.nextOffense = toTeam;
    this.cam.cine = null;
  }

  endGame() {
    this.state = 'over';
    this.stateT = 0;
    this.audio.buzzer();
    const win = this.teams[0].score > this.teams[1].score ? 0 : 1;
    for (const p of this.teams[win].players) if (!p.busy) p.startAction('celebrate');
    this.court.crowdExcite = 1.2;
    this.audio.cheer(1.5);
    this.ui.gameOver(this, win);
  }

  // -------------------------------------------------------------------------
  // User control
  // -------------------------------------------------------------------------
  userControl(dt) {
    const u = this.user;
    const inp = this.input;
    if (inp.pressed('switch')) this.switchUser();
    const ax = inp.axis();
    const live = this.state === 'live';
    const canMove = live || this.state === 'check';
    if (u.stun > 0 || !canMove) {
      u.move.set(0, 0, 0);
    } else {
      // camera relative (camera looks toward -z)
      u.move.set(ax.x, 0, -ax.y);
    }
    if (this.state === 'check' && u.hasBall) u.move.set(0, 0, 0);
    const bp = this.ball.pass;
    if (bp && bp.to === u && !this.ball.holder && !bp.lob && u.move.lengthSq() < 0.05) {
      // receive assist: step toward the incoming pass
      this.ball.predict(Math.min(0.35, distXZ(this.ball.pos, u.pos) / 12), _v);
      const dx = _v.x - u.pos.x, dz = _v.z - u.pos.z, dl = Math.hypot(dx, dz);
      if (dl > 0.3) u.move.set(dx / dl * 0.7, 0, dz / dl * 0.7);
      u.faceTowards(this.ball.pos.x, this.ball.pos.z);
    }
    u.sprint = inp.isDown('sprint');
    const moving = u.move.lengthSq() > 0.04;
    const hasBall = u.hasBall;
    const onDefense = this.ball.holder ? this.ball.holder.team !== u.team : this.offense !== u.team;
    u.defending = live && onDefense && !!this.ball.holder;
    u.guardHigh = false;
    // facing
    if (u.defending && this.ball.holder && distXZ(u.pos, this.ball.holder.pos) < 4.5 && !u.sprint) {
      u.faceTowards(this.ball.holder.pos.x, this.ball.holder.pos.z);
    } else if (moving) {
      u.targetFacing = Math.atan2(u.move.x, u.move.z);
    } else if (hasBall) {
      u.faceTowards(RIM.x, RIM.z);
    } else if (!this.ball.holder) {
      u.faceTowards(this.ball.pos.x, this.ball.pos.z);
    }
    if (hasBall) u.ai.threat = clamp(1.9 - this.nearestOppDist(u), 0, 1);

    // shot release
    if (inp.released('shoot') && u.action && u.action.name === 'shoot') u.action.holding = false;
    if (!live) return;

    // buffer presses so inputs made during an animation aren't lost
    const ACTS = ['special', 'shoot', 'pass', 'oop', 'cross', 'behind', 'legs', 'spin', 'stepback'];
    for (const a of ACTS) if (inp.pressed(a)) { this.userBuf = { a, t: this.realTime }; break; }
    const buf = this.userBuf;
    if (!buf || this.realTime - buf.t > 0.35) return;
    if (u.busy) {
      // allow chaining a shot out of a step-back
      if (hasBall && u.isAction('stepBack') && buf.a === 'shoot') { u.queue = [['shoot', { userHold: true, holding: inp.isDown('shoot'), side: 'R' }]]; this.userBuf = null; }
      return;
    }
    this.userBuf = null;
    const act = buf.a;
    if (hasBall) {
      if (act === 'special') { if (!this.trySpecialOffense(u)) this.ui.message('SPECIAL 게이지가 부족해요', 1); return; }
      if (act === 'shoot') {
        this.startShotContext(u, true);
        if (u.action && u.action.name === 'shoot') u.action.holding = inp.isDown('shoot');
        return;
      }
      if (act === 'pass') { this.userPass(u, ax); return; }
      if (act === 'oop') { this.userOop(u); return; }
      if (act === 'cross') { this.doMove(u, 'crossover'); return; }
      if (act === 'behind') { this.doMove(u, 'behindBack'); return; }
      if (act === 'legs') { this.doMove(u, 'betweenLegs'); return; }
      if (act === 'spin') { this.doMove(u, 'spin'); return; }
      if (act === 'stepback') { this.doMove(u, 'stepBack'); return; }
      return;
    }
    if (onDefense && this.ball.holder) {
      const h = this.ball.holder;
      if (act === 'special') { if (!this.trySpecialDefense(u)) this.ui.message('SPECIAL 게이지가 부족하거나 너무 멀어요', 1); return; }
      if (act === 'pass') { this.startSteal(u, h); return; }
      if (act === 'shoot' || act === 'oop') {
        u.startAction('block', { target: this.ball.pos.clone(), side: 'R' });
        return;
      }
    } else if (act === 'shoot' || act === 'oop') {
      // jump for rebound / loose ball
      u.startAction('rebound', { target: this.ball.pos.clone() });
    }
  }

  switchUser() {
    if (!this.user) return;
    const team = this.teams[this.user.team].players;
    const ref = this.ball.holder ? this.ball.holder.pos : this.ball.pos;
    let best = null, bd = 1e9;
    for (const p of team) {
      if (p === this.user || p.hasBall) continue;
      const d = distXZ(p.pos, ref);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { this.setUser(best); this.audio.ui(); }
  }

  nearestOppDist(p) {
    let bd = 99;
    for (const o of this.teams[1 - p.team].players) bd = Math.min(bd, distXZ(o.pos, p.pos));
    return bd;
  }

  nearestOpp(p, maxD = 99, frontOnly = false) {
    let best = null, bd = maxD;
    p.forward(_u);
    for (const o of this.teams[1 - p.team].players) {
      const d = distXZ(o.pos, p.pos);
      if (d >= bd) continue;
      if (frontOnly) {
        _w.set(o.pos.x - p.pos.x, 0, o.pos.z - p.pos.z).normalize();
        if (_w.dot(_u) < 0.15) continue;
      }
      bd = d;
      best = o;
    }
    return best;
  }

  userPass(u, ax) {
    const mates = this.teams[u.team].players.filter((p) => p !== u);
    let best = null, bs = -1e9;
    const dir = new THREE.Vector3(ax.x, 0, -ax.y);
    const hasDir = dir.lengthSq() > 0.05;
    if (hasDir) dir.normalize();
    for (const m of mates) {
      _v.set(m.pos.x - u.pos.x, 0, m.pos.z - u.pos.z);
      const d = _v.length();
      _v.normalize();
      const s = hasDir ? _v.dot(dir) * 3 - d * 0.05 : openness(this, m) - d * 0.1;
      if (s > bs) { bs = s; best = m; }
    }
    if (best) this.passTo(u, best, { noLook: u.sprint ? (Math.random() < 0.5 ? 0.9 : -0.9) : 0 });
  }

  userOop(u) {
    const mates = this.teams[u.team].players.filter((p) => p !== u);
    let best = null, bs = -1e9;
    for (const m of mates) {
      const s = m.attr.dunk * 3 - distXZ(m.pos, RIM) * 0.3;
      if (s > bs) { bs = s; best = m; }
    }
    if (best && distXZ(best.pos, RIM) < 10.5) this.throwOop(u, best);
    else this.passTo(u, best);
  }

  // -------------------------------------------------------------------------
  // Offensive actions
  // -------------------------------------------------------------------------
  doMove(p, move, opts = {}) {
    if (!p.hasBall || p.busy) return;
    if (move === 'spin' || move === 'stepBack') p.startAction(move, opts);
    else p.startAction(move, opts);
    if (move === 'crossover' || move === 'behindBack' || move === 'betweenLegs' || move === 'spin') {
      const [t1] = this.handTrails;
      t1.setColors(0xffffff, this.teamColors[p.team].glow, 1.4);
      t1.start(this.ball.pos);
      t1.headFn = () => this.ball.pos;
      setTimeout(() => t1.stop(), 380);
    }
  }

  chooseDunk(p) {
    const opts = DUNKS_BY_SKILL.filter(([min]) => p.attr.dunk >= min).map(([, t]) => t);
    return pick(opts);
  }

  startShotContext(p, userHold) {
    if (!p.hasBall || p.busy) return;
    const d = distXZ(p.pos, RIM);
    _v.set(RIM.x - p.pos.x, 0, RIM.z - p.pos.z).normalize();
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const toward = (p.vel.x * _v.x + p.vel.z * _v.z) / Math.max(sp, 0.01);
    const driving = sp > 2.2 && toward > 0.5;
    const dunkRange = 1.3 + 2.4 * p.attr.dunk;
    const side = p.pos.x >= RIM.x ? 'R' : 'L';
    // is there a defender right in the lane?
    const blocker = this.nearestOpp(p, 1.1, true);
    if (d < dunkRange && (driving || d < 2.1) && p.attr.dunk > 0.45 && (!blocker || p.attr.dunk > 0.9)) {
      p.startAction('dunk', { type: this.chooseDunk(p), side });
      return;
    }
    if (d < 3.4 && (driving || d < 2.4)) {
      p.startAction('layup', { side });
      return;
    }
    const opts = { userHold, holding: userHold, side: 'R' };
    if (!userHold) opts.aiRelease = undefined;
    const a = p.startAction('shoot', opts);
    if (!userHold) {
      const err = (Math.random() + Math.random() - 1) * this.diffFor(p).aiRelErr * 2;
      a.aiRelease = a.ideal + err;
    }
  }

  onShotStart(p, a) {
    a.startPos = p.pos.clone();
    a.three = isThree(p.pos);
    if (p.isUser && a.name === 'shoot' && !a.special) this.ui.shotMeter(a);
  }

  shotProbability(p, kind, a) {
    const d = distXZ(p.pos, RIM);
    let base;
    if (kind === 'layup') base = 0.62 + 0.3 * p.attr.dunk * 0.5 + 0.1;
    else {
      const skill = a.three ? p.attr.three : p.attr.shoot;
      let dp;
      if (d < 2) dp = 0.72;
      else if (d < 4.5) dp = 0.6;
      else if (d < ARC_R) dp = 0.52;
      else dp = 0.46 - Math.max(0, d - 7.4) * 0.12;
      base = dp * (0.55 + 0.7 * skill);
      base *= 0.55 + 0.6 * (a.quality ?? 0.6);
      if (a.timing === 'perfect') base += 0.12;
      if (a.fade) base *= 0.95;
    }
    // contest
    let c = 1;
    for (const o of this.teams[1 - p.team].players) {
      const od = distXZ(o.pos, p.pos);
      if (o.stun > 0) continue;
      let k = 1;
      if (od < 0.9) k = 0.55;
      else if (od < 1.5) k = 0.7;
      else if (od < 2.3) k = 0.88;
      if (o.airborne && od < 2) k *= 0.8;
      c = Math.min(c, k);
    }
    base *= c;
    const df = this.diffFor(p);
    if (p.team !== this.userTeam) base *= df.cpuShot;
    else if (!this.demo) base *= DIFF[this.difficulty].userBonus;
    return clamp(base, 0.03, 0.97);
  }

  releaseShot(p, a) {
    const ball = this.ball;
    const prob = a.special ? 1 : this.shotProbability(p, 'jump', a);
    const make = Math.random() < prob;
    const d = distXZ(p.pos, RIM);
    const target = new THREE.Vector3(RIM.x, RIM.y + 0.02, RIM.z);
    if (make) {
      const r = a.special || a.timing === 'perfect' ? 0.01 : rand(0, 0.07);
      const ang = rand(0, Math.PI * 2);
      target.x += Math.cos(ang) * r;
      target.z += Math.sin(ang) * r;
    } else {
      const ang = rand(0, Math.PI * 2);
      const r = (a.quality ?? 0.5) < 0.25 && Math.random() < 0.4 ? rand(0.36, 0.5) : rand(0.2, 0.3);
      target.x += Math.cos(ang) * r;
      target.z += Math.sin(ang) * r;
    }
    const T = clamp(0.78 + d * 0.068, 0.78, 1.45) + (a.special ? 0.25 : 0);
    ball.holder = null;
    ball.launchTo(target, T);
    _v.copy(ball.vel).setY(0).normalize();
    ball.spinAxis.crossVectors(_v, _w.set(0, 1, 0)).normalize();
    ball.spinRate = 14;
    ball.shot = { shooter: p, team: p.team, points: a.three ? 3 : 2, special: !!a.special, t: 0, rimHit: false, boardHit: false, cleared: !this.clearNeeded, make, kind: 'jump' };
    this.audio.whoosh(0.35);
    if (p.isUser && !a.special) this.ui.shotResult(a.timing, a.quality);
    if (a.special) this.supernovaRelease(p, a);
    this.cheerTease(p);
  }

  releaseLayup(p, a) {
    const ball = this.ball;
    const prob = this.shotProbability(p, 'layup', a);
    const make = Math.random() < prob;
    const target = new THREE.Vector3(RIM.x, RIM.y + 0.03, RIM.z);
    if (!make) {
      const ang = rand(0, Math.PI * 2);
      target.x += Math.cos(ang) * 0.24;
      target.z += Math.sin(ang) * 0.24;
    }
    ball.holder = null;
    const d = ball.pos.distanceTo(target);
    ball.launchTo(target, clamp(0.35 + d * 0.18, 0.4, 0.75));
    ball.spinAxis.set(0, 1, 0);
    ball.spinRate = 8;
    ball.shot = { shooter: p, team: p.team, points: 2, special: false, t: 0, rimHit: false, boardHit: false, cleared: !this.clearNeeded, make, kind: 'layup' };
  }

  cheerTease() {
    this.court.crowdExcite = Math.max(this.court.crowdExcite, 0.3);
  }

  onDunkLaunch(p, a) {
    this.audio.whoosh(1);
    this.effects.dustPuff(p.pos, 10, 1.1);
    if (a.type === 'meteor') {
      this.slow(0.55, 0.9);
      this.cinematic(p, 2.1, { r: 4.2, h: 1.6, spin: 0.9 });
      this.effects.shockwave(new THREE.Vector3(p.pos.x, 0.05, p.pos.z), { color: 0xff7a1a, radius: 3.5, life: 0.5 });
      this.ballTrail.setColors(0xffd070, 0xff2a00, 3.5);
      this.ballTrail.start(this.ball.pos);
      this.ball.setGlow(0xff6a10, 0.7);
      this.audio.charge();
    }
  }

  onDunkFlight(p, a, s) {
    if (a.type === 'meteor') {
      this.effects.fire(this.ball.pos, 3, 1.0);
      this.effects.aura(p.pos, 0xff6a10, 3, 0.45, 2.2);
      if (Math.random() < 0.2) this.effects.lightning(this.ball.pos.clone(), this.ball.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(0.5, 2), rand(-1.5, 1.5))), 0xffc060, 0.15);
      if (s > 0.55 && !a.apexSlow) { a.apexSlow = true; this.slow(0.22, 0.45); this.effects.screen.speed = 1; this.effects.screen.zoom = 0.6; }
    } else if (p.airborne && Math.random() < 0.3) {
      this.effects.aura(p.pos, this.teamColors[p.team].glow, 1, 0.35, 2.2);
    }
    if (a.oop && !a.caught) {
      // catch the lob
      const ball = this.ball;
      if (!ball.holder && ball.pass && ball.pass.to === p) {
        p.rig.handPos('R', _v);
        p.rig.handPos('L', _w);
        _v.add(_w).multiplyScalar(0.5);
        if (_v.distanceTo(ball.pos) < 0.75 || a.t > a.slamT - 0.1) {
          a.caught = true;
          ball.give(p, 'hold');
          ball.lastPos.copy(ball.pos);
          ball.blend = 0.5;
          this.audio.catch_();
          ball.shot = null;
        }
      }
    }
  }

  slamDunk(p, a) {
    const ball = this.ball;
    if (!ball.holder || ball.holder !== p) {
      // lost the ball (oop miss / rejection)
      return;
    }
    ball.holder = null;
    ball.pos.set(RIM.x + a.dir.x * 0.03, RIM.y + 0.18, RIM.z + a.dir.z * 0.03);
    ball.vel.set(-a.dir.x * 0.3, -8.5, -a.dir.z * 0.3);
    ball.freeT = 0;
    ball.shot = { shooter: p, team: p.team, points: 2, special: a.type === 'meteor', t: 1, rimHit: true, boardHit: false, cleared: !this.clearNeeded, make: true, kind: 'dunk', dunk: true, oop: !!a.oop };
    this.court.rimShake = 0.12 + (a.type === 'meteor' ? 0.2 : 0);
    this.court.rimVel = -3;
    this.court.boardGlow = 1;
    this.court.kickNet(3);
    const rimPos = new THREE.Vector3(RIM.x, RIM.y, RIM.z);
    this.effects.sparks(rimPos, 40, 0xffd27a, 7);
    this.effects.shockwave(rimPos.clone().add(new THREE.Vector3(0, 0.05, 0.1)), { color: this.teamColors[p.team].glow, radius: 2.2, life: 0.45, vertical: true });
    this.effects.flashLight(rimPos, 0xffa040, 18);
    this.effects.shake = Math.max(this.effects.shake, 0.35);
    this.audio.dunk(1);
    this.court.crowdExcite = 1;
    if (a.type === 'meteor') this.meteorImpact(p, a);
    else {
      const names = { oneHand: 'SLAM!', twoHand: 'JAM!', tomahawk: 'TOMAHAWK!', windmill: 'WINDMILL!', reverse360: '360 JAM!' };
      this.ui.bigText(a.oop ? 'ALLEY-OOP!' : names[a.type] || 'SLAM!', 'dunk');
      this.effects.screen.aberr = 0.8;
    }
  }

  // -------------------------------------------------------------------------
  // Specials
  // -------------------------------------------------------------------------
  trySpecialOffense(p) {
    const team = this.teams[p.team];
    if (team.power < 1 || !p.hasBall || p.busy) return false;
    const d = distXZ(p.pos, RIM);
    const def = this.nearestOpp(p, 2.6, true);
    team.power = 0;
    this.audio.charge();
    this.effects.screen.flash = 0.5;
    this.effects.screen.tint.setRGB(1.2, 0.85, 0.6);
    this.effects.screen.tintAmt = 0.5;
    if (d < 4.5 || (!def && d < 7.2)) {
      const side = p.pos.x >= 0 ? 'R' : 'L';
      p.startAction('dunk', { type: 'meteor', side, special: true });
      this.ui.special('METEOR SLAM', p.team);
    } else if (def) {
      this.ankleCombo(p);
    } else {
      p.startAction('shoot', { special: true, side: 'R' });
      this.ui.special('SUPERNOVA SHOT', p.team);
      this.slow(0.5, 0.6);
      this.cinematic(p, 1.2, { r: 3.4, h: 1.1, spin: -0.6 });
      this.ball.setGlow(0x7fe8ff, 1.2);
      this.effects.aura(p.pos, 0x7fe8ff, 30, 0.6, 2.2);
    }
    return true;
  }

  ankleCombo(p) {
    this.ui.special('ANKLE BREAKER', p.team);
    this.slow(0.55, 1.1);
    this.cinematic(p, 1.3, { r: 3.2, h: 1.0, spin: 1.2 });
    this.effects.screen.speed = 1.2;
    p.startAction('crossover', { special: true, speed: 1.35 });
    p.queue = [['behindBack', { special: true, speed: 1.35 }], ['crossover', { special: true, speed: 1.3 }]];
    this.ball.setGlow(this.teamColors[p.team].glow, 0.9);
    this.ballTrail.setColors(this.teamColors[p.team].glow, 0xffffff, 3);
    this.ballTrail.start(this.ball.pos);
    setTimeout(() => { this.ballTrail.stop(); this.ball.setGlow(0xffffff, 0); }, 1400);
  }

  supernovaRelease(p, a) {
    const ball = this.ball;
    this.ballTrail.setColors(0x9ff6ff, 0xb45bff, 3.5);
    this.ballTrail.start(ball.pos);
    this.effects.shockwave(ball.pos.clone(), { color: 0x7fe8ff, radius: 2.5, life: 0.5, vertical: true });
    this.effects.burst(ball.pos, { n: 60, speed: 5, color: 0x9ff6ff, color1: 0xb45bff, size: 0.14, life: 0.7, grav: 0, shape: 1 });
    this.audio.zap();
    this.audio.sparkle();
    this.slow(0.35, 0.7);
    this.cam.cine = { mode: 'ball', t: 0, dur: 1.6 };
  }

  meteorImpact(p, a) {
    const ground = new THREE.Vector3(RIM.x, 0.05, RIM.z + 0.4);
    const rimPos = new THREE.Vector3(RIM.x, RIM.y, RIM.z);
    this.audio.boom();
    this.effects.screen.flash = 0.55;
    this.effects.screen.aberr = 1.8;
    this.effects.screen.zoom = 1.1;
    this.effects.shake = 1.3;
    this.slow(0.25, 0.7);
    this.effects.shockwave(ground, { color: 0xff7a1a, radius: 8, life: 0.9, thick: 0.08 });
    setTimeout(() => this.effects.shockwave(ground, { color: 0xffd070, radius: 5, life: 0.7 }), 90);
    this.effects.shockwave(rimPos, { color: 0xffffff, radius: 3.5, life: 0.5, vertical: true });
    this.effects.pillar(ground, 0xff8a2a, 9, 1.1, 0.9);
    this.effects.crack(ground, 6.5, 4);
    this.effects.burst(rimPos, { n: 120, speed: 9, color: 0xffd070, color1: 0xff2a00, size: 0.22, life: 1.0, grav: 3, shape: 0 });
    this.effects.sparks(rimPos, 90, 0xfff0a0, 11);
    this.effects.burst(ground, { n: 80, speed: 6, color: 0xff9a3a, color1: 0x401008, size: 0.4, life: 1.2, grav: -0.5, up: 1.5, spread: 0.3 });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      this.effects.lightning(rimPos, new THREE.Vector3(RIM.x + Math.cos(ang) * 4, 0.05, RIM.z + 1 + Math.sin(ang) * 3), 0xffc060, 0.45, 0.5);
    }
    this.effects.dustPuff(ground, 20, 2.2);
    this.effects.flashLight(rimPos, 0xff7a1a, 45);
    this.ui.bigText('METEOR SLAM!!', 'special');
    this.court.kickNet(8);
    this.ballTrail.stop();
    this.ball.setGlow(0xffffff, 0);
    // posterize nearby defenders
    for (const o of this.teams[1 - p.team].players) {
      if (distXZ(o.pos, RIM) < 3.6 && !o.isAction('ankleBroken')) {
        o.startAction('ankleBroken');
        this.effects.dizzy(() => o.rig.headPos(_u).clone(), 1.8);
      }
    }
  }

  trySpecialDefense(p) {
    const team = this.teams[p.team];
    const h = this.ball.holder;
    if (team.power < 1 || !h || h.team === p.team) return false;
    const d = distXZ(p.pos, h.pos);
    if (d > 5) return false;
    team.power = 0;
    this.audio.charge();
    const ha = h.action;
    if (ha && (ha.name === 'shoot' || ha.name === 'layup' || (ha.name === 'dunk' && ha.type !== 'meteor')) && !ha.released) {
      p.startAction('block', { special: true, target: this.ball.pos.clone() });
      this.ui.special('SKY WALL', p.team);
      this.slow(0.4, 0.7);
    } else {
      p.startAction('pickpocket', { target: h });
      this.ui.special('PICKPOCKET', p.team);
      this.slow(0.55, 0.5);
      this.effects.screen.speed = 1;
    }
    this.effects.aura(p.pos, this.teamColors[p.team].glow, 40, 0.6, 2.2);
    return true;
  }

  pickpocket(p, a) {
    const h = a.target;
    if (!h || !h.hasBall || distXZ(p.pos, h.pos) > 1.6) { this.ui.message('MISS...', 0.8); return; }
    this.effects.burst(this.ball.pos, { n: 60, speed: 5, color: this.teamColors[p.team].glow, size: 0.15, life: 0.6, grav: 0, shape: 1 });
    this.audio.steal();
    this.audio.cheer(1);
    if (h.action) h.endAction(true);
    h.startAction('stumble');
    this.gainBall(p, 'catch');
    this.ui.bigText('PICKPOCKET!', 'special');
    this.teams[p.team].power = Math.min(1, this.teams[p.team].power + 0.05);
  }

  specialFx(dt) {
    // ghosts during special dribble combo
    for (const p of this.players) {
      const a = p.action;
      if (a && a.special && ['crossover', 'behindBack', 'betweenLegs', 'spin'].includes(a.name)) {
        if (this.time - this.lastGhost > 0.045) {
          this.lastGhost = this.time;
          this.effects.ghost(p.rig, this.teamColors[p.team].glow, 0.4);
        }
        this.effects.aura(p.pos, this.teamColors[p.team].glow, 1, 0.4, 2);
      }
      if (a && a.name === 'block' && a.special) {
        this.effects.aura(p.pos, 0x7fe8ff, 2, 0.4, 2.4);
      }
      if (a && a.name === 'shoot' && a.special && !a.released) {
        this.effects.aura(p.pos, 0x7fe8ff, 2, 0.5, 2.2);
        if (Math.random() < 0.15) this.effects.lightning(p.rig.headPos(_v).clone().add(new THREE.Vector3(0, 0.3, 0)), p.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0.05, rand(-1, 1))), 0x9ff6ff, 0.12);
      }
    }
    const s = this.ball.shot;
    if (s && s.special && !this.ball.holder && s.kind === 'jump') {
      this.effects.burst(this.ball.pos, { n: 2, speed: 0.6, color: 0x9ff6ff, color1: 0xb45bff, size: 0.18, life: 0.5, grav: 0, shape: 1 });
    }
  }

  // -------------------------------------------------------------------------
  // Dribble interaction: ankle breakers
  // -------------------------------------------------------------------------
  checkAnkles(p, move, a) {
    if (!p.hasBall) return;
    const d = this.nearestOpp(p, a.special ? 3.2 : 1.9, true);
    if (!d || d.stun > 0 || d.isAction('ankleBroken')) return;
    const base = { crossover: 0.24, behindBack: 0.2, betweenLegs: 0.17, spin: 0.27, stepBack: 0.22 }[move] ?? 0.2;
    let chance = base + (p.attr.handle - 0.6) * 0.5 - (d.attr.defense - 0.6) * 0.4;
    if (d.isAction('steal')) chance += 0.35;
    if (d.isUser) chance *= 0.85;
    if (p.isUser) chance *= 1.25;
    if (this.time - (d.lastBeaten ?? -9) < 1.5) chance *= 0.5;
    const r = Math.random();
    if (a.special || r < chance * 0.38) {
      d.lastBeaten = this.time;
      if (d.action) d.endAction(true);
      d.startAction('ankleBroken');
      this.effects.dizzy(() => d.rig.headPos(_u).clone(), 1.9);
      this.effects.dustPuff(d.pos, 14, 1.3);
      this.effects.burst(d.rig.headPos(_v).clone(), { n: 30, speed: 3, color: 0xfff27a, size: 0.12, life: 0.7, grav: 2, shape: 1 });
      this.ui.bigText('ANKLE BREAKER!', 'special');
      this.audio.cheer(1.2);
      this.audio.whoosh(1);
      this.court.crowdExcite = 1;
      this.effects.shake = Math.max(this.effects.shake, 0.2);
      if (!a.special) { this.slow(0.35, 0.5); this.cinematic(p, 0.9, { r: 3.6, h: 1.2, spin: 0.8, target: d }); }
      this.addPower(p.team, 0.15);
    } else if (r < chance) {
      d.lastBeaten = this.time;
      if (d.action) d.endAction(true);
      d.startAction('stumble');
      this.effects.dustPuff(d.pos, 6, 0.8);
      if (p.isUser || d.isUser) this.ui.popText('SHAKE!', p);
      this.addPower(p.team, 0.05);
    }
  }

  addPower(team, v) {
    this.teams[team].power = Math.min(1, this.teams[team].power + v);
  }

  // -------------------------------------------------------------------------
  // Steals / passes
  // -------------------------------------------------------------------------
  startSteal(p, h) {
    if (p.busy) return;
    this.ball.pos; // ball side relative to stealer
    const f = p.facing;
    const lx = (this.ball.pos.x - p.pos.x) * Math.cos(f) - (this.ball.pos.z - p.pos.z) * Math.sin(f);
    p.startAction('steal', { target: h, side: lx > 0 ? 'L' : 'R' });
  }

  trySteal(p, a) {
    const h = a.target;
    if (!h || !h.hasBall) return;
    const d = distXZ(p.pos, h.pos);
    p.rig.handPos(a.side, _v);
    const hd = _v.distanceTo(this.ball.pos);
    if (d > 1.75 || hd > 0.95) return;
    let chance = 0.16 + 0.34 * p.attr.steal - 0.22 * h.attr.handle;
    if (this.ball.mode === 'transfer') chance += 0.12;
    if (h.busy && !h.isAction('crossover', 'behindBack', 'betweenLegs', 'spin')) chance += 0.08;
    if (hd < 0.45) chance += 0.15;
    if (p.isUser) chance *= 1.15;
    if (h.isUser) chance *= this.difficulty === 'easy' ? 0.6 : this.difficulty === 'hard' ? 1.1 : 0.85;
    if (Math.random() < chance) {
      const ball = this.ball;
      if (h.action) h.endAction(true);
      ball.holder = null;
      _v.set(p.pos.x - h.pos.x, 0, p.pos.z - h.pos.z).normalize();
      ball.release(new THREE.Vector3(_v.x * 3 + rand(-1, 1), 2.2, _v.z * 3 + rand(-1, 1)));
      ball.shot = null;
      ball.pass = null;
      h.grabLock = 0.6;
      this.effects.sparks(ball.pos, 16, 0xffffff, 4);
      this.audio.steal();
      this.ui.bigText('STEAL!', 'steal');
      this.addPower(p.team, 0.1);
      this.court.crowdExcite = Math.max(this.court.crowdExcite, 0.6);
      this.audio.cheer(0.6);
    }
  }

  passTo(p, r, opts = {}) {
    if (!p.hasBall || p.busy || !r) return;
    // bounce pass if a defender is on the lane
    let bounce = false;
    for (const o of this.teams[1 - p.team].players) {
      if (pointSegDist(o.pos, p.pos, r.pos) < 0.8) bounce = true;
    }
    p.startAction('pass', { target: r, bounce, noLook: opts.noLook ?? 0 });
    r.ai.expectPass = true;
  }

  throwOop(p, r) {
    if (!p.hasBall || p.busy || !r) return;
    p.startAction('pass', { target: r, lob: true, dur: 0.5 });
  }

  releasePass(p, a) {
    const ball = this.ball;
    const r = a.target;
    ball.holder = null;
    this.audio.pass();
    if (a.lob) {
      if (r.busy) r.endAction(true);
      _v.set(r.pos.x - RIM.x, 0, r.pos.z - RIM.z);
      if (_v.lengthSq() < 0.01) _v.set(0, 0, 1);
      _v.normalize();
      const takeoff = new THREE.Vector3(RIM.x + _v.x * 2.2, 0, RIM.z + _v.z * 2.2);
      const run = distXZ(r.pos, takeoff);
      const flight = 0.5;
      const T = Math.max(0.95, run / 8.5 + flight);
      const hang = new THREE.Vector3(RIM.x + _v.x * 0.6, 0, RIM.z + _v.z * 0.6);
      const meet = new THREE.Vector3(hang.x - _v.x * 0.12, RIM.y + 0.4, hang.z - _v.z * 0.12);
      ball.launchTo(meet, T);
      ball.pass = { from: p, to: r, lob: true, t: 0 };
      ball.shot = null;
      const side = r.pos.x >= 0 ? 'R' : 'L';
      r.startAction('dunk', { oop: true, jumpT: T - flight, flight: flight + 0.12, type: 'twoHand', side });
      r.action.catchT = T;
      this.ui.popText('OOP!', p);
      return;
    }
    const d = distXZ(p.pos, r.pos);
    const T = clamp(d / 13.5, 0.22, 0.85);
    const tgt = new THREE.Vector3(r.pos.x + r.vel.x * T * 0.8, 1.25 * r.S, r.pos.z + r.vel.z * T * 0.8);
    if (a.bounce && d > 3) this.launchBounce(tgt);
    else ball.launchTo(tgt, T);
    ball.spinAxis.set(0, 1, 0);
    ball.spinRate = 4;
    ball.pass = { from: p, to: r, t: 0, checked: new Set() };
    ball.shot = null;
    // control follows the ball for the user team
    if (p.isUser) this.setUser(r);
  }

  /** Solve a bounce pass that hits the floor at 60% of the way and rises to chest height. */
  launchBounce(tgt) {
    const ball = this.ball;
    const D = distXZ(ball.pos, tgt);
    const y0 = ball.pos.y, r = BALL_R, g = BALL_G;
    let best = null, be = 1e9;
    for (let v = 6; v <= 16; v += 0.25) {
      const t1 = (0.6 * D) / v, t2 = (0.4 * D) / (0.9 * v);
      const vyImp = (r - y0) / t1 - 0.5 * g * t1;
      const need = -(tgt.y - r + 0.5 * g * t2 * t2) / (0.74 * t2);
      const e = Math.abs(vyImp - need);
      if (e < be) { be = e; best = { v, t1 }; }
    }
    const F = new THREE.Vector3().lerpVectors(ball.pos, tgt, 0.6);
    F.y = r;
    ball.launchTo(F, best.t1);
  }

  // -------------------------------------------------------------------------
  // Ball contact checks
  // -------------------------------------------------------------------------
  checkBlocks() {
    const ball = this.ball;
    // shot in flight
    if (!ball.holder && ball.shot && !ball.shot.dunk && !ball.shot.special && ball.shot.t < 0.55 && !ball.shot.blocked) {
      for (const o of this.teams[1 - ball.shot.team].players) {
        if (!o.airborne || !o.isAction('block', 'rebound')) continue;
        const special = o.action.special;
        const R = special ? 0.9 : 0.36;
        if (this.handsNear(o, ball.pos, R)) { this.blocked(o, null); return; }
      }
    }
    // held-ball rejection
    const h = ball.holder;
    if (h && h.airborne && h.action && ['shoot', 'layup', 'dunk'].includes(h.action.name) && !h.action.released && !h.action.slammed) {
      const a = h.action;
      if (a.type === 'meteor') return;
      if (a.oop && !a.caught) return;
      for (const o of this.teams[1 - h.team].players) {
        if (!o.airborne || !o.isAction('block', 'rebound')) continue;
        const special = o.action.special;
        const R = special ? 0.9 : 0.34;
        if (this.handsNear(o, ball.pos, R)) { this.blocked(o, h); return; }
      }
    }
  }

  handsNear(p, pos, R) {
    p.rig.handPos('R', _v);
    if (_v.distanceTo(pos) < R) return true;
    p.rig.handPos('L', _v);
    return _v.distanceTo(pos) < R;
  }

  blocked(blocker, shooter) {
    const ball = this.ball;
    const special = blocker.action && blocker.action.special;
    if (shooter) {
      const a = shooter.action;
      shooter.endAction(true);
      if (shooter.pos.y > 0.05 && shooter.vy > 0) shooter.vy = 0;
      if (a && a.name === 'dunk') shooter.vy = -1;
    }
    ball.holder = null;
    _v.set(ball.pos.x - blocker.pos.x, 0, ball.pos.z - blocker.pos.z);
    if (_v.lengthSq() < 0.01) _v.set(0, 0, 1);
    _v.normalize();
    // swat away from the hoop
    _w.set(ball.pos.x - RIM.x, 0, ball.pos.z - RIM.z).normalize();
    _v.add(_w).normalize();
    const pw = special ? 11 : 6;
    ball.release(new THREE.Vector3(_v.x * pw + rand(-1.5, 1.5), special ? -3 : rand(-1, 2), _v.z * pw + rand(-1.5, 1.5)));
    ball.shot = null;
    ball.pass = null;
    ball.spinAxis.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    ball.spinRate = 25;
    this.effects.sparks(ball.pos, special ? 80 : 30, special ? 0x9ff6ff : 0xffffff, special ? 10 : 6);
    this.effects.shockwave(ball.pos.clone(), { color: special ? 0x7fe8ff : 0xffffff, radius: special ? 3.5 : 1.6, life: 0.4, vertical: true });
    this.effects.shake = Math.max(this.effects.shake, special ? 0.9 : 0.35);
    this.effects.screen.aberr = special ? 2 : 0.8;
    if (special) {
      this.effects.screen.flash = 0.7;
      this.slow(0.25, 0.6);
      for (let i = 0; i < 4; i++) this.effects.lightning(ball.pos.clone(), ball.pos.clone().add(new THREE.Vector3(rand(-2, 2), rand(-2, 1), rand(-2, 2))), 0x9ff6ff, 0.35);
      if (shooter) { shooter.startAction('stumble'); }
    } else this.slow(0.4, 0.35);
    this.audio.block();
    this.audio.cheer(1);
    this.court.crowdExcite = 1;
    this.ui.bigText(special ? 'DENIED!!' : pick(['BLOCKED!', 'REJECTED!', 'GET THAT OUT!']), special ? 'special' : 'block');
    this.addPower(blocker.team, 0.1);
  }

  checkGrabs() {
    const ball = this.ball;
    if (ball.holder || this.state !== 'live') return;
    const shot = ball.shot;
    if (shot && shot.dunk) return;
    const protectedShot = shot && !shot.rimHit && !shot.boardHit && (ball.vel.y > 0 || ball.pos.y > RIM.y - 0.35) && distXZ(ball.pos, RIM) < 4.5;
    if (shot && shot.t < 0.35) return;
    if (protectedShot) return;
    if (ball.pass && ball.pass.lob) {
      if (ball.freeT < 0.5 || ball.pos.y > 2.7) return;
    }
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.grabLock > 0 || p.stun > 0) continue;
      if (p.action && ['ankleBroken', 'stumble', 'dunk', 'celebrate'].includes(p.action.name)) continue;
      if (p.action && p.action.name === 'shoot' && p.action.released) continue;
      if (p.action && p.action.name === 'layup' && p.action.released) continue;
      if (ball.pass && ball.pass.from === p && ball.freeT < 0.4) continue;
      const S = p.S;
      const horiz = distXZ(p.pos, ball.pos);
      const isTarget = ball.pass && ball.pass.to === p;
      let reachR = isTarget ? 1.0 : 0.55;
      if (isTarget && ball.pos.distanceTo(p.chestPos(_u)) < 1.05) { best = p; bd = -1; break; }
      const lo = p.pos.y + 0.05, hi = p.pos.y + p.reach + (p.airborne ? 0.15 : -0.3);
      let ok = false;
      if (ball.pos.y > lo && ball.pos.y < hi && horiz < reachR) ok = true;
      if (!ok && p.airborne && this.handsNear(p, ball.pos, 0.42)) ok = true;
      if (!ok) continue;
      // interception chance for defenders on a pass
      if (ball.pass && !isTarget && p.team !== ball.pass.from.team) {
        if (ball.pass.checked.has(p)) continue;
        ball.pass.checked.add(p);
        let ch = 0.06 + 0.22 * p.attr.steal;
        if (p.airborne) ch += 0.15;
        if (p.isUser) ch += 0.15;
        if (Math.random() > ch) continue;
      }
      const d = horiz + Math.abs(ball.pos.y - (p.pos.y + 1.2 * S)) * 0.3;
      if (d < bd) { bd = d; best = p; }
    }
    if (best) this.gainBall(best);
  }

  gainBall(p, how) {
    const ball = this.ball;
    const wasPass = ball.pass;
    const shot = ball.shot;
    const prevTeam = this.offense;
    ball.give(p, 'hold');
    ball.lastPos.copy(ball.pos);
    const a = p.action;
    if (a && a.name === 'rebound') {
      a.caughtT = a.t;
    } else {
      if (a) p.endAction(true);
      if (how === 'catch' || wasPass || ball.pos.y > 0.8) p.startAction('catch');
      else p.startAction('pickup');
    }
    this.audio.catch_();
    p.ai.expectPass = false;
    p.ai.decision = null;
    p.ai.think = 0.25;
    // possession
    if (p.team !== prevTeam) {
      this.offense = p.team;
      this.clearNeeded = true;
      this.shotClock = 12;
      if (wasPass && wasPass.from.team !== p.team && ball.freeT < 1.2) {
        this.ui.bigText('INTERCEPTED!', 'steal');
        this.addPower(p.team, 0.08);
        this.audio.cheer(0.6);
      } else if (shot) this.ui.popText('REBOUND', p);
      if (p.team === this.userTeam) this.ui.message('CLEAR THE BALL! · 3점 라인 밖으로', 1.6);
      // reassign defensive matchups
      this.assignDefense(1 - p.team);
      if (!this.demo) this.setUser(p.team === this.userTeam ? p : this.closestTo(this.teams[this.userTeam].players, p.pos));
    } else {
      if (shot && (shot.rimHit || shot.boardHit)) { this.shotClock = 12; this.ui.popText('OFF. REBOUND', p); }
      if (p.team === this.userTeam && !this.demo) this.setUser(p);
    }
  }

  closestTo(list, pos) {
    let best = null, bd = 1e9;
    for (const q of list) { const d = distXZ(q.pos, pos); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  assignDefense(team) {
    const defs = this.teams[team].players.slice();
    const offs = this.teams[1 - team].players.slice();
    // greedy nearest matching
    const pairs = [];
    for (const d of defs) for (const o of offs) pairs.push([distXZ(d.pos, o.pos), d, o]);
    pairs.sort((a, b) => a[0] - b[0]);
    const usedD = new Set(), usedO = new Set();
    for (const [, d, o] of pairs) {
      if (usedD.has(d) || usedO.has(o)) continue;
      d.ai.man = o;
      usedD.add(d); usedO.add(o);
    }
  }

  // -------------------------------------------------------------------------
  // Ball events
  // -------------------------------------------------------------------------
  onBallThroughHoop(ball) {
    if (this.state !== 'live') {
      this.court.kickNet(1.5);
      this.audio.swish();
      return;
    }
    const s = ball.shot;
    const team = s ? s.team : ball.lastTouch ? ball.lastTouch.team : this.offense;
    const scorer = s ? s.shooter : ball.lastTouch;
    let pts = s ? s.points : 2;
    this.court.kickNet(s && s.dunk ? 3 : 1.6);
    this.audio.swish();
    const cleared = s ? s.cleared : !this.clearNeeded;
    if (!cleared) {
      this.ui.bigText('NO CLEAR!', 'bad');
      this.ui.message('공격권이 바뀌면 3점 라인 밖으로 먼저 나가야 해요', 2);
      this.nextOffense = 1 - team;
      this.state = 'turnover';
      this.stateT = 0;
      ball.shot = null;
      return;
    }
    this.teams[team].score += pts;
    const swish = s && !s.rimHit && !s.boardHit && !s.dunk;
    this.ui.scorePop(team, pts);
    if (s && s.special && s.kind === 'jump') {
      this.effects.firework(new THREE.Vector3(RIM.x, RIM.y, RIM.z));
      this.effects.shockwave(new THREE.Vector3(RIM.x, RIM.y, RIM.z + 0.1), { color: 0x9ff6ff, radius: 4, life: 0.7, vertical: true });
      this.effects.screen.flash = 0.6;
      this.effects.shake = 0.5;
      this.audio.boom();
      this.ui.bigText('SUPERNOVA!!', 'special');
      this.ballTrail.stop();
      ball.setGlow(0xffffff, 0);
    } else if (!(s && s.dunk)) {
      if (pts === 3) this.ui.bigText(swish ? 'SPLASH! +3' : 'BANG! +3', 'three');
      else this.ui.bigText(swish ? 'SWISH!' : pick(['BUCKET!', 'MONEY!', 'COUNT IT!']), 'score');
    }
    if (swish) this.effects.burst(new THREE.Vector3(RIM.x, RIM.y - 0.2, RIM.z), { n: 30, speed: 2.5, color: 0xffffff, size: 0.1, life: 0.6, grav: 3 });
    this.effects.confetti(new THREE.Vector3(RIM.x, RIM.y + 0.3, RIM.z + 0.5), pts === 3 ? 120 : 60);
    this.court.boardGlow = 1;
    this.court.crowdExcite = 1;
    this.audio.cheer(pts === 3 || (s && s.dunk) ? 1.3 : 0.9);
    this.addPower(team, 0.1 + (swish ? 0.06 : 0) + (s && s.dunk ? 0.08 : 0) + (pts === 3 ? 0.05 : 0));
    this.addPower(1 - team, 0.04);
    ball.shot = { ...(s || {}), scored: true, dunk: s ? s.dunk : false };
    this.state = 'scored';
    this.stateT = 0;
    this.nextOffense = 1 - team;
    // reactions
    setTimeout(() => {
      if (scorer && !scorer.busy) scorer.startAction('celebrate');
      for (const q of this.teams[1 - team].players) if (!q.busy && Math.random() < 0.6) q.startAction('dejected');
    }, 450);
    if (this.teams[team].score >= this.target || this.overtime || (this.gameClock <= 0 && this.teams[0].score !== this.teams[1].score)) {
      setTimeout(() => this.endGame(), 1300);
    }
  }

  onRimHit(ball, impact) {
    this.audio.rim(clamp(impact / 4, 0.3, 1));
    this.court.rimVel -= impact * 0.25;
    if (ball.shot && !ball.shot.rimHit) {
      ball.shot.rimHit = true;
      if (this.state === 'live') this.shotClock = 12;
    }
  }

  onBoardHit(ball) {
    this.audio.board();
    if (ball.shot) ball.shot.boardHit = true;
  }

  onFloorHit(ball, imp) {
    this.audio.bounce(clamp(imp / 6, 0.2, 1));
    if (ball.shot && !ball.shot.scored) ball.shot = null;
    if (ball.pass && !ball.pass.lob && ball.freeT > 0.8) ball.pass = null;
  }

  slow(scale, dur) {
    this.slowScale = scale;
    this.slowT = Math.max(this.slowT, dur);
  }

  cinematic(p, dur, o = {}) {
    this.cam.cine = { mode: 'orbit', p: o.target ?? p, t: 0, dur, r: o.r ?? 3.6, h: o.h ?? 1.3, spin: o.spin ?? 0.8, a0: null };
  }

  // -------------------------------------------------------------------------
  separate() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (a.action?.def.rootControl || b.action?.def.rootControl) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.0) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = 0.62;
        if (d < min && d > 1e-4) {
          const push = (min - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------
  updateCamera(rdt) {
    const cam = this.cam;
    const ball = this.ball;
    const h = ball.holder;
    const fx = h ? h.pos.x * 0.7 + ball.pos.x * 0.3 : ball.pos.x;
    const fz = h ? h.pos.z * 0.7 + ball.pos.z * 0.3 : ball.pos.z;
    cam.focus.x = damp(cam.focus.x, fx, 3.2, rdt);
    cam.focus.z = damp(cam.focus.z, fz, 3.2, rdt);
    const f = cam.focus;
    let px, py, pz, lx, ly, lz;
    if (this.state === 'menu') {
      const a = this.time * 0.12;
      px = Math.sin(a) * 8; py = 4.2; pz = 5.5 + Math.cos(a) * 7.5;
      lx = 0; ly = 1.8; lz = 2.5;
    } else {
      px = f.x * 0.5;
      pz = clamp(f.z + 7.4, 8.2, 13.2);
      py = 4.7 + (pz - 8) * 0.16;
      lx = f.x * 0.66;
      ly = 1.25;
      lz = lerp(f.z, RIM.z, 0.36) - 0.4;
      if (this.state === 'intro') {
        const k = smooth(this.stateT / 2.2);
        px = lerp(-9, px, k); py = lerp(2.2, py, k); pz = lerp(1, pz, k);
      }
    }
    let k = 1;
    const c = cam.cine;
    if (c) {
      c.t += rdt;
      const blend = Math.min(smooth(c.t / 0.3), smooth((c.dur - c.t) / 0.4));
      if (c.t >= c.dur) cam.cine = null;
      else if (c.mode === 'orbit') {
        const p = c.p;
        if (c.a0 === null) {
          // start orbit from camera side
          c.a0 = Math.atan2(cam.pos.x - p.pos.x, cam.pos.z - p.pos.z) + 0.6;
        }
        const ang = c.a0 + c.spin * c.t;
        const cx = p.pos.x + Math.sin(ang) * c.r, cz = p.pos.z + Math.cos(ang) * c.r;
        const cy = p.pos.y + c.h + 0.3;
        px = lerp(px, cx, blend); py = lerp(py, cy, blend); pz = lerp(pz, cz, blend);
        lx = lerp(lx, p.pos.x, blend); ly = lerp(ly, p.pos.y + 1.2, blend); lz = lerp(lz, p.pos.z, blend);
        k = 0.25;
      } else if (c.mode === 'ball') {
        const b = ball.pos;
        const cx = b.x * 0.5 + 2.5, cy = Math.max(2.5, b.y + 0.8), cz = b.z + 4.2;
        px = lerp(px, cx, blend * 0.8); py = lerp(py, cy, blend * 0.8); pz = lerp(pz, cz, blend * 0.8);
        lx = lerp(lx, b.x, blend); ly = lerp(ly, b.y, blend); lz = lerp(lz, b.z, blend);
      }
    }
    const rate = c ? 10 : 4.5;
    cam.pos.x = damp(cam.pos.x, px, rate, rdt);
    cam.pos.y = damp(cam.pos.y, py, rate, rdt);
    cam.pos.z = damp(cam.pos.z, pz, rate, rdt);
    cam.look.x = damp(cam.look.x, lx, rate * 1.2, rdt);
    cam.look.y = damp(cam.look.y, ly, rate * 1.2, rdt);
    cam.look.z = damp(cam.look.z, lz, rate * 1.2, rdt);
    void k;
    const sh = this.effects.shake;
    this.camera.position.set(
      cam.pos.x + (Math.random() - 0.5) * sh * 0.5,
      cam.pos.y + (Math.random() - 0.5) * sh * 0.5,
      cam.pos.z + (Math.random() - 0.5) * sh * 0.3,
    );
    this.camera.lookAt(cam.look);
    const fovT = 48 - this.effects.screen.zoom * 5 + (c && c.mode === 'orbit' ? 4 : 0);
    cam.fov = damp(cam.fov, fovT, 6, rdt);
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function pointSegDist(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz || 1;
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
  t = clamp(t, 0, 1);
  const x = a.x + abx * t, z = a.z + abz * t;
  return Math.hypot(p.x - x, p.z - z);
}

export { BALL_G, RIM_R };
