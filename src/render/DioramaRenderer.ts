import * as THREE from 'three';
import { WORLD_W, WORLD_L } from '../core/constants';
import { SUNSET } from '../art/palettes';

export interface RendererBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  tabletopGroup: THREE.Group;
  dioramaRoot: THREE.Group;
  mapTilePlaneGroup: THREE.Group;
  chunkVoxelGroup: THREE.Group;
  debugFlowGroup: THREE.Group;
  entitiesGroup: THREE.Group;
  studioGroup: THREE.Group;
  ambientLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  liveMapPlaneMesh: THREE.Mesh;
  skyDome: THREE.Mesh;
}

export const TIME_PRESETS = [
  {
    label: '☀ GOLDEN HOUR',
    bg: 0x1a1020,
    sunColor: 0xffdfa0,
    sunInt: 1.45,
    ambInt: 0.75,
    spotInt: 2.0,
    horizon: 0xf59e0b,
    top: 0x1e3a5f,
    rimColor: 0xf97316,
    rimInt: 0.45,
  },
  {
    label: '☁ OVERCAST DUSK',
    bg: 0x111827,
    sunColor: 0x93c5fd,
    sunInt: 0.85,
    ambInt: 0.55,
    spotInt: 2.8,
    horizon: 0x64748b,
    top: 0x334155,
    rimColor: 0x94a3b8,
    rimInt: 0.32,
  },
  {
    label: '☾ MIDNIGHT HEADLIGHTS',
    bg: 0x04060a,
    sunColor: 0x38bdf8,
    sunInt: 0.28,
    ambInt: 0.22,
    spotInt: 4.5,
    horizon: 0x1e3a5f,
    top: 0x020617,
    rimColor: 0x38bdf8,
    rimInt: 0.55,
  },
];

export type TimePreset = (typeof TIME_PRESETS)[number];

export function applyTimePreset(bundle: RendererBundle, preset: TimePreset, headlight?: THREE.SpotLight): void {
  bundle.scene.background = new THREE.Color(preset.bg);
  (bundle.scene.fog as THREE.FogExp2).color.setHex(preset.bg);
  bundle.sunLight.color.setHex(preset.sunColor);
  bundle.sunLight.intensity = preset.sunInt;
  bundle.ambientLight.intensity = preset.ambInt;
  bundle.rimLight.color.setHex(preset.rimColor);
  bundle.rimLight.intensity = preset.rimInt;
  const mat = bundle.skyDome.material as THREE.ShaderMaterial;
  mat.uniforms.topColor.value.setHex(preset.top);
  mat.uniforms.horizonColor.value.setHex(preset.horizon);
  mat.uniforms.bottomColor.value.setHex(preset.bg);
  if (headlight) headlight.intensity = preset.spotInt;
  const midnight = preset.label.includes('MIDNIGHT');
  const overcast = preset.label.includes('OVERCAST');
  bundle.renderer.toneMappingExposure = midnight ? 1.05 : overcast ? 1.1 : 1.15;
  (bundle.scene.fog as THREE.FogExp2).density = midnight ? 0.0062 : overcast ? 0.0048 : 0.0042;
}

/** Keep the drawing buffer near 1080p. A 5K display at 2x plus MSAA was OOM-killing the tab. */
const MAX_DRAW_PIXELS = 1920 * 1080;

export function fitRenderer(renderer: THREE.WebGLRenderer): void {
  const cssW = Math.max(1, window.innerWidth);
  const cssH = Math.max(1, window.innerHeight);
  const desired = Math.min(window.devicePixelRatio || 1, 1.25);
  const uncapped = cssW * cssH * desired * desired;
  const ratio = uncapped > MAX_DRAW_PIXELS ? Math.sqrt(MAX_DRAW_PIXELS / (cssW * cssH)) : desired;
  renderer.setPixelRatio(Math.max(0.5, ratio));
  renderer.setSize(cssW, cssH);
}

