#!/usr/bin/env node
/**
 * Round-trip test for host binary snapshots (mirrors src/net/coopProtocol.ts).
 */
const KIND_CODES = { walker: 0, runner: 1, mutant: 2, tank: 3 };
const KIND_NAMES = ['walker', 'runner', 'mutant', 'tank'];

function encodeHostBinary(snap) {
  const zCount = Math.min(48, snap.zombies.length);
  const pCount = Math.min(24, snap.projectiles?.length ?? 0);
  const fCount = Math.min(12, snap.flashes?.length ?? 0);
  const place = snap.place.slice(0, 48);
  const objective = snap.objective.slice(0, 64);
  const placeBytes = new TextEncoder().encode(place);
  const objBytes = new TextEncoder().encode(objective);
  const floatCount = 1 + 10 + 1 + 1 + 1 + 2 + 2 + 3 + 3 + zCount * 3 + pCount * 3 + fCount * 3;
  const buf = new ArrayBuffer(4 + floatCount * 4 + 2 + placeBytes.length + 2 + objBytes.length);
  const view = new DataView(buf);
  view.setUint8(0, 0x48);
  view.setUint8(1, 1);
  let o = 4;
  const f = (v) => {
    view.setFloat32(o, v, true);
    o += 4;
  };
  f(snap.at);
  f(snap.bike.x);
  f(snap.bike.z);
  f(snap.bike.vx);
  f(snap.bike.vz);
  f(snap.bike.heading);
  f(snap.bike.speed);
  f(snap.bike.lean);
  f(snap.bike.drifting ? 1 : 0);
  f(snap.bike.hp);
  f(snap.bike.fuel);
  f(snap.aim);
  f(snap.weapon);
  f(snap.fire ? 1 : 0);
  f(snap.lat);
  f(snap.lon);
  f(snap.cx);
  f(snap.cz);
  f(snap.scrap);
  f(snap.kills);
  f(snap.horde);
  f(zCount);
  f(pCount);
  f(fCount);
  for (let i = 0; i < zCount; i++) {
    const z = snap.zombies[i];
    f(z.x);
    f(z.z);
    f(KIND_CODES[z.kind] ?? 0);
  }
  for (let i = 0; i < pCount; i++) {
    const p = snap.projectiles[i];
    f(p.x);
    f(p.z);
    f(p.kind);
  }
  for (let i = 0; i < fCount; i++) {
    const fl = snap.flashes[i];
    f(fl.x);
    f(fl.z);
    f(fl.life);
  }
  view.setUint16(o, placeBytes.length, true);
  o += 2;
  new Uint8Array(buf, o, placeBytes.length).set(placeBytes);
  o += placeBytes.length;
  view.setUint16(o, objBytes.length, true);
  o += 2;
  new Uint8Array(buf, o, objBytes.length).set(objBytes);
  return buf;
}

function decodeHostBinary(buf) {
  if (buf.byteLength < 8) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== 0x48) return null;
  let o = 4;
  const f = () => {
    const v = view.getFloat32(o, true);
    o += 4;
    return v;
  };
  try {
    const at = f();
    const bike = {
      x: f(),
      z: f(),
      vx: f(),
      vz: f(),
      heading: f(),
      speed: f(),
      lean: f(),
      drifting: f() > 0.5,
      hp: f(),
      fuel: f(),
    };
    const aim = f();
    const weapon = Math.max(0, Math.min(2, Math.round(f())));
    const fire = f() > 0.5;
    const lat = f();
    const lon = f();
    const cx = f();
    const cz = f();
    const scrap = f();
    const kills = f();
    const horde = f();
    const zCount = Math.max(0, Math.min(48, Math.round(f())));
    const pCount = Math.max(0, Math.min(24, Math.round(f())));
    const fCount = Math.max(0, Math.min(12, Math.round(f())));
    const zombies = [];
    for (let i = 0; i < zCount; i++) {
      zombies.push({ x: f(), z: f(), kind: KIND_NAMES[Math.round(f())] || 'walker' });
    }
    const projectiles = [];
    for (let i = 0; i < pCount; i++) {
      projectiles.push({ x: f(), z: f(), kind: Math.round(f()) });
    }
    const flashes = [];
    for (let i = 0; i < fCount; i++) {
      flashes.push({ x: f(), z: f(), life: f() });
    }
    const placeLen = view.getUint16(o, true);
    o += 2;
    const place = new TextDecoder().decode(new Uint8Array(buf, o, placeLen));
    o += placeLen;
    const objLen = view.getUint16(o, true);
    o += 2;
    const objective = new TextDecoder().decode(new Uint8Array(buf, o, objLen));
    return {
      t: 'host',
      at,
      bike,
      aim,
      weapon,
      fire,
      lat,
      lon,
      cx: Math.round(cx),
      cz: Math.round(cz),
      scrap,
      kills,
      horde,
      place,
      objective,
      zombies,
      projectiles,
      flashes,
    };
  } catch {
    return null;
  }
}

