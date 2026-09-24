import * as THREE from 'three';
import { RIM, ARC_R, distXZ, isThree, rand, pick, clamp, pointSegDistXZ } from './constants.js';

const SPOTS = [
  [0, 7.6], [-4.9, 5.4], [4.9, 5.4], [-6.9, 0.6], [6.9, 0.6], [-2.6, 3.9], [2.6, 3.9], [-2.1, 0.9], [2.1, 0.9], [-3.4, 7.2], [3.4, 7.2],
];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export function moveTo(p, x, z, speed = 1, stop = 0.25) {
  const dx = x - p.pos.x, dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < stop) { p.move.set(0, 0, 0); return d; }
  const k = Math.min(1, d / 0.9) * speed;
  p.move.set((dx / d) * k, 0, (dz / d) * k);
  return d;
}

function faceRim(p) { p.faceTowards(RIM.x, RIM.z); }

export function openness(g, p) {
  let best = 99;
  for (const o of g.teams[1 - p.team].players) {
    if (o.stun > 0.3) continue;
    const d = distXZ(o.pos, p.pos);
    // defenders between player and rim count more
    _v.set(RIM.x - p.pos.x, 0, RIM.z - p.pos.z).normalize();
    _w.set(o.pos.x - p.pos.x, 0, o.pos.z - p.pos.z);
    const front = _w.dot(_v) > 0 ? 1 : 1.5;
    best = Math.min(best, d * front);
  }
  return best;
}

function nearestOpp(g, p) {
  let best = null, bd = 99;
  for (const o of g.teams[1 - p.team].players) {
    const d = distXZ(o.pos, p.pos);
    if (d < bd) { bd = d; best = o; }
  }
  return [best, bd];
}

export function updateAI(g, p, dt) {
  const ai = p.ai;
  ai.think -= dt;
  ai.stealCd -= dt;
  p.sprint = false;
  p.guardHigh = false;
  const ball = g.ball;
  if (p.stun > 0 || (p.action && p.action.def.rootControl)) { p.move.set(0, 0, 0); return; }
  if (g.state === 'check') { checkPositioning(g, p); return; }
  if (g.state !== 'live') {
    p.defending = false;
    p.move.multiplyScalar(0.9);
    return;
  }
  if (ball.pass && ball.pass.to === p && !ball.holder && !ball.pass.lob) {
    const t = Math.min(0.4, distXZ(ball.pos, p.pos) / 12);
    ball.predict(t, _v);
    moveTo(p, _v.x, _v.z, 0.8, 0.3);
    p.faceTowards(ball.pos.x, ball.pos.z);
    p.defending = false;
    return;
  }
  if (ball.holder === p) { p.defending = false; offenseHandler(g, p, dt); return; }
  if (!ball.holder) { p.defending = false; looseBall(g, p, dt); return; }
  if (ball.holder.team === p.team) { p.defending = false; offBall(g, p, dt); return; }
  p.defending = true;
  defense(g, p, dt);
}

function checkPositioning(g, p) {
  const t = p.ai.checkSpot;
  if (t) moveTo(p, t.x, t.z, 0.5, 0.2);
  else p.move.set(0, 0, 0);
  const h = g.ball.holder;
  if (h && h !== p) p.faceTowards(h.pos.x, h.pos.z);
  else faceRim(p);
  p.defending = h && h.team !== p.team;
}