function makeWebGLRenderer(): THREE.WebGLRenderer {
  const attempts: THREE.WebGLRendererParameters[] = [
    { antialias: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
    { antialias: true, failIfMajorPerformanceCaveat: false },
    { antialias: false, failIfMajorPerformanceCaveat: false, depth: true },
    { antialias: false, alpha: false },
  ];
  let last: unknown;
  for (const params of attempts) {
    try {
      const renderer = new THREE.WebGLRenderer(params);
      return renderer;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('Error creating WebGL context.');
}

export function createRenderer(container: HTMLElement): RendererBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1020);
  scene.fog = new THREE.FogExp2(0x1a1020, 0.0042);

  const aspect =
    window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9;
  const camera = new THREE.PerspectiveCamera(20, aspect, 5, 320);

  const renderer = makeWebGLRenderer();
  fitRenderer(renderer);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x0b0d12, 1);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.background = '#0b0d12';
  container.appendChild(renderer.domElement);

  const tabletopGroup = new THREE.Group();
  scene.add(tabletopGroup);
  const dioramaRoot = new THREE.Group();
  scene.add(dioramaRoot);
  const mapTilePlaneGroup = new THREE.Group();
  dioramaRoot.add(mapTilePlaneGroup);
  const chunkVoxelGroup = new THREE.Group();
  dioramaRoot.add(chunkVoxelGroup);
  const debugFlowGroup = new THREE.Group();
  dioramaRoot.add(debugFlowGroup);
  const entitiesGroup = new THREE.Group();
  dioramaRoot.add(entitiesGroup);
  const studioGroup = new THREE.Group();
  studioGroup.visible = false;
  scene.add(studioGroup);

  const ambientLight = new THREE.HemisphereLight(0xffedd5, 0x1e293b, 0.78);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(SUNSET.sun, 1.48);
  sunLight.position.set(36, 62, 32);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 175;
  const d = 40;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(SUNSET.rim, 0.45);
  rimLight.position.set(-40, 28, -35);
  scene.add(rimLight);

  // Tabletop pedestal
  const tableMesh = new THREE.Mesh(
    new THREE.BoxGeometry(200, 2, 240),
    new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.85, metalness: 0.15 }),
  );
  tableMesh.position.y = -3.8;
  tableMesh.receiveShadow = true;
  tabletopGroup.add(tableMesh);

  const frameMesh = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD_W + 1.2, 0.8, WORLD_L + 1.2),
    new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.4, metalness: 0.6 }),
  );
  frameMesh.position.y = -2.35;
  dioramaRoot.add(frameMesh);

  const mapPlaneGeo = new THREE.PlaneGeometry(WORLD_W, WORLD_L);
  mapPlaneGeo.rotateX(-Math.PI / 2);
  const liveMapPlaneMesh = new THREE.Mesh(
    mapPlaneGeo,
    new THREE.MeshBasicMaterial({ color: 0x1a2414, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  // Sit under solid ground voxels so the basemap never punches checkerboard holes
  liveMapPlaneMesh.position.y = -0.22;
  mapTilePlaneGroup.add(liveMapPlaneMesh);

  // Sunset sky dome (inside-facing)
  const skyGeo = new THREE.SphereGeometry(200, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x1e3a5f) },
      horizonColor: { value: new THREE.Color(0xf59e0b) },
      bottomColor: { value: new THREE.Color(0x1a1020) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 col = mix(horizonColor, topColor, max(h, 0.0));
        col = mix(bottomColor, col, smoothstep(-0.2, 0.15, h));
        // sun disc glow
        float sun = pow(max(0.0, 1.0 - length(normalize(vWorldPosition.xz) - vec2(0.0, -0.85))), 8.0);
        col += vec3(1.0, 0.7, 0.3) * sun * 0.55;
        // faint ash grit in the upper atmosphere
        float grit = fract(sin(dot(normalize(vWorldPosition).xz, vec2(12.9898, 78.233))) * 43758.5453);
        col += vec3(0.04, 0.03, 0.02) * step(0.985, grit);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);

  // Studio pedestal for inspector
  const studioPed = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.4, 0.3, 32),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.4, roughness: 0.5 }),
  );
  studioPed.position.y = -0.15;
  studioGroup.add(studioPed);
  const grid = new THREE.GridHelper(6, 12, 0xf59e0b, 0x334155);
  grid.position.y = 0.01;
  studioGroup.add(grid);

  return {
    scene,
    camera,
    renderer,
    tabletopGroup,
    dioramaRoot,
    mapTilePlaneGroup,
    chunkVoxelGroup,
    debugFlowGroup,
    entitiesGroup,
    studioGroup,
    ambientLight,
    sunLight,
    rimLight,
    liveMapPlaneMesh,
    skyDome,
  };
}

export function updateCamera(
  camera: THREE.PerspectiveCamera,
  bikeX: number,
  bikeZ: number,
  pitchDeg: number,
  yaw: number,
  zoom: number,
  dt: number,
  shake = 0,
): void {
  const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
  const targetFocusX = bikeX * 0.86;
  const targetFocusZ = bikeZ * 0.86;
  const shakeX = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 0.6 : 0;
  const shakeZ = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const camX = targetFocusX + Math.sin(yaw) * Math.cos(pitchRad) * zoom + shakeX;
  const camY = Math.sin(pitchRad) * zoom + shakeY;
  const camZ = targetFocusZ + Math.cos(yaw) * Math.cos(pitchRad) * zoom + shakeZ;
  camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 8 * dt);
  camera.lookAt(targetFocusX, 0.85, targetFocusZ);
  camera.updateMatrixWorld();
}