function approx(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps;
}

function assertSnap(orig, decoded) {
  if (!decoded) throw new Error('decode returned null');
  const keys = ['at', 'aim', 'lat', 'lon', 'cx', 'cz', 'scrap', 'kills', 'horde'];
  for (const k of keys) {
    if (!approx(orig[k], decoded[k])) throw new Error(`mismatch ${k}: ${orig[k]} vs ${decoded[k]}`);
  }
  if (orig.weapon !== decoded.weapon || orig.fire !== decoded.fire) throw new Error('weapon/fire mismatch');
  if (orig.place !== decoded.place || orig.objective !== decoded.objective) throw new Error('string mismatch');
  for (const bk of ['x', 'z', 'vx', 'vz', 'heading', 'speed', 'lean', 'hp', 'fuel']) {
    if (!approx(orig.bike[bk], decoded.bike[bk])) throw new Error(`bike.${bk} mismatch`);
  }
  if (orig.bike.drifting !== decoded.bike.drifting) throw new Error('bike.drifting mismatch');
  if (orig.zombies.length !== decoded.zombies.length) throw new Error('zombie count');
  for (let i = 0; i < orig.zombies.length; i++) {
    if (!approx(orig.zombies[i].x, decoded.zombies[i].x)) throw new Error(`z${i}.x`);
    if (!approx(orig.zombies[i].z, decoded.zombies[i].z)) throw new Error(`z${i}.z`);
    if (orig.zombies[i].kind !== decoded.zombies[i].kind) throw new Error(`z${i}.kind`);
  }
}

function makeSnap(i) {
  return {
    t: 'host',
    at: 1000 + i,
    bike: {
      x: -12 + i * 0.01,
      z: 4.5,
      vx: 0.2,
      vz: -1.1,
      heading: 1.57,
      speed: 8.3,
      lean: 0.12,
      drifting: i % 2 === 0,
      hp: 88,
      fuel: 42,
    },
    aim: 2.1,
    weapon: i % 3,
    fire: i % 5 === 0,
    lat: 43.5,
    lon: -116.8,
    cx: 2,
    cz: -1,
    scrap: 10,
    kills: i,
    horde: 5,
    place: `Chunk ${i}`,
    objective: `Reach waypoint ${i}`,
    zombies: [{ x: 1, z: 2, kind: 'walker' }, { x: -3, z: 0, kind: 'runner' }],
    projectiles: [{ x: 0.5, z: 0.5, kind: 1 }],
    flashes: [{ x: 2, z: 2, life: 0.4 }],
  };
}

let ok = 0;
for (let i = 0; i < 100; i++) {
  const snap = makeSnap(i);
  const buf = encodeHostBinary(snap);
  const decoded = decodeHostBinary(buf);
  assertSnap(snap, decoded);
  ok++;
}

console.log(`coop-binary-test: ${ok}/100 round-trips OK`);
process.exit(0);