// ---------------------------------------------------------------------------
function offenseHandler(g, p, dt) {
  const ai = p.ai;
  const d = distXZ(p.pos, RIM);
  const [def, dd] = nearestOpp(g, p);
  ai.threat = clamp(1.9 - dd, 0, 1);
  if (p.busy) return;
  const team = g.teams[p.team];
  // keep executing current decision
  if (ai.decision && ai.decision.type === 'move') {
    const dec = ai.decision;
    const dist = moveTo(p, dec.x, dec.z, 1, 0.4);
    p.sprint = !!dec.sprint;
    if (dist < 1.5 || p.move.lengthSq() < 0.01) faceRim(p);
    else p.targetFacing = Math.atan2(p.move.x, p.move.z);
    if (d < 2.4 && !g.clearNeeded) ai.think = Math.min(ai.think, 0);
  }
  if (ai.think > 0) return;
  ai.think = g.diffFor(p).react * rand(0.7, 1.3);

  if (g.clearNeeded) {
    if (isThree(p.pos)) { ai.think = 0; return; }
    _v.set(p.pos.x - RIM.x, 0, p.pos.z - RIM.z);
    if (_v.lengthSq() < 0.01) _v.set(0, 0, 1);
    _v.normalize();
    if (_v.z < 0.1) { _v.z = 0.3; _v.normalize(); }
    ai.decision = { type: 'move', x: RIM.x + _v.x * (ARC_R + 0.9), z: RIM.z + _v.z * (ARC_R + 0.9), sprint: true };
    if (dd < 1.2 && Math.random() < 0.3) g.doMove(p, pick(['crossover', 'behindBack', 'spin']));
    return;
  }

  const clock = g.shotClock;
  const open = openness(g, p);
  // special
  if (team.power >= 1 && Math.random() < 0.35 * g.diffFor(p).special) {
    if (g.trySpecialOffense(p)) return;
  }
  if (d < 2.3 || (clock < 2.2 && d < 3.5)) { g.startShotContext(p, false); return; }
  const range = p.attr.three > 0.6 ? 7.7 : p.attr.shoot > 0.6 ? 6.2 : 4.5;
  if (clock < 2.4) { g.startShotContext(p, false); return; }
  if (open > 1.9 && d < range && d > 3.2 && Math.random() < 0.42 + p.attr.shoot * 0.35) { g.startShotContext(p, false); return; }
  if (open > 1.3 && d < range && d > 4 && p.attr.shoot > 0.65 && Math.random() < 0.18) { g.startShotContext(p, false); return; }

  // dribble move vs pressure
  _v.set(RIM.x - p.pos.x, 0, RIM.z - p.pos.z).normalize();
  _w.set(def.pos.x - p.pos.x, 0, def.pos.z - p.pos.z).normalize();
  const inFront = _w.dot(_v) > 0.2;
  if (dd < 1.6 && inFront && Math.random() < 0.38 && g.time - p.lastDribbleMove > 1.2) {
    const moves = ['crossover', 'crossover', 'behindBack', 'betweenLegs'];
    if (d < 7) moves.push('spin');
    if (p.attr.three > 0.6 && d > 5.5) moves.push('stepBack');
    const mv = pick(moves);
    if (mv === 'stepBack') { g.doMove(p, mv); ai.pendingShot = g.time + 0.5; return; }
    g.doMove(p, mv);
    ai.decision = { type: 'move', x: RIM.x + Math.sign(p.pos.x || 1) * 0.6, z: RIM.z + 0.9, sprint: true };
    return;
  }

  // pass
  let best = null, bestScore = -9;
  for (const tm of g.teams[p.team].players) {
    if (tm === p) continue;
    let s = openness(g, tm) - distXZ(tm.pos, p.pos) * 0.05;
    if (tm.cutting && distXZ(tm.pos, RIM) < 4.5) s += 1.4;
    for (const o of g.teams[1 - p.team].players) {
      const ld = pointSegDistXZ(o.pos, p.pos, tm.pos);
      if (ld < 1.0 && o.stun <= 0) s -= 2.5 * (1 - ld);
    }
    if (s > bestScore) { bestScore = s; best = tm; }
  }
  if (best && bestScore > open + 0.4 && Math.random() < 0.5) {
    if (best.cutting && best.attr.dunk > 0.55 && Math.random() < 0.55 && distXZ(best.pos, RIM) < 8) g.throwOop(p, best);
    else g.passTo(p, best);
    return;
  }

  // drive or reposition
  const laneOpen = !inFront || dd > 2.0;
  if (laneOpen || Math.random() < 0.3) {
    const side = Math.sign(p.pos.x - def.pos.x) || (Math.random() < 0.5 ? -1 : 1);
    ai.decision = { type: 'move', x: RIM.x + side * rand(0.4, 1.2), z: RIM.z + rand(0.6, 1.4), sprint: d > 3 };
  } else {
    const s = pick(SPOTS);
    ai.decision = { type: 'move', x: s[0] + rand(-0.5, 0.5), z: s[1] + rand(-0.5, 0.5), sprint: false };
  }
}

