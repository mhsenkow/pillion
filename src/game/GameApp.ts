import * as THREE from 'three';
import {
  GRID_W,
  GRID_L,
  HALF_W,
  HALF_L,
  TILE,
  FIELD_TOW_DURATION,
  TOW_IFRAMES,
} from '../core/constants';
import type {
  GameState,
  LootCrate,
  LootKind,
  Particle,
  Projectile,
  ZombieEntity,
  ZombieKind,
} from '../core/types';
import { ARTWORK_COUPLE } from '../art/palettes';
import { rebuildBikeRig, type BikeRig } from '../art/bikeBuilder';
import { buildZombie } from '../art/zombieBuilder';
import { clearRun, loadActiveCouple, loadRun, saveActiveCouple, saveRun } from '../core/storage';
import { mulberry32, hashCoords } from '../core/rng';
import {
  generateChunkData,
  buildInstancedVoxels,
  updateMapUnderlay,
  worldToGrid,
  gridToWorld,
  idx,
} from '../geo/voxelHelpers';
import {
  fetchOsmChunk,
  parseLatLonQuery,
  reverseNominatim,
  searchNominatim,
  writeLatLonQuery,
} from '../geo/osmFetcher';
import { emmettOsmFallback, isNearEmmett } from '../geo/emmettOsmFallback';
import { bboxKey, chunkBBoxFromOrigin, scaleReadout, type GeoBBox } from '../geo/projection';
import { computeDijkstraFlowField, rebuildFlowDebugOverlay } from '../simulation/flowField';
import { updateBikePhysics, freeBikeFromBuilding } from '../simulation/bikePhysics';
import { fireWeapon, updateAim, updateProjectiles } from '../simulation/combatSystem';
import { SteppedAnimator } from '../simulation/steppedAnimator';
import {
  createRenderer,
  updateCamera,
  TIME_PRESETS,
  applyTimePreset,
  fitRenderer,
  type RendererBundle,
} from '../render/DioramaRenderer';
import { HudController } from '../ui/HudController';
import { CoupleBikeCreatorModal } from '../ui/CoupleBikeCreatorModal';
import { DevModelInspector } from '../ui/DevModelInspector';
import { gameAudio } from '../audio/GameAudio';
import { createLootMesh, LOOT_CRATE_GEO } from '../simulation/lootHelpers';
import { StructureField } from '../simulation/structureDamage';
import { DebrisField } from '../simulation/debris';
import { SmokeField } from '../simulation/smoke';
import { CoopClient } from '../net/coopClient';
import {
  coopShareUrl,
  isTvMode,
  parseCoopQuery,
  writeCoopQuery,
  type CoopGunInput,
  type CoopHostSnap,
  type CoopRole,
  type CoopZombieSnap,
} from '../net/coopProtocol';
import { installRideInput } from './bindRideInput';
import { ChunkMeshCache, type ChunkSnap } from './chunkCache';
import { TvLobby } from '../ui/TvLobby';
import { installTvMode, setCinemaMode, setPhotoMode } from './tvMode';
import { sampleGamepad, rumbleGamepad } from './gamepadDriver';
import { assistAim } from './aimAssist';
import { RoadTrip } from '../trip/RoadTrip';
import { fetchWeather } from '../trip/weather';
import { getDayPhase } from '../trip/dayNight';
import { flags } from '../core/flags';
import { groundTrails } from '../render/trails';
import { applyPostFxToBundle, loadPostFxFlags } from '../render/postFx';
import { hordeCountFromBuildings, generateTownBeats, coopDoubleKillBonus, bossSpawnPlan } from './townBeats';
import { defaultUpgradeLevels } from './upgrades';
import type { TownBeat } from './townBeats';
import { detectLandmarksInOsmData } from '../geo/landmarks';
import { fetchElevation } from '../geo/elevation';

// Re-export helper shim used below
function ensureFreeBike(state: GameState): void {
  freeBikeFromBuilding(state.bike, state.surfaceGrid);
}

export class GameApp {
  private bundle: RendererBundle;
  private state: GameState;
  private bikeRig: BikeRig | null = null;
  private zombies: ZombieEntity[] = [];
  private projectiles: Projectile[] = [];
  private loot: LootCrate[] = [];
  private particles: Particle[] = [];
  private hud!: HudController;
  private creator!: CoupleBikeCreatorModal;
  private inspector!: DevModelInspector;
  private stepped = new SteppedAnimator();
  private sharedPartGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  private burstMats = new Map<number, THREE.MeshStandardMaterial>();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouseNDC = new THREE.Vector2();
  private canvasEl: HTMLElement;
  private shake = 0;
  private towTimer = 0;
  private towIFrames = 0;
  private towOverlay: HTMLElement | null = null;
  private lastRunSave = 0;
  private lastMilestoneKills = 0;
  private hitStop = 0;
  private baseFov = 20;
  private waveTimer = 0;
  private lastHurtSfx = 0;
  private lastHp = 100;
  private chunkKills = 0;
  private blockClear = false;
  private shownKills = -1;
  private killStreak = 0;
  private lastKillAt = 0;
  private pendingRoadSnap = true;
  private showAlign = false;
  private prefetchGen = 0;
  private hordeGen = 0;
  private chunkCache = new ChunkMeshCache();
  private structures = new StructureField();
  private activeChunkKey = '';
  private lastFlowCell = '';
  private goal: { gx: number; gz: number; wx: number; wz: number; label: string } | null = null;
  private coop: CoopClient | null = null;
  private coopRole: CoopRole | null = null;
  private coopPeerOnline = false;
  private lastCoopSend = 0;
  private remoteGun: CoopGunInput | null = null;
  private remoteGunAt = 0;
  private remoteZombies: CoopZombieSnap[] = [];
  private lastHostDropKey = '';
  private lobby: TvLobby | null = null;
  private cinema = false;
  private photoMode = false;
  private photoOrbit = 0;
  private trip = new RoadTrip();
  private debris = new DebrisField();
  private smoke = new SmokeField();
  private laserLine: THREE.Line | null = null;
  private gunnerName = 'Gunner';
  private gunnerColor = '#38bdf8';
  private frameMsEma = 16;
  private lastFrameAt = 0;
  private weatherTimer = 0;
  private townBeats: TownBeat[] = [];
  private upgrades = defaultUpgradeLevels();
  private impactFlashes: { x: number; z: number; life: number }[] = [];
  private perfHud: HTMLElement | null = null;

  constructor(appRoot: HTMLElement) {
    this.canvasEl = document.createElement('div');
    this.canvasEl.id = 'canvas-container';
    appRoot.appendChild(this.canvasEl);
    this.bundle = createRenderer(this.canvasEl);

    const saved = loadActiveCouple();
    const couple = saved ?? ARTWORK_COUPLE;
    const run = loadRun();
    const urlDrop = parseLatLonQuery();

    this.state = {
      baseLat: urlDrop?.lat ?? run?.baseLat ?? 42.9906,
      baseLon: urlDrop?.lon ?? run?.baseLon ?? -82.7649,
      locationName: urlDrop
        ? `${urlDrop.lat.toFixed(4)}, ${urlDrop.lon.toFixed(4)}`
        : (run?.locationName ?? 'Downtown Emmett, MI — M-19 & Brandon Rd'),
      biomeHint: urlDrop
        ? isNearEmmett(urlDrop.lat, urlDrop.lon)
          ? 'EMMETT'
          : 'URBAN'
        : (run?.biomeHint ?? 'EMMETT'),
      chunkX: 0,
      chunkZ: 0,
      blocksTraversed: run?.blocksTraversed ?? 1,
      kills: run?.kills ?? 0,
      scrap: run?.scrap ?? 25,
      repairDiscount: run?.repairDiscount ?? 0,
      unlockedTeslaBoost: run?.unlockedTeslaBoost ?? false,
      fuelSiphon: run?.fuelSiphon ?? false,
      flareOverchargeUntil: 0,
      reduceMotion:
        typeof window !== 'undefined' &&
        !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      objective: 'CLEAR ASHEN THREATS · LOOT THE BLOCK',
      showMapLayer: true,
      showFlowDebug: false,
      steerMode: 'SCREEN',
      invertAD: false,
      cameraPitchDeg: 40,
      cameraYawOffset: 0,
      cameraZoom: 46,
      timeOfDayIndex: 0,
      surfaceGrid: new Uint8Array(GRID_W * GRID_L),
      heightGrid: new Uint8Array(GRID_W * GRID_L),
      flowDistance: new Float32Array(GRID_W * GRID_L),
      flowDirX: new Float32Array(GRID_W * GRID_L),
      flowDirZ: new Float32Array(GRID_W * GRID_L),
      bike: {
        x: 0.5,
        y: 0.2,
        z: 6.5,
        vx: 0,
        vz: 0,
        speed: 0,
        heading: 0,
        steerAngle: 0,
        leanAngle: 0,
        drifting: false,
        driftCharge: 0,
        hp: 100,
        fuel: 100,
      },
      partner: {
        aimAngle: Math.PI,
        weaponIndex: 0,
        lastFireTime: 0,
        autoAim: true,
        autoFire: true,
        driverFiring: false,
      },
      transition: { active: false, progress: 1, offsetX: 0, offsetZ: 0 },
      keys: { up: false, down: false, left: false, right: false, space: false },
      mouseDown: false,
      rightMouseDown: false,
      lastMouseX: 0,
      mouseWorldPos: new THREE.Vector3(),
      activePins: [],
      osmCache: new Map(),
      activeOsm: null,
      couple,
      paused: false,
      studioMode: 'none',
    };

    this.setupUi(appRoot);
    this.rebuildBike();
    if (isNearEmmett(this.state.baseLat, this.state.baseLon)) {
      this.state.activeOsm = emmettOsmFallback();
      this.generateChunk(this.state.activeOsm);
    } else {
      this.generateChunk(null);
    }
    writeLatLonQuery(this.state.baseLat, this.state.baseLon);
    this.hud.setLatLonInputs(this.state.baseLat, this.state.baseLon);
    this.hud.setScale(scaleReadout());
    void this.syncOsm();
    this.bindInput();
    this.startLoop();
    this.hud.setAutoFireLabel(this.state.partner.autoFire);
    this.lobby = new TvLobby(appRoot);
    this.trip = RoadTrip.loadFromStorage();
    this.trip.setBikePosition(this.state.baseLat, this.state.baseLon);
    applyPostFxToBundle(this.bundle, loadPostFxFlags());
    if (installTvMode()) {
      this.hud.enableTvHud();
    }
    this.ensureLaser();
    if (import.meta.env.DEV) {
      this.perfHud = document.createElement('div');
      this.perfHud.className = 'mono';
      this.perfHud.style.cssText =
        'position:fixed;bottom:8px;left:8px;z-index:50;font-size:10px;color:#86efac;background:rgba(0,0,0,0.55);padding:4px 8px;border-radius:6px';
      appRoot.appendChild(this.perfHud);
    }
    const coopCode = parseCoopQuery();
    const tvSeat = isTvMode() || new URLSearchParams(location.search).has('tv');
    if (coopCode && tvSeat) {
      void this.joinCoop(coopCode, 'driver');
      void this.lobby?.show(coopCode);
    } else if (urlDrop) {
      void reverseNominatim(urlDrop.lat, urlDrop.lon).then((name) => {
        this.state.locationName = name;
        this.hud.showToast(`DROPPED INTO ${name.toUpperCase()}`);
      });
    } else if (!run) {
      window.setTimeout(() => {
        this.hud.showToast('TIP: CAST THIS TO THE TV · SHARE RIDE SENDS MOM A PHONE GUN');
      }, 1800);
    }
  }