// ---------------------------------------------------------------------------
function offBall(g, p, dt) {
  const ai = p.ai;
  const h = g.ball.holder;
  ai.spotT -= dt;
  if (p.busy) return;
  if (ai.spotT <= 0 || !ai.spot) {
    p.cutting = false;
    ai.spotT = rand(2.2, 4.2);
    if (!g.clearNeeded && Math.random() < 0.28 + p.attr.dunk * 0.15) {
      const side = Math.sign(p.pos.x) || 1;
      ai.spot = new THREE.Vector3(side * rand(0.4, 1.3), 0, rand(0.7, 1.6));
      p.cutting = true;
      ai.spotT = 1.7;
    } else {
      let best = null, bs = -99;
      for (const s of SPOTS) {
        let m = 99;
        for (const tm of g.teams[p.team].players) {
          if (tm === p) continue;
          const tgt = tm.ai.spot && tm !== h ? tm.ai.spot : tm.pos;
          m = Math.min(m, Math.hypot(tgt.x - s[0], tgt.z - s[1]));
        }
        const sc = m - Math.hypot(p.pos.x - s[0], p.pos.z - s[1]) * 0.15 + Math.random() * 1.2;
        if (sc > bs) { bs = sc; best = s; }
      }
      ai.spot = new THREE.Vector3(best[0], 0, best[1]);
    }
  }
  const d = moveTo(p, ai.spot.x, ai.spot.z, 1, 0.3);
  p.sprint = p.cutting || d > 4;
  if (d < 1.2) p.faceTowards(h.pos.x, h.pos.z);
  else p.targetFacing = Math.atan2(p.move.x, p.move.z);
}