  private ensureLaser(): void {
    if (this.laserLine) return;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.6, 0),
      new THREE.Vector3(0, 0.6, -18),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
    this.laserLine = new THREE.Line(geo, mat);
    this.bundle.entitiesGroup.add(this.laserLine);
  }

  private setupUi(appRoot: HTMLElement): void {
    this.hud = new HudController(appRoot, {
      onPresetChange: (lat, lon, name, biome) => this.dropAt(lat, lon, name, biome),
      onSearchPlace: (q) => void this.searchPlace(q),
      onGpsDrop: (lat, lon) => void this.dropGps(lat, lon),
      onGeolocate: () => void this.geolocate(),
      onAlignToggle: () => {
        this.showAlign = !this.showAlign;
        this.hud.setAlign(this.showAlign);
      },
      onResyncOsm: () => {
        this.state.osmCache.clear();
        void this.syncOsm();
      },
      onSteerMode: () => {
        this.state.steerMode = this.state.steerMode === 'SCREEN' ? 'BIKE' : 'SCREEN';
        this.hud.setSteerLabel(
          this.state.steerMode === 'SCREEN' ? 'SCREEN-SPACE WASD' : 'BIKE-RELATIVE',
        );
      },
      onInvertSteer: (v) => (this.state.invertAD = v),
      onWeapon: (i) => {
        this.state.partner.weaponIndex = i;
        this.hud.setWeapon(i);
        gameAudio.switchWeapon();
      },
      onAimMode: () => {
        this.state.partner.autoAim = !this.state.partner.autoAim;
        this.hud.setAimLabel(this.state.partner.autoAim);
      },
      onAutoFire: () => {
        this.state.partner.autoFire = !this.state.partner.autoFire;
        this.hud.setAutoFireLabel(this.state.partner.autoFire);
        this.hud.showToast(this.state.partner.autoFire ? 'AUTO FIRE ON' : 'AUTO FIRE OFF · HOLD CLICK');
      },
      onShareRide: () => void this.shareRide(),
      onCinema: () => {
        this.cinema = !this.cinema;
        setCinemaMode(this.cinema);
        this.hud.showToast(this.cinema ? 'CINEMA ON' : 'CINEMA OFF');
      },
      onPhotoMode: () => {
        this.photoMode = !this.photoMode;
        setPhotoMode(this.photoMode);
        this.state.paused = this.photoMode;
        this.hud.showToast(this.photoMode ? 'PHOTO MODE · ORBIT' : 'PHOTO OFF');
      },
      onSetDestination: (q) => void this.setRoadTrip(q),
      onDof: (v) => document.documentElement.style.setProperty('--tilt-blur', `${v}px`),
      onPitch: (v) => (this.state.cameraPitchDeg = v),
      onFlowDebug: () => {
        this.state.showFlowDebug = !this.state.showFlowDebug;
        this.hud.setFlow(this.state.showFlowDebug);
        rebuildFlowDebugOverlay(
          this.bundle.debugFlowGroup,
          this.state.showFlowDebug,
          this.state.flowDistance,
          this.state.flowDirX,
          this.state.flowDirZ,
        );
      },
      onMapLayer: () => {
        this.state.showMapLayer = !this.state.showMapLayer;
        this.bundle.liveMapPlaneMesh.visible = this.state.showMapLayer;
        this.hud.setMap(this.state.showMapLayer);
      },
      onTime: () => {
        this.state.timeOfDayIndex = (this.state.timeOfDayIndex + 1) % TIME_PRESETS.length;
        const p = TIME_PRESETS[this.state.timeOfDayIndex];
        this.hud.setTimeLabel(p.label);
        applyTimePreset(this.bundle, p, this.bikeRig?.headlight);
      },
      onRepair: () => this.repair(),
      onOvercharge: () => this.buyOvercharge(),
      onOpenCreator: () => this.openCreator(),
      onOpenInspector: () => this.openInspector(),
      onToast: () => gameAudio.toast(),
      onReduceMotion: (v) => this.setReduceMotion(v),
      onMute: () => {
        const muted = gameAudio.toggleMute();
        this.hud.setMuteLabel(muted);
        this.hud.showToast(muted ? 'AUDIO MUTED' : 'AUDIO ON');
      },
    });
    this.ensureTowOverlay(appRoot);
    this.baseFov = this.bundle.camera.fov;
    this.hud.setReduceMotionChecked(this.state.reduceMotion);
    this.applyReduceMotionChrome();
    this.hud.setObjective(this.state.objective);
    applyTimePreset(this.bundle, TIME_PRESETS[this.state.timeOfDayIndex], undefined);

    this.creator = new CoupleBikeCreatorModal(appRoot, this.state.couple, {
      onChange: (c) => {
        this.state.couple = c;
        this.rebuildBike();
      },
      onClose: () => {
        this.state.studioMode = 'none';
        this.state.paused = false;
      },
    });

    this.inspector = new DevModelInspector(appRoot, this.bundle.studioGroup, this.state.couple, {
      onCoupleChange: (c) => {
        this.state.couple = c;
        saveActiveCouple(c);
        this.rebuildBike();
      },
      onClose: () => {
        this.state.studioMode = 'none';
        this.state.paused = false;
        this.bundle.dioramaRoot.visible = true;
        this.bundle.tabletopGroup.visible = true;
      },
      onPlayingChange: (playing) => {
        if (this.state.studioMode === 'inspector') this.state.paused = !playing;
      },
    });
    this.inspector.bindOrbit(this.bundle.renderer.domElement);
  }

  private ensureTowOverlay(appRoot: HTMLElement): void {
    this.towOverlay = document.createElement('div');
    this.towOverlay.id = 'field-tow-overlay';
    this.towOverlay.style.cssText =
      'position:fixed;inset:0;z-index:40;pointer-events:none;opacity:0;transition:opacity 0.25s ease;background:radial-gradient(circle at 50% 40%,rgba(15,23,42,0.15),rgba(2,6,23,0.82));display:flex;align-items:center;justify-content:center';
    this.towOverlay.innerHTML =
      '<div class="mono" style="padding:14px 22px;border-radius:999px;border:1px solid rgba(251,191,36,0.45);background:rgba(2,6,23,0.85);color:#fde68a;letter-spacing:0.08em;font-weight:700;font-size:12px">FIELD TOW IN PROGRESS…</div>';
    appRoot.appendChild(this.towOverlay);
  }

  private persistRun(force = false): void {
    const now = performance.now() / 1000;
    if (!force && now - this.lastRunSave < 2.5) return;
    this.lastRunSave = now;
    saveRun({
      scrap: this.state.scrap,
      kills: this.state.kills,
      blocksTraversed: this.state.blocksTraversed,
      baseLat: this.state.baseLat,
      baseLon: this.state.baseLon,
      locationName: this.state.locationName,
      biomeHint: this.state.biomeHint,
      repairDiscount: this.state.repairDiscount,
      unlockedTeslaBoost: this.state.unlockedTeslaBoost,
      fuelSiphon: this.state.fuelSiphon,
    });
  }

  private checkProgression(): void {
    if (this.state.kills >= 25 && this.state.repairDiscount < 5) {
      this.state.repairDiscount = 5;
      this.hud.showToast('MILESTONE — FIELD REPAIR DISCOUNT UNLOCKED');
    }
    if (this.state.kills >= 50 && !this.state.unlockedTeslaBoost) {
      this.state.unlockedTeslaBoost = true;
      this.hud.showToast('MILESTONE — TESLA SMG OVERCHARGE');
    }
    if (this.state.kills >= 75 && !this.state.fuelSiphon) {
      this.state.fuelSiphon = true;
      this.hud.showToast('MILESTONE — FUEL SIPHON (CHEAPER BURN)');
      this.hud.pushKillFeed('SIPHON ONLINE');
    }
    if (this.state.kills >= 100 && this.state.repairDiscount < 8) {
      this.state.repairDiscount = 8;
      this.state.scrap += 40;
      this.hud.showToast('MILESTONE 100 — VETERAN PATCH +40 SCRAP');
      this.hud.pushKillFeed('VETERAN RANK');
    }
    if (this.state.kills - this.lastMilestoneKills >= 10) {
      this.lastMilestoneKills = this.state.kills;
      this.persistRun(true);
    }
  }

  private openCreator(): void {
    this.state.studioMode = 'creator';
    this.state.paused = true;
    this.creator.open(this.state.couple);
  }

  private openInspector(): void {
    this.state.studioMode = 'inspector';
    this.state.paused = true;
    this.bundle.dioramaRoot.visible = false;
    this.bundle.tabletopGroup.visible = false;
    this.inspector.open(this.state.couple);
  }

  private rebuildBike(): void {
    const pos = this.bikeRig?.root.position.clone();
    const rotY = this.bikeRig?.root.rotation.y ?? this.state.bike.heading;
    this.bikeRig = rebuildBikeRig(
      this.bikeRig,
      this.bundle.dioramaRoot,
      this.state.couple.bike,
      this.state.couple.rider1,
      this.state.couple.rider2,
    );
    if (pos) this.bikeRig.root.position.copy(pos);
    this.bikeRig.root.rotation.y = rotY;
  }

  private getChunkBBox(): GeoBBox {
    return chunkBBoxFromOrigin(
      this.state.baseLat,
      this.state.baseLon,
      this.state.chunkX,
      this.state.chunkZ,
    );
  }

  private osmKey(chunkX: number, chunkZ: number, bbox: GeoBBox): string {
    return `${chunkX}_${chunkZ}_${bboxKey(bbox)}`;
  }

  private generateChunk(liveOsm: import('../core/types').OsmData | null): void {
    const bbox = this.getChunkBBox();
    const { curLat, curLon } = bbox;
    this.state.activeOsm = liveOsm;
    const snap = this.ensureChunkMesh(liveOsm, bbox, curLat, curLon);
    this.state.activePins = snap.pins;
    updateMapUnderlay(this.bundle.liveMapPlaneMesh, curLat, curLon, bbox);
    if (this.pendingRoadSnap) this.snapBikeToNearestRoad();
    else ensureFreeBike(this.state);
    this.rebuildGisLabels();
    this.hud.markRadarDirty();
    this.hud.setScale(scaleReadout());

    const latDir = curLat >= 0 ? 'N' : 'S';
    const lonDir = curLon >= 0 ? 'E' : 'W';
    this.hud.setBanner(
      snap.banner,
      `80×160 [${this.state.chunkX},${this.state.chunkZ}]`,
      snap.poiLabel,
      snap.sourceTag,
      `${Math.abs(curLat).toFixed(4)}°${latDir}, ${Math.abs(curLon).toFixed(4)}°${lonDir}`,
      this.state.biomeHint,
    );

    const seed = hashCoords(this.state.baseLat, this.state.baseLon, this.state.chunkX, this.state.chunkZ);
    this.chunkKills = 0;
    this.blockClear = false;
    this.shownKills = -1;
    this.waveTimer = 0;
    this.spawnHorde(mulberry32(seed));
    this.ensureLaser();
    if (liveOsm) {
      this.townBeats = generateTownBeats(
        liveOsm,
        this.state.baseLat,
        this.state.baseLon,
        this.state.chunkX,
        this.state.chunkZ,
      );
      const beat = this.townBeats[0];
      if (beat) {
        this.hud.setSubtitle(beat.label);
        this.state.objective = beat.label;
      }
      const card = this.trip.buildTownArrivalCard({
        name: this.state.locationName.split(',')[0],
        display_name: this.state.locationName,
      });
      this.hud.showTownCard(card.headline, card.subline);
      this.trip.buildPostcard(this.state.kills, card.placeName, 'PILLION');
      this.trip.save();
      const marks = detectLandmarksInOsmData(liveOsm);
      if (marks[0]) this.hud.setSubtitle(`LANDMARK · ${marks[0].kind.replace('_', ' ').toUpperCase()}`);
      const boss = bossSpawnPlan(liveOsm.buildings.length, this.state.locationName, this.state.biomeHint);
      if (boss.spawn) {
        this.hud.pushKillFeed(`BOSS SIGNAL · ${boss.label || boss.kind.toUpperCase()}`);
      }
      void fetchElevation(this.state.baseLat, this.state.baseLon).then((el) => {
        if (el != null) this.hud.setScale(`${scaleReadout()} · ${Math.round(el)}m elev`);
      });
    }
    this.refreshObjective();
    this.recomputeFlow();
    this.structures.bind(snap.group, this.state.surfaceGrid, snap.stamp);
    window.setTimeout(() => this.prebuildAhead(), 500);
  }

  private chunkStamp(cx: number, cz: number, osm: import('../core/types').OsmData | null, bbox: GeoBBox): string {
    const stamp = osm ? `${osm.buildings.length}b${osm.roads.length}r${osm.pois?.length ?? 0}p` : 'empty';
    return `${cx}_${cz}_${bboxKey(bbox)}_${stamp}`;
  }

  private ensureChunkMesh(
    liveOsm: import('../core/types').OsmData | null,
    bbox: GeoBBox,
    curLat: number,
    curLon: number,
  ): ChunkSnap {
    const stamp = this.chunkStamp(this.state.chunkX, this.state.chunkZ, liveOsm, bbox);
    if (this.activeChunkKey && this.activeChunkKey !== stamp) {
      this.chunkCache.rememberGrids(this.activeChunkKey, this.state.surfaceGrid, this.state.heightGrid);
      const prev = this.chunkCache.get(this.activeChunkKey);
      if (prev) this.bundle.chunkVoxelGroup.remove(prev.group);
    }
    let snap = this.chunkCache.get(stamp);
    if (!snap) {
      const result = generateChunkData({
        baseLat: this.state.baseLat,
        baseLon: this.state.baseLon,
        chunkX: this.state.chunkX,
        chunkZ: this.state.chunkZ,
        curLat,
        curLon,
        showMapLayer: this.state.showMapLayer,
        biomeHint: this.state.biomeHint,
        surfaceGrid: this.state.surfaceGrid,
        heightGrid: this.state.heightGrid,
        osm: liveOsm,
        bbox,
      });
      const group = new THREE.Group();
      group.name = stamp;
      buildInstancedVoxels(result.solid, result.glass, group);
      result.props.forEach((p) => group.add(p));
      snap = {
        stamp,
        group,
        surface: new Uint8Array(this.state.surfaceGrid),
        height: new Uint8Array(this.state.heightGrid),
        pins: result.pins.map((pin) => ({ ...pin, el: undefined })),
        banner: result.banner,
        poiLabel: result.poiLabel,
        sourceTag: result.sourceTag,
        osm: liveOsm,
      };
      this.chunkCache.hold(snap);
    } else if (this.activeChunkKey !== stamp) {
      this.state.surfaceGrid.set(snap.surface);
      this.state.heightGrid.set(snap.height);
      if (snap.osm) this.state.activeOsm = snap.osm;
    }
    if (snap.group.parent !== this.bundle.chunkVoxelGroup) this.bundle.chunkVoxelGroup.add(snap.group);
    this.activeChunkKey = stamp;
    this.chunkCache.evict(stamp);
    return snap;
  }

  private prebuildChunk(cx: number, cz: number, osm: import('../core/types').OsmData | null): void {
    const bbox = chunkBBoxFromOrigin(this.state.baseLat, this.state.baseLon, cx, cz);
    const stamp = this.chunkStamp(cx, cz, osm, bbox);
    if (this.chunkCache.get(stamp)) return;
    const surface = new Uint8Array(GRID_W * GRID_L);
    const height = new Uint8Array(GRID_W * GRID_L);
    const result = generateChunkData({
      baseLat: this.state.baseLat,
      baseLon: this.state.baseLon,
      chunkX: cx,
      chunkZ: cz,
      curLat: bbox.curLat,
      curLon: bbox.curLon,
      showMapLayer: this.state.showMapLayer,
      biomeHint: this.state.biomeHint,
      surfaceGrid: surface,
      heightGrid: height,
      osm,
      bbox,
    });
    const group = new THREE.Group();
    group.name = stamp;
    buildInstancedVoxels(result.solid, result.glass, group);
    result.props.forEach((p) => group.add(p));
    this.chunkCache.hold({
      stamp,
      group,
      surface,
      height,
      pins: result.pins.map((pin) => ({ ...pin, el: undefined })),
      banner: result.banner,
      poiLabel: result.poiLabel,
      sourceTag: result.sourceTag,
      osm,
    });
    this.chunkCache.evict(this.activeChunkKey || stamp);
  }

  private osmForChunk(cx: number, cz: number): import('../core/types').OsmData | null {
    const bbox = chunkBBoxFromOrigin(this.state.baseLat, this.state.baseLon, cx, cz);
    return this.state.osmCache.get(this.osmKey(cx, cz, bbox)) ?? null;
  }

  private showingOsm(osm: import('../core/types').OsmData | null): boolean {
    const bbox = this.getChunkBBox();
    return this.activeChunkKey === this.chunkStamp(this.state.chunkX, this.state.chunkZ, osm, bbox);
  }

  private prebuildAhead(): void {
    const { vx, vz } = this.state.bike;
    const dx = Math.abs(vx) > Math.abs(vz) + 0.4 ? Math.sign(vx) : 0;
    const dz = Math.abs(vz) > Math.abs(vx) + 0.4 ? Math.sign(vz) : 0;
    if (!dx && !dz) return;
    const cx = this.state.chunkX + dx;
    const cz = this.state.chunkZ + dz;
    const osm = this.osmForChunk(cx, cz);
    if (!osm) return;
    this.prebuildChunk(cx, cz, osm);
  }

  private refreshObjective(): void {
    const osm = this.state.activeOsm;
    const bike = this.state.bike;
    const poiDist = (gx: number, gz: number) => {
      const w = gridToWorld(gx, gz);
      return Math.hypot(w.wx - bike.x, w.wz - bike.z);
    };
    const nearest = <T extends { gx: number; gz: number }>(rows: T[]) =>
      rows.slice().sort((a, b) => poiDist(a.gx, a.gz) - poiDist(b.gx, b.gz))[0];
    const fuel = nearest((osm?.pois ?? []).filter((p) => p.kind === 'fuel' && p.name));
    const shop = nearest((osm?.pois ?? []).filter((p) => (p.kind === 'shop' || p.kind === 'cafe') && p.name));
    const named = this.state.activePins
      .filter((p) => p.type === 'building')
      .slice()
      .sort((a, b) => Math.hypot(a.wx - bike.x, a.wz - bike.z) - Math.hypot(b.wx - bike.x, b.wz - bike.z))[0];
    const poi = fuel ?? shop;
    if (poi) {
      const { wx, wz } = gridToWorld(poi.gx, poi.gz);
      this.goal = { gx: poi.gx, gz: poi.gz, wx, wz, label: poi.name };
      this.hud.setGoal(poi.gx, poi.gz);
      this.state.objective = `REACH ${poi.name.toUpperCase()} · OR CLEAR ${this.chunkKills}/12`;
    } else if (named) {
      const g = worldToGrid(named.wx, named.wz);
      this.goal = { gx: g.gx, gz: g.gz, wx: named.wx, wz: named.wz, label: named.label };
      this.hud.setGoal(g.gx, g.gz);
      this.state.objective = `REACH ${named.label.toUpperCase()} · OR CLEAR ${this.chunkKills}/12`;
    } else {
      this.goal = null;
      this.hud.setGoal(null, null);
      this.state.objective = `CLEAR THE BLOCK · ${this.chunkKills}/12`;
    }
    this.hud.setObjective(this.state.objective);
  }

  private rebuildGisLabels(): void {
    const container = this.hud.$('#gis-labels-container');
    if (!container) return;
    container.innerHTML = '';
    const pins = this.state.activePins.filter((pin) => pin.type !== 'addr').concat(
      this.state.activePins.filter((pin) => pin.type === 'addr').slice(0, 36),
    );
    const bike = this.state.bike;
    const ranked = pins
      .map((pin) => ({ pin, dist: Math.hypot(pin.wx - bike.x, pin.wz - bike.z) }))
      .sort((a, b) => a.dist - b.dist);
    const road = ranked.find((row) => row.pin.type === 'road');
    const shown = ranked.filter((row) => {
      if (row.pin.type === 'addr') return false;
      if (row.pin.type === 'road') return road?.pin === row.pin;
      return row.dist < 7;
    });
    shown.forEach((row, i) => {
      const el = document.createElement('div');
      el.id = `gis-pin-${i}`;
      el.className = `mono gis-pin gis-pin-${row.pin.type}`;
      el.textContent = row.pin.label;
      container.appendChild(el);
      row.pin.el = el;
    });
  }

  private updateGisLabels(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tempV = new THREE.Vector3();
    const bx = this.state.bike.x;
    const bz = this.state.bike.z;
    this.state.activePins.forEach((pin) => {
      if (!pin.el) return;
      tempV.set(pin.wx, pin.wy, pin.wz);
      tempV.project(this.bundle.camera);
      if (tempV.z > 1) {
        pin.el.style.opacity = '0';
        return;
      }
      pin.el.style.left = `${(tempV.x * 0.5 + 0.5) * w}px`;
      pin.el.style.top = `${(-tempV.y * 0.5 + 0.5) * h}px`;
      pin.el.style.transform = 'translate(-50%, -100%)';
      if (!this.state.showMapLayer) {
        pin.el.style.opacity = '0';
        return;
      }
      const dist = Math.hypot(pin.wx - bx, pin.wz - bz);
      pin.el.style.opacity = pin.type === 'road' ? '0.92' : dist < 7 ? '0.9' : '0';
    });
    this.hud.updateAlignOverlay(this.bundle.camera, this.state.activeOsm, this.showAlign);
  }

  private snapBikeToNearestRoad(): void {
    const start = worldToGrid(this.state.bike.x, this.state.bike.z);
    let bestGx = start.gx;
    let bestGz = start.gz;
    let bestD = Infinity;
    for (let gz = 1; gz < GRID_L - 1; gz++) {
      for (let gx = 1; gx < GRID_W - 1; gx++) {
        const t = this.state.surfaceGrid[idx(gx, gz)];
        if (t !== TILE.ROAD && t !== TILE.BRIDGE) continue;
        const d = (gx - start.gx) ** 2 + (gz - start.gz) ** 2;
        if (d < bestD) {
          bestD = d;
          bestGx = gx;
          bestGz = gz;
        }
      }
    }
    if (bestD < Infinity) {
      const { wx, wz } = gridToWorld(bestGx, bestGz);
      this.state.bike.x = wx;
      this.state.bike.z = wz;
    }
    ensureFreeBike(this.state);
  }

  private applyOsmBadge(data: import('../core/types').OsmData): void {
    const label =
      data.buildings.length === 0
        ? `OSM ROADS ${data.roads.length}R`
        : `OSM ${data.buildings.length}B/${data.roads.length}R`;
    this.hud.setOsmBadge(label, data.buildings.length === 0 ? 'fallback' : 'ok');
  }

  private async syncOsm(): Promise<void> {
    const bbox = this.getChunkBBox();
    const { curLat, curLon } = bbox;
    const cx = this.state.chunkX;
    const cz = this.state.chunkZ;
    const key = this.osmKey(cx, cz, bbox);
    const stillHere = () => this.state.chunkX === cx && this.state.chunkZ === cz;
    if (this.state.osmCache.has(key)) {
      const cached = this.state.osmCache.get(key)!;
      this.applyOsmBadge(cached);
      if (!this.showingOsm(cached)) this.generateChunk(cached);
      this.pendingRoadSnap = false;
      this.prefetchNeighbors();
      return;
    }
    this.hud.setOsmBadge('OSM SYNCING...', 'sync');
    this.prefetchNeighbors();
    const data = await fetchOsmChunk(curLat, curLon, bbox);
    if (data) this.state.osmCache.set(key, data);
    if (!stillHere()) return;
    if (data) {
      this.applyOsmBadge(data);
      if (!this.showingOsm(data)) this.generateChunk(data);
      this.hud.showToast(
        data.buildings.length > 0
          ? `LIVE MAP ${data.buildings.length} BLDGS · ${data.roads.length} ROADS`
          : `LIVE MAP ${data.roads.length} ROADS`,
      );
    } else if (isNearEmmett(curLat, curLon) && cx === 0 && cz === 0) {
      const fallback = emmettOsmFallback();
      this.hud.setOsmBadge('EMMETT CADASTRAL', 'fallback');
      if (!this.showingOsm(fallback)) this.generateChunk(fallback);
      this.hud.showToast('OVERPASS OFFLINE — Emmett verified cadastral');
    } else if (!this.showingOsm(null)) {
      this.hud.setOsmBadge('GIS OFFLINE', 'fallback');
      this.generateChunk(null);
      this.hud.showToast('MAP DELAYED — this block stays open ground until OSM answers');
    }
    this.pendingRoadSnap = false;
  }

  /** Next blocks, travel direction first, so the road ahead is real before you reach it. */
  private prefetchNeighbors(): void {
    const gen = ++this.prefetchGen;
    const origin = { lat: this.state.baseLat, lon: this.state.baseLon, cx: this.state.chunkX, cz: this.state.chunkZ };
    const dirs = this.streamDirs();
    dirs.forEach(([dx, dz], i) => {
      const cx = origin.cx + dx;
      const cz = origin.cz + dz;
      const bbox = chunkBBoxFromOrigin(origin.lat, origin.lon, cx, cz);
      const key = this.osmKey(cx, cz, bbox);
      const keepMesh = i === 0;
      const arm = (data: import('../core/types').OsmData) => {
        this.state.osmCache.set(key, data);
        if (!keepMesh || gen !== this.prefetchGen) return;
        window.setTimeout(() => {
          if (gen !== this.prefetchGen) return;
          this.prebuildChunk(cx, cz, data);
        }, 0);
      };
      const cached = this.state.osmCache.get(key);
      if (cached) {
        arm(cached);
        return;
      }
      window.setTimeout(() => {
        if (gen !== this.prefetchGen) return;
        void fetchOsmChunk(bbox.curLat, bbox.curLon, bbox).then((data) => {
          if (data) arm(data);
        });
      }, i * 700);
    });
  }

  private streamDirs(): [number, number][] {
    const { vx, vz } = this.state.bike;
    const ax = Math.abs(vx);
    const az = Math.abs(vz);
    if (ax < 0.4 && az < 0.4) {
      return [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
    }
    const fx = ax >= az ? Math.sign(vx) : 0;
    const fz = az > ax ? Math.sign(vz) : 0;
    const side: [number, number] = fz !== 0 ? [1, 0] : [0, 1];
    return [
      [fx, fz],
      [fx * 2, fz * 2],
      side,
      [-side[0], -side[1]],
    ];
  }

  private biomeSpawnProfile(): { target: number; mutant: number; runner: number; clamberer: number } {
    const b = this.state.biomeHint.toUpperCase();
    const pressure = Math.min(12, Math.floor(this.state.blocksTraversed / 3));
    const base =
      b === 'DENSE'
        ? { target: 48, mutant: 0.18, runner: 0.38, clamberer: 0.55 }
        : b === 'URBAN'
          ? { target: 40, mutant: 0.14, runner: 0.32, clamberer: 0.48 }
          : b === 'MEMPHIS'
            ? { target: 36, mutant: 0.1, runner: 0.28, clamberer: 0.42 }
            : { target: 32, mutant: 0.1, runner: 0.26, clamberer: 0.38 };
    return {
      target: base.target + pressure,
      mutant: Math.min(0.28, base.mutant + pressure * 0.004),
      runner: Math.min(0.48, base.runner + pressure * 0.005),
      clamberer: Math.min(0.62, base.clamberer + pressure * 0.004),
    };
  }

  private threatLabel(): string {
    const n = this.zombies.length;
    if (n >= 45) return 'BLACK';
    if (n >= 32) return 'RED';
    if (n >= 18) return 'ORANGE';
    if (n >= 8) return 'YELLOW';
    return 'GREEN';
  }

  private spawnHorde(rng: () => number): void {
    while (this.bundle.entitiesGroup.children.length) {
      const child = this.bundle.entitiesGroup.children[0];
      this.bundle.entitiesGroup.remove(child);
      this.disposeEntityMesh(child);
    }
    this.zombies = [];
    this.projectiles = [];
    this.loot = [];
    this.particles = [];

    const profile = this.biomeSpawnProfile();
    const buildingCount = this.state.activeOsm?.buildings?.length ?? 12;
    const densityTarget = hordeCountFromBuildings(buildingCount, this.state.biomeHint);
    const target = Math.max(4, Math.min(profile.target, densityTarget + Math.floor(rng() * 3)));
    const pending: {
      wx: number;
      wz: number;
      kind: ZombieKind;
      hp: number;
      speed: number;
      phase: number;
    }[] = [];
    const parkSafe = new Set<string>();
    for (const poi of this.state.activeOsm?.pois ?? []) {
      if (poi.kind === 'park' || poi.kind === 'school') {
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            parkSafe.add(`${Math.floor(poi.gx) + dx},${Math.floor(poi.gz) + dz}`);
          }
        }
      }
    }

    for (let i = 0; i < target; i++) {
      const edge = rng();
      const gx = edge < 0.5 ? (rng() < 0.5 ? 2 : GRID_W - 3) : 4 + Math.floor(rng() * (GRID_W - 8));
      const gz = edge >= 0.5 ? (rng() < 0.5 ? 2 : GRID_L - 3) : 4 + Math.floor(rng() * (GRID_L - 8));
      const t = this.state.surfaceGrid[idx(gx, gz)];
      if (t === TILE.BUILDING || t === TILE.WATER) continue;
      if (parkSafe.has(`${gx},${gz}`) && rng() < 0.75) continue;
      const { wx, wz } = gridToWorld(gx, gz);
      if (Math.hypot(wx - this.state.bike.x, wz - this.state.bike.z) < 16) continue;

      let kind: ZombieKind = 'walker';
      const roll = rng();
      if (roll < profile.mutant) kind = 'mutant';
      else if (roll < profile.runner) kind = 'runner';
      else if (roll < profile.clamberer) kind = 'clamberer';

      pending.push({
        wx,
        wz,
        kind,
        hp: kind === 'mutant' ? 90 : kind === 'runner' ? 28 : kind === 'clamberer' ? 40 : 35,
        speed:
          (kind === 'mutant' ? 4.2 : kind === 'runner' ? 4.8 : kind === 'clamberer' ? 3.1 : 2.6 + rng() * 1.2) *
          (1 + Math.min(0.35, this.state.blocksTraversed * 0.015)),
        phase: rng() * Math.PI * 2,
      });
    }
    const gen = ++this.hordeGen;
    const placeBatch = () => {
      if (gen !== this.hordeGen) return;
      const batch = pending.splice(0, 5);
      for (const z of batch) {
        const mesh = buildZombie(z.kind);
        mesh.position.set(z.wx, 0, z.wz);
        this.bundle.entitiesGroup.add(mesh);
        this.zombies.push({
          mesh,
          x: z.wx,
          z: z.wz,
          vx: 0,
          vz: 0,
          hp: z.hp,
          speed: z.speed,
          kind: z.kind,
          phase: z.phase,
          steppedY: 0,
          steppedRotZ: 0,
        });
      }
      if (pending.length) requestAnimationFrame(placeBatch);
    };
    placeBatch();

    let crates = 0;

    const pushCrate = (wx: number, wz: number, kind: LootKind) => {
      const m = createLootMesh(kind);
      m.position.set(wx, 0.38, wz);
      this.bundle.entitiesGroup.add(m);
      this.loot.push({ mesh: m, x: wx, z: wz, kind });
      crates++;
    };

    // Prefer fuel / shop POIs for loot caches
    const fuelish = (this.state.activeOsm?.pois ?? []).filter((p) => p.kind === 'fuel' || p.kind === 'shop');
    for (const poi of fuelish) {
      if (crates >= 6) break;
      const gx = Math.max(2, Math.min(GRID_W - 3, Math.floor(poi.gx)));
      const gz = Math.max(2, Math.min(GRID_L - 3, Math.floor(poi.gz)));
      const t = this.state.surfaceGrid[idx(gx, gz)];
      if (t === TILE.BUILDING || t === TILE.WATER) continue;
      const { wx, wz } = gridToWorld(gx, gz);
      pushCrate(wx, wz, poi.kind === 'fuel' ? 'fuel' : 'scrap');
    }

    for (let a = 0; a < 50 && crates < 5; a++) {
      const gx = 4 + Math.floor(rng() * (GRID_W - 8));
      const gz = 6 + Math.floor(rng() * (GRID_L - 12));
      const t = this.state.surfaceGrid[idx(gx, gz)];
      if (t === TILE.ROAD || t === TILE.RAIL || t === TILE.SIDEWALK || t === TILE.PARKING) {
        const { wx, wz } = gridToWorld(gx, gz);
        const roll = rng();
        const kind: LootKind = roll < 0.35 ? 'fuel' : roll < 0.6 ? 'med' : roll < 0.85 ? 'scrap' : 'mixed';
        pushCrate(wx, wz, kind);
      }
    }
  }

  private spawnWaveZombie(rng: () => number): void {
    for (let tries = 0; tries < 24; tries++) {
      const gx = rng() < 0.5 ? (rng() < 0.5 ? 2 : GRID_W - 3) : 4 + Math.floor(rng() * (GRID_W - 8));
      const gz = rng() < 0.5 ? (rng() < 0.5 ? 2 : GRID_L - 3) : 4 + Math.floor(rng() * (GRID_L - 8));
      const t = this.state.surfaceGrid[idx(gx, gz)];
      if (t === TILE.BUILDING || t === TILE.WATER) continue;
      const { wx, wz } = gridToWorld(gx, gz);
      if (Math.hypot(wx - this.state.bike.x, wz - this.state.bike.z) < 12) continue;
      const profile = this.biomeSpawnProfile();
      const roll = rng();
      let kind: ZombieKind = 'walker';
      if (roll < profile.mutant) kind = 'mutant';
      else if (roll < profile.runner) kind = 'runner';
      else if (roll < profile.clamberer) kind = 'clamberer';
      const mesh = buildZombie(kind);
      mesh.position.set(wx, 0, wz);
      this.bundle.entitiesGroup.add(mesh);
      this.zombies.push({
        mesh,
        x: wx,
        z: wz,
        vx: 0,
        vz: 0,
        hp: kind === 'mutant' ? 90 : kind === 'runner' ? 28 : kind === 'clamberer' ? 40 : 35,
        speed:
          (kind === 'mutant' ? 4.2 : kind === 'runner' ? 4.8 : kind === 'clamberer' ? 3.1 : 2.6 + rng() * 1.2) *
          (1 + Math.min(0.35, this.state.blocksTraversed * 0.015)),
        kind,
        phase: rng() * Math.PI * 2,
        steppedY: 0,
        steppedRotZ: 0,
      });
      return;
    }
  }

  private recomputeFlow(): void {
    const { gx, gz } = worldToGrid(this.state.bike.x, this.state.bike.z);
    this.lastFlowCell = `${gx},${gz}`;
    computeDijkstraFlowField(
      this.state.surfaceGrid,
      this.state.flowDistance,
      this.state.flowDirX,
      this.state.flowDirZ,
      gx,
      gz,
    );
    if (this.state.showFlowDebug) {
      rebuildFlowDebugOverlay(
        this.bundle.debugFlowGroup,
        true,
        this.state.flowDistance,
        this.state.flowDirX,
        this.state.flowDirZ,
      );
    }
  }

  private burstMat(hex: number): THREE.MeshStandardMaterial {
    let mat = this.burstMats.get(hex);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, emissive: hex, emissiveIntensity: 0.25 });
      this.burstMats.set(hex, mat);
    }
    return mat;
  }

  private spawnBurst(wx: number, wy: number, wz: number, hex: number, count = 6, speed = 5): void {
    const mat = this.burstMat(hex);
    const n = this.state.reduceMotion ? Math.max(1, Math.floor(count * 0.35)) : count;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sharedPartGeo, mat);
      m.position.set(wx, wy, wz);
      this.bundle.entitiesGroup.add(m);
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.65) * speed;
      this.particles.push({
        mesh: m,
        vx: Math.cos(angle) * spd,
        vy: 2.5 + Math.random() * speed * 0.85,
        vz: Math.sin(angle) * spd,
        life: 0.35 + Math.random() * 0.35,
      });
    }
  }

  private spawnWord(wx: number, wy: number, wz: number, text: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.font = '700 28px monospace';
    g.fillStyle = '#fde68a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 24);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.position.set(wx, wy, wz);
    sprite.scale.set(1.8, 0.7, 1);
    this.bundle.entitiesGroup.add(sprite);
    this.particles.push({ mesh: sprite, vx: 0, vy: 1.4, vz: 0, life: 0.9 });
  }

  private addShake(amount: number): void {
    if (this.state.reduceMotion) return;
    this.shake = Math.min(1.8, this.shake + amount);
  }

  private setReduceMotion(v: boolean): void {
    this.state.reduceMotion = v;
    this.applyReduceMotionChrome();
    if (v) {
      this.shake = 0;
      this.hitStop = 0;
      this.bundle.camera.fov = this.baseFov;
      this.bundle.camera.updateProjectionMatrix();
    }
  }

  private applyReduceMotionChrome(): void {
    document.documentElement.classList.toggle('reduce-motion', this.state.reduceMotion);
    if (this.state.reduceMotion) {
      document.documentElement.style.setProperty('--tilt-blur', '0px');
    }
  }

  private triggerHitStop(seconds = 0.045): void {
    if (this.state.reduceMotion) return;
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  private disposeEntityMesh(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Shared geos / burst mats must not be disposed here
      if (mesh.geometry !== this.sharedPartGeo && mesh.geometry !== LOOT_CRATE_GEO) {
        mesh.geometry?.dispose();
      }
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => {
          if (![...this.burstMats.values()].includes(m as THREE.MeshStandardMaterial)) m.dispose();
        });
      } else if (mat && ![...this.burstMats.values()].includes(mat as THREE.MeshStandardMaterial)) {
        (mat as THREE.Material).dispose();
      }
    });
  }

  private dropAt(lat: number, lon: number, name: string, biome: string): void {
    this.state.baseLat = lat;
    this.state.baseLon = lon;
    this.state.locationName = name;
    this.state.biomeHint = biome;
    this.state.chunkX = 0;
    this.state.chunkZ = 0;
    this.state.bike.x = 0.5;
    this.state.bike.z = 5.5;
    this.state.activeOsm = null;
    this.pendingRoadSnap = true;
    this.hud.setLatLonInputs(lat, lon);
    writeLatLonQuery(lat, lon);
    // Emmett: paint verified vectors immediately so radar isn't blank while Overpass spins
    if (isNearEmmett(lat, lon)) {
      const seed = emmettOsmFallback();
      this.state.activeOsm = seed;
      this.generateChunk(seed);
    } else {
      this.generateChunk(null);
    }
    void this.syncOsm();
    this.refreshObjective();
    this.hud.showToast(`DROPPED INTO ${name.toUpperCase()}`);
    if (this.coopRole === 'driver' && this.coop?.connected) {
      this.coop.send({ t: 'drop', lat, lon, name, biome });
    }
  }

  private async shareRide(): Promise<void> {
    try {
      if (!this.coop) this.coop = this.makeCoopClient();
      if (!this.coop.roomCode) {
        const code = await this.coop.createRoom();
        writeCoopQuery(code, true);
        this.coop.connect(code, 'driver');
        void this.lobby?.show(code);
        if (!isTvMode()) {
          const url = new URL(location.href);
          url.searchParams.set('tv', '1');
          history.replaceState({}, '', url.toString());
          installTvMode();
          this.hud.enableTvHud();
        }
      }
      const url = coopShareUrl(this.coop.roomCode);
      await navigator.clipboard.writeText(url);
      this.hud.setShareRideLabel('LINK COPIED');
      this.hud.setCoopStatus(`TV DRIVER · ${this.coop.roomCode.toUpperCase()}`);
      this.hud.showToast('PHONE LINK COPIED — OR SCAN THE QR · /join ALSO WORKS');
      this.hud.setSubtitle('SCAN TO BE THE GUNNER');
      gameAudio.bark('Waiting for gunner');
      window.setTimeout(() => this.hud.setShareRideLabel('SHARE PHONE GUN'), 2400);
    } catch (err) {
      this.hud.showToast(err instanceof Error ? err.message.toUpperCase() : 'COULD NOT OPEN RIDE');
    }
  }

  private async joinCoop(code: string, preferred: CoopRole | 'auto'): Promise<void> {
    if (!this.coop) this.coop = this.makeCoopClient();
    writeCoopQuery(code, preferred === 'driver');
    this.coop.connect(code, preferred);
    this.hud.setCoopStatus(`JOINING ${code.toUpperCase()}…`);
  }

  private async setRoadTrip(q: string): Promise<void> {
    if (!flags().roadTrip) return;
    const query = q.trim();
    if (!query) return;
    const hit = await searchNominatim(query);
    if (!hit) {
      this.hud.showToast('DESTINATION NOT FOUND');
      return;
    }
    const short = hit.name.split(',')[0] || query;
    this.trip.setDest(short, hit.lat, hit.lon);
    this.trip.save();
    this.hud.showToast(`TRIP SET · ${short.toUpperCase()}`);
    this.hud.setSubtitle(`HEADING TO ${short.toUpperCase()}`);
    this.persistRideState();
  }

  private persistRideState(): void {
    if (!this.coop?.connected || this.coopRole !== 'driver') return;
    const dest = this.trip.getDestination();
    this.coop.send({
      t: 'state',
      lat: this.state.baseLat,
      lon: this.state.baseLon,
      scrap: this.state.scrap,
      kills: this.state.kills,
      tripKm: this.trip.getOdometerMiles() * 1.60934,
      destName: dest?.name,
    });
  }

  private makeCoopClient(): CoopClient {
    return new CoopClient({
      onWelcome: (role, code, peers) => {
        this.coopRole = role;
        this.coopPeerOnline = peers > 1;
        this.hud.setCoopStatus(role === 'driver' ? `TV DRIVER · ${code.toUpperCase()}` : `GUNNER · ${code}`);
        this.hud.showToast(
          role === 'driver' ? 'TV IS THE RIDE · WAITING FOR PHONE GUNNER' : 'PHONE GUNNER SEATED',
        );
        if (role === 'driver' && peers <= 1) void this.lobby?.show(code);
      },
      onPeer: (role, online, peers, name, color) => {
        this.coopPeerOnline = peers > 1;
        if (role === 'gunner') {
          if (online) {
            this.gunnerName = name || 'Gunner';
            this.gunnerColor = color || '#38bdf8';
            this.lobby?.announceJoin(this.gunnerName, this.gunnerColor);
            this.hud.setGunnerBadge(this.gunnerName, this.gunnerColor);
            this.hud.setSubtitle(`${this.gunnerName.toUpperCase()} JOINED · GUNNER`);
            this.hud.showToast(`${this.gunnerName.toUpperCase()} JOINED · GUNNER`);
            gameAudio.bark(`${this.gunnerName} joined`);
            if (this.laserLine) {
              (this.laserLine.material as THREE.LineBasicMaterial).color.set(this.gunnerColor);
            }
          } else {
            this.hud.showToast('PHONE GUNNER LEFT');
            void this.lobby?.show(this.coop?.roomCode || '');
          }
        }
        if (this.coopRole && this.coop) {
          const away = this.coop.peerAway ? ' · AWAY' : '';
          this.hud.setCoopStatus(
            `TV DRIVER · ${this.coop.roomCode.toUpperCase()}${peers > 1 ? ' · PHONE LIVE' : ' · SEND LINK'}${away}`,
          );
        }
      },
      onHost: () => undefined,
      onGun: (gun) => {
        this.remoteGun = gun;
        this.remoteGunAt = performance.now() / 1000;
        this.coopPeerOnline = true;
        if (gun.name) this.gunnerName = gun.name;
        if (gun.color) {
          this.gunnerColor = gun.color;
          if (this.laserLine) {
            (this.laserLine.material as THREE.LineBasicMaterial).color.set(gun.color);
          }
        }
        if (gun.special) {
          this.hud.setSubtitle('FLARE!');
          this.shake = Math.max(this.shake, 0.35);
          rumbleGamepad(200, 0.3, 0.5);
        }
      },
      onDrop: () => undefined,
      onToast: (text) => this.hud.showToast(text),
      onStatus: (text) => this.hud.setCoopStatus(text),
      onEvent: (evt) => {
        this.hud.setSubtitle(evt.text);
        if (evt.kind === 'blast' || evt.kind === 'building') rumbleGamepad(160);
      },
      onState: (state) => {
        if (state.lat != null && this.coopRole === 'driver') {
          /* TV host owns sim; ignore remote state overwrite */
        }
      },
    });
  }

  private applyHostSnap(snap: CoopHostSnap): void {
    if (this.coopRole !== 'gunner') return;
    const b = this.state.bike;
    b.x = snap.bike.x;
    b.z = snap.bike.z;
    b.vx = snap.bike.vx;
    b.vz = snap.bike.vz;
    b.heading = snap.bike.heading;
    b.speed = snap.bike.speed;
    b.leanAngle = snap.bike.lean;
    b.drifting = snap.bike.drifting;
    b.hp = snap.bike.hp;
    b.fuel = snap.bike.fuel;
    this.state.scrap = snap.scrap;
    this.state.kills = snap.kills;
    this.state.partner.aimAngle = snap.aim;
    this.state.partner.weaponIndex = snap.weapon;
    this.hud.setWeapon(snap.weapon);
    this.remoteZombies = snap.zombies;
    const dropKey = `${snap.lat.toFixed(4)}_${snap.lon.toFixed(4)}_${snap.cx}_${snap.cz}`;
    if (dropKey !== this.lastHostDropKey) {
      this.lastHostDropKey = dropKey;
      if (
        Math.abs(this.state.baseLat - snap.lat) > 0.00005 ||
        Math.abs(this.state.baseLon - snap.lon) > 0.00005 ||
        this.state.chunkX !== snap.cx ||
        this.state.chunkZ !== snap.cz
      ) {
        this.state.baseLat = snap.lat;
        this.state.baseLon = snap.lon;
        this.state.chunkX = snap.cx;
        this.state.chunkZ = snap.cz;
        this.pendingRoadSnap = false;
        if (isNearEmmett(snap.lat, snap.lon) && snap.cx === 0 && snap.cz === 0) {
          this.generateChunk(emmettOsmFallback());
        } else {
          this.generateChunk(this.osmForChunk(snap.cx, snap.cz));
        }
        void this.syncOsm();
      }
    }
    this.syncGunnerZombies(snap.zombies);
  }

  private syncGunnerZombies(snaps: CoopZombieSnap[]): void {
    while (this.zombies.length > snaps.length) {
      const z = this.zombies.pop()!;
      this.bundle.entitiesGroup.remove(z.mesh);
      this.disposeEntityMesh(z.mesh);
    }
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      let z = this.zombies[i];
      if (!z) {
        const kind = (snap.kind as ZombieKind) || 'walker';
        const mesh = buildZombie(kind);
        this.bundle.entitiesGroup.add(mesh);
        z = {
          mesh,
          x: snap.x,
          z: snap.z,
          vx: 0,
          vz: 0,
          hp: 40,
          speed: 2.5,
          kind,
          phase: Math.random() * Math.PI * 2,
          steppedY: 0,
          steppedRotZ: 0,
        };
        this.zombies.push(z);
      }
      z.x = snap.x;
      z.z = snap.z;
      z.mesh.position.set(snap.x, 0, snap.z);
    }
  }

  private phoneGunLive(now: number): boolean {
    return this.coopRole === 'driver' && !!this.remoteGun && now - this.remoteGunAt < 1.2;
  }

  private publishCoop(now: number): void {
    if (!this.coop?.connected || this.coopRole !== 'driver') return;
    const gunnerListening = this.coopPeerOnline || this.phoneGunLive(now);
    // Host snaps 20–30 Hz; phone aim streams separately at ~60 Hz
    if (now - this.lastCoopSend < (gunnerListening ? 0.04 : 0.1)) return;
    this.lastCoopSend = now;
    const b = this.state.bike;
    const firing =
      this.phoneGunLive(now) && this.remoteGun
        ? this.remoteGun.fireHeld || this.remoteGun.autoFire
        : this.state.mouseDown || this.state.partner.autoFire;
    this.impactFlashes = this.impactFlashes
      .map((f) => ({ ...f, life: f.life - 0.04 }))
      .filter((f) => f.life > 0);
    this.coop.send({
      t: 'host',
      at: now,
      bike: {
        x: b.x,
        z: b.z,
        vx: b.vx,
        vz: b.vz,
        heading: b.heading,
        speed: b.speed,
        lean: b.leanAngle,
        drifting: b.drifting,
        hp: b.hp,
        fuel: b.fuel,
      },
      aim: this.state.partner.aimAngle,
      weapon: this.state.partner.weaponIndex,
      fire: !!firing,
      lat: this.state.baseLat,
      lon: this.state.baseLon,
      cx: this.state.chunkX,
      cz: this.state.chunkZ,
      scrap: this.state.scrap,
      kills: this.state.kills,
      horde: this.zombies.length,
      place: this.state.locationName,
      objective: this.state.objective,
      zombies: this.zombies.slice(0, 48).map((z) => ({ x: z.x, z: z.z, kind: z.kind })),
      projectiles: this.projectiles.slice(0, 24).map((p) => ({
        x: p.x,
        z: p.z,
        kind: p.explosive ? 2 : p.ignites ? 1 : 0,
      })),
      flashes: this.impactFlashes.slice(0, 12),
    });
  }

  private async dropGps(lat: number, lon: number): Promise<void> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      this.hud.showToast('INVALID LAT/LON');
      return;
    }
    this.hud.showToast('REVERSE GEOCODING...');
    const name = await reverseNominatim(lat, lon);
    this.dropAt(lat, lon, name, 'URBAN');
  }

  private async geolocate(): Promise<void> {
    if (!navigator.geolocation) {
      this.hud.showToast('GEOLOCATION UNAVAILABLE');
      return;
    }
    this.hud.showToast('REQUESTING LOCATION...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void this.dropGps(pos.coords.latitude, pos.coords.longitude);
      },
      () => this.hud.showToast('LOCATION DENIED'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  }

  private async searchPlace(q: string): Promise<void> {
    if (!q.trim()) return;
    this.hud.showToast(`GEOCODING "${q.toUpperCase()}"...`);
    const hit = await searchNominatim(q);
    if (hit) this.dropAt(hit.lat, hit.lon, hit.name, 'URBAN');
    else this.hud.showToast('LOCATION NOT FOUND');
  }

  private repair(): void {
    const cost = Math.max(5, 15 - this.state.repairDiscount);
    if (this.state.scrap >= cost && (this.state.bike.hp < 100 || this.state.bike.fuel < 100)) {
      this.state.scrap -= cost;
      this.state.bike.hp = Math.min(100, this.state.bike.hp + 45);
      this.state.bike.fuel = Math.min(100, this.state.bike.fuel + 45);
      this.spawnBurst(this.state.bike.x, 0.8, this.state.bike.z, 0x34d399, 10, 5);
      gameAudio.pickup();
      this.hud.showToast(`SCRAMBLER PATCHED (−${cost} SCRAP)`);
      this.persistRun(true);
    }
  }

  private buyOvercharge(): void {
    const now = performance.now() / 1000;
    if (this.state.scrap < 40) {
      this.hud.showToast('NEED 40 SCRAP FOR FIREBOMB OVERCHARGE');
      return;
    }
    if (this.state.flareOverchargeUntil > now) {
      this.hud.showToast('FIREBOMB OVERCHARGE ALREADY ACTIVE');
      return;
    }
    this.state.scrap -= 40;
    this.state.flareOverchargeUntil = now + 20;
    this.state.partner.weaponIndex = 2;
    this.hud.setWeapon(2);
    gameAudio.switchWeapon();
    this.spawnBurst(this.state.bike.x, 0.9, this.state.bike.z, 0xf43f5e, 12, 6);
    this.hud.showToast('FIREBOMB OVERCHARGE — WIDER BLAST, 20s');
    this.hud.pushKillFeed('FIREBOMB OC ARMED');
    this.persistRun(true);
  }

  private triggerChunk(dx: number, dz: number): void {
    this.state.chunkX += dx;
    this.state.chunkZ += dz;
    this.state.blocksTraversed++;
    this.pendingRoadSnap = false;
    const margin = 1.4;
    if (dx > 0) this.state.bike.x = -HALF_W + margin;
    if (dx < 0) this.state.bike.x = HALF_W - margin;
    if (dz > 0) this.state.bike.z = -HALF_L + margin;
    if (dz < 0) this.state.bike.z = HALF_L - margin;
    this.state.bike.x = Math.max(-HALF_W + 2, Math.min(HALF_W - 2, this.state.bike.x));
    this.state.bike.z = Math.max(-HALF_L + 2, Math.min(HALF_L - 2, this.state.bike.z));
    this.state.transition.active = true;
    this.state.transition.progress = 0;
    this.state.transition.offsetX = dx * 12;
    this.state.transition.offsetZ = dz * 18;
    const live = this.osmForChunk(this.state.chunkX, this.state.chunkZ);
    this.generateChunk(live);
    const bbox = this.getChunkBBox();
    writeLatLonQuery(bbox.curLat, bbox.curLon);
    this.hud.setLatLonInputs(bbox.curLat, bbox.curLon);
    void this.syncOsm();
    this.hud.showToast(
      live
        ? `${bbox.curLat.toFixed(3)}°, ${bbox.curLon.toFixed(3)}° · LIVE MAP`
        : `${bbox.curLat.toFixed(3)}°, ${bbox.curLon.toFixed(3)}° · LOADING MAP`,
    );
  }

  private isTypingFocus(): boolean {
    const el = document.activeElement;
    return !!el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
  }

  private bindInput(): void {
    installRideInput({
      state: this.state,
      bundle: this.bundle,
      isTyping: () => this.isTypingFocus(),
      unlock: () => gameAudio.unlock(),
      weapon: (index) => {
        if (this.state.partner.weaponIndex !== index) gameAudio.switchWeapon();
        this.state.partner.weaponIndex = index;
        this.hud.setWeapon(index);
      },
      repair: () => this.repair(),
      overcharge: () => this.buyOvercharge(),
      mute: () => {
        const muted = gameAudio.toggleMute();
        this.hud.setMuteLabel(muted);
        this.hud.showToast(muted ? 'AUDIO MUTED' : 'AUDIO ON');
      },
      creator: () => this.openCreator(),
      inspector: () => this.openInspector(),
      hideMenus: () => this.hud.toggleMenusHidden(),
      escape: () => {
        if (this.creator.isOpen()) this.creator.close();
        if (this.inspector.isOpen()) this.inspector.close();
      },
      pause: () => this.togglePause(),
      returnHome: () => this.returnToEmmett(),
      pointer: (x, y) => this.aimFromPointer(x, y),
      inspectorOpen: () => this.inspector.isOpen(),
    });
  }

  private aimFromPointer(clientX: number, clientY: number): void {
    this.hud.moveCrosshair(clientX, clientY);
    if (this.state.rightMouseDown) {
      this.state.cameraYawOffset -= (clientX - this.state.lastMouseX) * 0.0065;
      this.state.lastMouseX = clientX;
    }
    this.mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouseNDC, this.bundle.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.state.mouseWorldPos);
  }

  private togglePause(): void {
    if (this.towTimer > 0) return;
    this.state.paused = !this.state.paused;
    this.hud.showToast(this.state.paused ? 'PAUSED' : 'RIDING');
    this.hud.setObjective(this.state.paused ? 'PAUSED · P TO RIDE' : this.state.objective);
  }

  private returnToEmmett(): void {
    clearRun();
    this.state.bike.hp = 100;
    this.state.bike.fuel = 100;
    this.state.bike.vx = 0;
    this.state.bike.vz = 0;
    this.state.bike.speed = 0;
    this.state.paused = false;
    this.dropAt(42.9906, -82.7649, 'Emmett', 'EMMETT');
  }

  private beginFieldTow(): void {
    if (this.towTimer > 0) return;
    this.towTimer = FIELD_TOW_DURATION;
    this.state.paused = true;
    this.state.scrap = Math.max(0, this.state.scrap - 10);
    this.addShake(1.2);
    gameAudio.tow();
    if (this.towOverlay) this.towOverlay.style.opacity = '1';
    this.hud.showToast('EMERGENCY FIELD TOW — STAND BY');
  }

  private finishFieldTow(): void {
    this.state.bike.hp = 100;
    this.state.bike.fuel = 50;
    this.state.bike.vx = 0;
    this.state.bike.vz = 0;
    this.state.bike.speed = 0;
    this.towIFrames = TOW_IFRAMES;
    this.state.paused = this.state.studioMode !== 'none';
    if (this.towOverlay) this.towOverlay.style.opacity = '0';
    this.hud.showToast('HULL RESTORED · TANK HALF FULL');
    this.persistRun(true);
  }

  private updateSim(dt: number, now: number): void {
    if (this.hitStop > 0) this.hitStop -= dt;
    const simFrozen = this.hitStop > 0;

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);

    if (this.towTimer > 0) {
      this.towTimer -= dt;
      if (this.towTimer <= 0) this.finishFieldTow();
    }
    if (this.towIFrames > 0) this.towIFrames -= dt;

    if (this.state.transition.active) {
      this.state.transition.progress = Math.min(1, this.state.transition.progress + dt * 3.6);
      const ease = 1 - Math.pow(1 - this.state.transition.progress, 3);
      this.bundle.dioramaRoot.position.x = this.state.transition.offsetX * (1 - ease);
      this.bundle.dioramaRoot.position.z = this.state.transition.offsetZ * (1 - ease);
      const dip = this.state.reduceMotion ? 0 : -Math.sin((1 - ease) * Math.PI) * 1.8;
      this.bundle.dioramaRoot.position.y = dip;
      if (this.state.transition.progress >= 1) {
        this.state.transition.active = false;
        this.bundle.dioramaRoot.position.set(0, 0, 0);
      }
    }

      if (!simFrozen && !this.state.paused && this.towTimer <= 0 && !this.photoMode) {
      const pad = sampleGamepad();
      if (pad.connected) {
        const keys = this.state.keys;
        keys.left = pad.steer < -0.2;
        keys.right = pad.steer > 0.2;
        keys.up = pad.throttle > 0.15;
        keys.down = pad.brake > 0.15;
      }
      const phys = updateBikePhysics(this.state, dt);
      const gear = Math.max(1, Math.min(5, Math.floor(Math.abs(this.state.bike.speed) / 6) + 1));
      gameAudio.updateEngine(this.state.bike.speed, this.state.bike.drifting, gear);
      if (this.state.bike.drifting) {
        groundTrails.pushDust(this.state.bike.x, this.state.bike.z, this.state.bike.heading, 0.9);
      } else if (Math.abs(this.state.bike.speed) > 2) {
        groundTrails.pushTire(this.state.bike.x, this.state.bike.z, this.state.bike.heading, 0.55);
      }
      if (phys.chunkDx || phys.chunkDz) {
        this.triggerChunk(phys.chunkDx, phys.chunkDz);
        this.persistRun(true);
        return;
      }
      if (phys.bounced) {
        this.spawnBurst(phys.bounceX, 0.5, phys.bounceZ, 0xfbbf24, 4, 4);
        this.addShake(0.35);
        gameAudio.hit();
      }
      if (phys.crushedRubble) {
        this.spawnBurst(phys.rubbleX, 0.4, phys.rubbleZ, 0x64748b, 6, 4.5);
        this.addShake(0.25);
      }
      if (phys.onToxic && this.towIFrames <= 0) {
        this.state.bike.hp = Math.max(0, this.state.bike.hp - 8 * dt);
        this.state.bike.fuel = Math.max(0, this.state.bike.fuel - 4 * dt);
        if (Math.random() < 0.08) this.spawnBurst(this.state.bike.x, 0.3, this.state.bike.z, 0xa3e635, 2, 2.5);
        if (Math.random() < 0.02) this.hud.pushKillFeed('TOXIC BURN');
      }
      if (this.state.bike.drifting && Math.random() < 0.55) {
        const side = this.state.couple.bike.sidecarSide === 'right' ? 1 : -1;
        const rx = Math.cos(this.state.bike.heading) * 0.35 * side;
        const rz = -Math.sin(this.state.bike.heading) * 0.35 * side;
        this.spawnBurst(
          this.state.bike.x - rx,
          0.12,
          this.state.bike.z - rz,
          Math.random() < 0.35 ? 0xfbbf24 : 0x94a3b8,
          1,
          2.1,
        );
      }

      if (this.bikeRig) {
        const b = this.state.bike;
        const blink = this.towIFrames > 0 && Math.floor(now * 12) % 2 === 0;
        this.bikeRig.root.visible = !blink;
        this.bikeRig.root.position.set(
          b.x,
          0.05 + Math.abs(Math.sin(now * 18)) * (Math.abs(b.speed) * 0.005),
          b.z,
        );
        this.bikeRig.root.rotation.y = b.heading;
        this.bikeRig.chassis.rotation.z = b.leanAngle;
      }

      const cell = worldToGrid(this.state.bike.x, this.state.bike.z);
      const cellKey = `${cell.gx},${cell.gz}`;
      if (cellKey !== this.lastFlowCell) {
        this.lastFlowCell = cellKey;
        this.recomputeFlow();
      }

      this.state.partner.driverFiring = false;
      const phoneGun = this.phoneGunLive(now);
      let threat = false;
      if (phoneGun && this.remoteGun) {
        const gun = this.remoteGun;
        this.state.partner.weaponIndex = gun.weapon;
        this.state.partner.autoAim = gun.autoAim;
        this.state.partner.autoFire = gun.autoFire;
        this.state.mouseWorldPos.set(gun.mx, 0, gun.mz);
        if (gun.autoAim) {
          threat = updateAim(this.state, this.zombies);
        } else {
          let aim = gun.aim;
          if (flags().aimAssist) {
            aim = assistAim(aim, this.state.bike.x, this.state.bike.z, this.zombies);
          }
          this.state.partner.aimAngle = aim;
          threat = this.zombies.some((z) => Math.hypot(z.x - this.state.bike.x, z.z - this.state.bike.z) < 13.5);
        }
        this.hud.setWeapon(gun.weapon);
      } else {
        threat = updateAim(this.state, this.zombies);
      }
      const shouldFire = phoneGun
        ? !!(this.remoteGun && (this.remoteGun.fireHeld || (this.remoteGun.autoFire && threat)))
        : this.state.mouseDown || threat || (this.state.partner.autoFire && threat);
      if (this.laserLine) {
        const aim = this.state.partner.aimAngle;
        this.laserLine.position.set(this.state.bike.x, 0, this.state.bike.z);
        this.laserLine.rotation.y = aim;
        this.laserLine.visible = true;
        (this.laserLine.material as THREE.LineBasicMaterial).opacity = shouldFire ? 1 : 0.65;
      }
      if (shouldFire) {
        if (fireWeapon(this.state, now, this.bundle.entitiesGroup, this.projectiles, false)) {
          gameAudio.fire();
          this.hud.pulseCrosshair();
          this.addShake(this.state.partner.weaponIndex === 2 ? 0.45 : 0.12);
          if (this.state.partner.weaponIndex === 2) this.triggerHitStop(0.03);
          if (this.bikeRig) {
            this.bikeRig.headlight.intensity =
              TIME_PRESETS[this.state.timeOfDayIndex].spotInt + 1.4;
          }
        }
      }
      if (this.state.bike.drifting && Math.random() < 0.08) {
        if (fireWeapon(this.state, now, this.bundle.entitiesGroup, this.projectiles, true)) {
          gameAudio.fire();
        }
      }
      if (this.bikeRig && this.state.mouseDown) {
        const base = TIME_PRESETS[this.state.timeOfDayIndex].spotInt;
        this.bikeRig.headlight.intensity = THREE.MathUtils.lerp(
          this.bikeRig.headlight.intensity,
          base,
          8 * dt,
        );
      }

      const aimRel = this.state.partner.aimAngle - this.state.bike.heading + Math.PI;
      this.stepped.maybeStep(now, this.bikeRig, this.zombies, phys.visualSteerTilt, aimRel);

      const b = this.state.bike;
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        const z = this.zombies[i];
        const { gx, gz } = worldToGrid(z.x, z.z);
        const cell = idx(gx, gz);
        const climbBoost = z.kind === 'clamberer' ? 1.15 : 1;
        z.vx = z.vx * 0.82 + this.state.flowDirX[cell] * z.speed * 0.18 * climbBoost;
        z.vz = z.vz * 0.82 + this.state.flowDirZ[cell] * z.speed * 0.18 * climbBoost;
        const nx = z.x + z.vx * dt;
        const nz = z.z + z.vz * dt;
        const ng = worldToGrid(nx, nz);
        const nTile = this.state.surfaceGrid[idx(ng.gx, ng.gz)];
        const nH = this.state.heightGrid[idx(ng.gx, ng.gz)];
        const canClimb = z.kind === 'clamberer' && nTile === TILE.BUILDING && nH <= 14;
        if ((nTile !== TILE.BUILDING && nTile !== TILE.WATER) || canClimb) {
          z.x = nx;
          z.z = nz;
        }
        const dist = Math.hypot(z.x - b.x, z.z - b.z);
        if (dist < 1.05) {
          if (Math.abs(b.speed) > 5 || b.drifting) {
            z.hp -= 65;
            z.vx = (z.x - b.x) * 14;
            z.vz = (z.z - b.z) * 14;
            this.spawnBurst(z.x, 0.5, z.z, z.kind === 'mutant' ? 0xa855f7 : 0x8c8299, 7, 6);
            this.addShake(0.4);
            this.triggerHitStop(0.035);
            gameAudio.hit();
          } else if (this.towIFrames <= 0) {
            b.hp = Math.max(0, b.hp - 12 * dt);
          }
        }
        if (z.hp <= 0) {
          this.bundle.entitiesGroup.remove(z.mesh);
          this.disposeEntityMesh(z.mesh);
          this.spawnBurst(z.x, 0.45, z.z, z.kind === 'mutant' ? 0xd946ef : 0x8c8299, 18, 8);
          this.spawnWord(z.x, 1.1, z.z, 'ASH');
          this.zombies.splice(i, 1);
          this.state.kills++;
          this.chunkKills++;
          let scrapGain = z.kind === 'mutant' ? 6 : 2;
          if (now - this.lastKillAt < 1.6) this.killStreak++;
          else this.killStreak = 1;
          this.lastKillAt = now;
          if (this.killStreak >= 3) {
            scrapGain += Math.min(8, this.killStreak);
            this.hud.pushKillFeed(`STREAK x${this.killStreak}`);
          }
          if (phoneGun && Math.abs(this.state.bike.speed) > 5) {
            scrapGain += coopDoubleKillBonus(1, true);
          }
          this.state.scrap += scrapGain;
          gameAudio.kill();
          this.coop?.sendEvent('kill', `KILL +${scrapGain}`);
          this.hud.pushKillFeed(
            z.kind === 'mutant'
              ? `MUTANT DOWN +${scrapGain}`
              : z.kind === 'runner'
                ? `RUNNER DOWN +${scrapGain}`
                : `${z.kind.toUpperCase()} DOWN +${scrapGain}`,
          );
          if (z.kind === 'mutant') this.triggerHitStop(0.05);
          rumbleGamepad(90, 0.35, 0.55);
          this.impactFlashes.push({ x: z.x, z: z.z, life: 0.35 });
          this.checkProgression();
          continue;
        }
        const standH = this.state.heightGrid[idx(worldToGrid(z.x, z.z).gx, worldToGrid(z.x, z.z).gz)];
        const climbY =
          z.kind === 'clamberer' && this.state.surfaceGrid[idx(worldToGrid(z.x, z.z).gx, worldToGrid(z.x, z.z).gz)] === TILE.BUILDING
            ? Math.min(2.4, standH * 0.12)
            : 0;
        z.mesh.position.set(z.x, z.steppedY + climbY, z.z);
        z.mesh.rotation.y = Math.atan2(-z.vx, -z.vz);
        z.mesh.rotation.z = z.steppedRotZ;
      }

      let cityFell = 0;
      updateProjectiles(
        this.projectiles,
        this.zombies,
        this.state.surfaceGrid,
        this.bundle.entitiesGroup,
        dt,
        (x, y, z, c, n, s) => {
          this.spawnBurst(x, y, z, c, n, s);
          if (c === 0xf43f5e) {
            this.addShake(0.7);
            this.triggerHitStop(0.055);
          } else this.addShake(0.08);
          gameAudio.hit();
        },
        (x, z, breach, ignites) => {
          const fell =
            breach <= 1
              ? this.structures.chip(x, z, this.state.surfaceGrid, this.state.heightGrid)
              : this.structures.blast(
                  x,
                  z,
                  breach,
                  ignites,
                  this.state.surfaceGrid,
                  this.state.heightGrid,
                  this.bundle.entitiesGroup,
                );
          if (fell <= 0) return;
          cityFell += fell;
          this.spawnBurst(x, 0.35, z, 0x78716c, breach <= 1 ? 6 : 12, 4.5);
          this.debris.spawnBurst(x, 0.5, z, this.bundle.entitiesGroup, Math.min(14, fell));
          this.smoke.spawnColumn(x, z, this.bundle.entitiesGroup, fell / 6);
          this.impactFlashes.push({ x, z, life: 0.5 });
          if (breach > 1) {
            this.hud.pushKillFeed(fell > 6 ? 'STRUCTURE DOWN' : 'WALL DOWN');
            this.hud.setSubtitle(fell > 6 ? 'BUILDING DOWN' : 'WALL DOWN');
            this.state.scrap += 4 + this.structures.takePendingScrap();
            gameAudio.blast();
            this.coop?.sendEvent('building', fell > 6 ? 'BUILDING DOWN' : 'WALL DOWN');
            this.spawnWord(x, 1.4, z, 'BOOM');
            rumbleGamepad(180, 0.5, 0.85);
          }
        },
      );
      cityFell += this.structures.update(
        dt,
        this.state.surfaceGrid,
        this.state.heightGrid,
        this.bundle.entitiesGroup,
        this.zombies,
        this.state.bike,
      );
      for (const ev of this.structures.drainCollapseEvents()) {
        this.debris.spawnBurst(ev.wx, 0.5, ev.wz, this.bundle.entitiesGroup, Math.min(14, ev.voxelCount));
        this.smoke.spawnColumn(ev.wx, ev.wz, this.bundle.entitiesGroup, ev.voxelCount / 6);
      }
      this.debris.update(dt);
      this.smoke.update(dt);
      this.state.scrap += this.structures.takePendingScrap();
      if (cityFell > 0) {
        this.recomputeFlow();
        this.hud.markRadarDirty();
      }

      // Drift FOV punch
      if (!this.state.reduceMotion) {
        const targetFov = this.baseFov + (this.state.bike.drifting ? 3.5 : 0);
        this.bundle.camera.fov = THREE.MathUtils.lerp(this.bundle.camera.fov, targetFov, 6 * dt);
        this.bundle.camera.updateProjectionMatrix();
      }

      for (let i = this.loot.length - 1; i >= 0; i--) {
        const c = this.loot[i];
        c.mesh.rotation.y += dt * 1.8;
        c.mesh.position.y = 0.38 + Math.sin(now * 3.5 + i) * 0.1;
        if (Math.hypot(c.x - b.x, c.z - b.z) < 1.35) {
          if (c.kind === 'fuel') {
            b.fuel = Math.min(100, b.fuel + 48);
            this.state.scrap += 4;
            this.hud.pushKillFeed('FUEL CACHE +48');
          } else if (c.kind === 'med') {
            b.hp = Math.min(100, b.hp + 40);
            this.state.scrap += 3;
            this.hud.pushKillFeed('MEDKIT +40 HULL');
          } else if (c.kind === 'scrap') {
            this.state.scrap += 22;
            b.fuel = Math.min(100, b.fuel + 8);
            this.hud.pushKillFeed('SCRAP HAUL +22');
          } else {
            b.fuel = Math.min(100, b.fuel + 30);
            b.hp = Math.min(100, b.hp + 15);
            this.state.scrap += 10;
            this.hud.pushKillFeed('SUPPLY CRATE');
          }
          this.spawnBurst(c.x, 0.5, c.z, 0xfbbf24, 9, 5);
          this.bundle.entitiesGroup.remove(c.mesh);
          this.disposeEntityMesh(c.mesh);
          this.loot.splice(i, 1);
          gameAudio.pickup();
          this.persistRun();
        }
      }

      // Wave pressure — trickle reinforcements in dense/urban blocks
      this.waveTimer += dt;
      const hordeCap = this.biomeSpawnProfile().target + 8;
      const waveInterval = this.state.biomeHint === 'DENSE' ? 4.5 : this.state.biomeHint === 'URBAN' ? 6.5 : 9;
      if (this.waveTimer > waveInterval && this.zombies.length < hordeCap) {
        this.waveTimer = 0;
        const seed = hashCoords(this.state.baseLat, this.state.baseLon, this.state.chunkX, this.state.chunkZ) ^ (this.state.kills * 9973);
        this.spawnWaveZombie(mulberry32(seed + Math.floor(now * 10)));
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        const sprite = pt.mesh as THREE.Sprite;
        if (!sprite.isSprite) pt.vy -= 18 * dt;
        pt.mesh.position.x += pt.vx * dt;
        pt.mesh.position.y += pt.vy * dt;
        pt.mesh.position.z += pt.vz * dt;
        pt.life -= dt;
        if (sprite.isSprite) {
          sprite.material.opacity = Math.max(0, pt.life);
        } else {
          if (pt.mesh.position.y < 0.08) {
            pt.mesh.position.y = 0.08;
            pt.vy *= -0.45;
            pt.vx *= 0.7;
            pt.vz *= 0.7;
          }
          pt.mesh.scale.setScalar(Math.max(0.01, pt.life * 1.5));
        }
        if (pt.life <= 0) {
          this.bundle.entitiesGroup.remove(pt.mesh);
          if (sprite.isSprite) {
            sprite.material.map?.dispose();
            sprite.material.dispose();
          }
          this.particles.splice(i, 1);
        }
      }

      if (b.hp <= 0) this.beginFieldTow();
      if (b.hp < this.lastHp - 0.5) {
        if (now - this.lastHurtSfx > 0.25) {
          gameAudio.hurt();
          this.lastHurtSfx = now;
        }
        this.addShake(0.15);
      }
      if (b.hp > 0 && b.hp < 28) gameAudio.heartbeat();
      this.lastHp = b.hp;
      this.persistRun();

      if (!this.blockClear) {
        const nearGoal = this.goal
          ? Math.hypot(b.x - this.goal.wx, b.z - this.goal.wz) < 2.4
          : false;
        if (nearGoal || this.chunkKills >= 12) {
          this.blockClear = true;
          this.goal = null;
          this.hud.setGoal(null, null);
          this.state.objective = 'BLOCK SECURED — RIDE TO THE NEXT EARTH BLOCK';
          this.hud.setObjective(this.state.objective);
        } else if (this.chunkKills !== this.shownKills) {
          this.shownKills = this.chunkKills;
          this.refreshObjective();
        }
      }
    }

    const dmgV = this.state.reduceMotion ? 0 : Math.max(0, (55 - this.state.bike.hp) / 55) * 0.55;
    this.hud.setDamageVignette(dmgV + (this.towTimer > 0 ? 0.25 : 0));

    // Trip HUD + day/night + weather cadence
    const bikeLat =
      this.state.baseLat + (this.state.bike.z / (GRID_L * 1.4)) * (GRID_L * 1.4 * 0.000009);
    const bikeLon =
      this.state.baseLon + (this.state.bike.x / (GRID_W * 1.4)) * (GRID_W * 1.4 * 0.000012);
    this.trip.setBikePosition(bikeLat, bikeLon, {
      fastTravel: Math.abs(this.state.bike.speed) > 14,
    });
    const tripHud = this.trip.getHudSnapshot();
    if (tripHud.destinationName) {
      this.hud.setDestHud(
        `→ ${tripHud.destinationName.toUpperCase()} · ${tripHud.distanceMiles?.toFixed(1) ?? '—'} mi · ETA ${tripHud.etaMinutes ?? '—'}m · ${tripHud.bearingLabel} · ${tripHud.odometerMiles.toFixed(1)} mi`,
      );
    }
    gameAudio.updateThreatMusic(Math.min(1, this.zombies.length / 18));
    if (this.state.bike.fuel < 20 && Math.random() < 0.002) {
      this.hud.setSubtitle(gameAudio.bark('Fuel low'));
    }

    if (this.photoMode) {
      this.photoOrbit += dt * 0.35;
      this.state.cameraYawOffset = this.photoOrbit;
    }

    const frameDtMs = this.lastFrameAt ? (now - this.lastFrameAt) * 1000 : 16;
    this.lastFrameAt = now;
    this.frameMsEma = this.frameMsEma * 0.9 + frameDtMs * 0.1;
    if (this.frameMsEma > 18) {
      const pr = Math.max(0.5, this.bundle.renderer.getPixelRatio() * 0.92);
      this.bundle.renderer.setPixelRatio(pr);
    } else if (this.frameMsEma < 14 && Math.random() < 0.02) {
      fitRenderer(this.bundle.renderer);
    }
    if (this.perfHud) {
      this.perfHud.textContent = `FPS ${Math.round(1000 / Math.max(1, this.frameMsEma))} · PR ${this.bundle.renderer.getPixelRatio().toFixed(2)} · Z ${this.zombies.length} · SNAP ${this.coop?.connected ? 'on' : 'off'}`;
    }

    this.weatherTimer += dt;
    if (flags().weather && this.weatherTimer > 45) {
      this.weatherTimer = 0;
      void fetchWeather(this.state.baseLat, this.state.baseLon).then((w) => {
        if (!w) return;
        const fog = this.bundle.scene.fog as THREE.FogExp2;
        if (w.fog || w.rain) fog.density = Math.min(0.01, fog.density + 0.0015);
        if (w.snow) this.hud.setSubtitle('SNOW');
      });
    }
    const phase = getDayPhase(this.state.baseLat, this.state.baseLon, new Date());
    if (phase === 'night' && this.state.timeOfDayIndex !== 2) {
      /* leave manual time unless cinema — street lamps via midnight preset optional */
    }

    if (this.inspector.isOpen()) {
      this.inspector.update(now);
      const orbit = this.inspector.getOrbitCamera(new THREE.Vector3(0, 0.8, 0));
      this.bundle.camera.position.lerp(orbit.pos, 10 * dt);
      this.bundle.camera.lookAt(orbit.look);
    } else {
      // Frame bike + nearest threat with a soft yaw bias
      let nearest: ZombieEntity | null = null;
      let nd = 24;
      for (const z of this.zombies) {
        const d = Math.hypot(z.x - this.state.bike.x, z.z - this.state.bike.z);
        if (d < nd) {
          nd = d;
          nearest = z;
        }
      }
      if (nearest && !this.photoMode) {
        const ang = Math.atan2(nearest.x - this.state.bike.x, nearest.z - this.state.bike.z);
        this.state.cameraYawOffset = THREE.MathUtils.lerp(
          this.state.cameraYawOffset,
          ang * 0.12,
          1.2 * dt,
        );
      }
      updateCamera(
        this.bundle.camera,
        this.state.bike.x,
        this.state.bike.z,
        this.state.cameraPitchDeg,
        this.state.cameraYawOffset,
        this.state.cameraZoom,
        dt,
        this.shake,
      );
      this.bundle.skyDome.rotation.y = this.state.cameraYawOffset * 0.35;
      this.updateGisLabels();
    }

    // Keep the phone pad fed even during hit-stop / short pauses.
    this.publishCoop(now);
  }

  private startLoop(): void {
    let last = performance.now() / 1000;
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, now - last);
      last = now;
      this.updateSim(dt, now);
      this.hud.update(this.state, this.zombies, this.loot, this.threatLabel());
      this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    };
    requestAnimationFrame(tick);
  }
}