// ---------------------------------------------------------------------------
function looseBall(g, p, dt) {
  const ball = g.ball;
  const ai = p.ai;
  if (p.busy) return;
  const shotFlight = ball.shot && !ball.shot.dunk;
  // time to reach
  if (shotFlight) {
    // crash the boards / box out
    const big = p.attr.rebound ?? 0.5;
    const tgtR = big > 0.6 ? 1.3 : 2.8;
    if (!ai.rebAng) ai.rebAng = rand(-1.2, 1.2) + (p.team ? 0.4 : -0.4);
    const x = RIM.x + Math.sin(ai.rebAng) * tgtR, z = RIM.z + Math.cos(ai.rebAng) * tgtR * 0.9 + 0.2;
    moveTo(p, x, z, 1, 0.3);
    p.sprint = true;
    p.faceTowards(ball.pos.x, ball.pos.z);
    tryReboundJump(g, p);
    return;
  }
  ai.rebAng = null;
  // chase if among the closest two of my team
  const mine = g.teams[p.team].players.slice().sort((a, b) => distXZ(a.pos, ball.pos) - distXZ(b.pos, ball.pos));
  const rank = mine.indexOf(p);
  if (rank <= 1) {
    const lead = Math.min(0.5, distXZ(p.pos, ball.pos) / 10);
    ball.predict(lead, _v);
    moveTo(p, _v.x, _v.z, 1, 0.05);
    p.sprint = true;
    p.targetFacing = Math.atan2(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
    tryReboundJump(g, p);
  } else {
    // drift toward a spot
    const s = SPOTS[(p.slot * 3 + p.team) % SPOTS.length];
    moveTo(p, s[0], s[1], 0.6, 0.4);
    p.faceTowards(ball.pos.x, ball.pos.z);
  }
}

function tryReboundJump(g, p) {
  const ball = g.ball;
  if (p.busy || !p.grounded || p.stun > 0) return;
  if (ball.vel.y > 1.5) return;
  if (ball.shot && !ball.shot.rimHit && !ball.shot.boardHit && ball.pos.y > 2.6) return;
  // predict ball position 0.3s ahead and see if it's in jumping reach
  for (const t of [0.25, 0.35, 0.45]) {
    ball.predict(t, _v);
    if (_v.y < 0.5) continue;
    const hd = Math.hypot(_v.x - p.pos.x, _v.z - p.pos.z);
    const top = p.reach + 0.55 + 0.25 * p.attr.jump;
    if (hd < 1.1 && _v.y > p.reach - 0.2 && _v.y < top) {
      if (Math.random() < g.diffFor(p).rebound) p.startAction('rebound', { target: _v.clone() });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
function defense(g, p, dt) {
  const ai = p.ai;
  const ball = g.ball;
  const h = ball.holder;
  let man = ai.man;
  if (!man || man.team === p.team) man = ai.man = h;
  const onBall = man === h;
  const diff = g.diffFor(p);
  const dRim = distXZ(man.pos, RIM);
  if (p.busy) return;

  let tx, tz;
  if (onBall) {
    _v.set(RIM.x - man.pos.x, 0, RIM.z - man.pos.z);
    const l = _v.length() || 1;
    _v.divideScalar(l);
    let gap = 1.05;
    if (dRim > 8.2) gap = 1.9;
    if (man.attr.three < 0.5 && dRim > 6.5) gap = 1.8;
    if (h.isAction('shoot', 'layup', 'dunk')) gap = 0.7;
    gap = Math.min(gap, l - 0.3);
    tx = man.pos.x + _v.x * gap;
    tz = man.pos.z + _v.z * gap;
    p.faceTowards(man.pos.x, man.pos.z);
    p.guardHigh = dRim < 7.5 && distXZ(p.pos, man.pos) < 1.8;
  } else {
    const bx = man.pos.x * 0.62 + RIM.x * 0.38, bz = man.pos.z * 0.62 + RIM.z * 0.38;
    tx = bx + (h.pos.x - bx) * 0.22;
    tz = bz + (h.pos.z - bz) * 0.22;
    const hd = distXZ(p.pos, h.pos);
    if (hd < 5) p.faceTowards(h.pos.x, h.pos.z); else p.faceTowards(man.pos.x, man.pos.z);
  }
  const dist = moveTo(p, tx, tz, 1, 0.12);
  p.sprint = dist > 1.4 || (onBall && man.sprint);

  // special defense
  const team = g.teams[p.team];
  if (onBall && team.power >= 1 && Math.random() < 0.6 * dt * diff.special) {
    if (g.trySpecialDefense(p)) return;
  }
  // contest shots
  const ha = h.action;
  if (ha && (ha.name === 'shoot' || ha.name === 'layup' || ha.name === 'dunk') && !ha.released && !ha.slammed && ha.name && ha.def) {
    const d = distXZ(p.pos, h.pos);
    if (d < 2.8 && ha.type !== 'meteor' && !ha.special) {
      if (ai.blockFor !== ha) {
        ai.blockFor = ha;
        ai.blockAt = g.time + diff.blockReact * rand(0.8, 1.3);
        ai.willBlock = Math.random() < diff.block * (0.6 + p.attr.block * 0.6);
      }
      if (ai.willBlock && g.time >= ai.blockAt) {
        ai.willBlock = false;
        const target = g.ball.pos.clone();
        p.startAction('block', { target, side: g.ball.pos.x > p.pos.x ? 'R' : 'L' });
        return;
      }
    }
  }
  // steal attempts
  if (onBall && ai.stealCd <= 0) {
    const d = distXZ(p.pos, h.pos);
    if (d < 1.5 && Math.random() < diff.steal * dt * (0.6 + p.attr.steal)) {
      ai.stealCd = rand(1.4, 3.2);
      g.startSteal(p, h);
    }
  }
}
