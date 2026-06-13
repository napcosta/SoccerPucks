import * as THREE from 'three';
import { PITCH, GOAL } from './constants.js';
import { footLift } from './assets.js';
import { createScoreboard } from './scoreboard.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.1,
    300
  );
  camera.position.set(17, 14, 0);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function buildWorld(assets) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x89b4df);
  scene.fog = new THREE.Fog(0x8fb8df, 80, 180);
  addSkybox(scene);

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x32281e, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(20, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8aa8ff, 0.5);
  fill.position.set(-18, 20, -10);
  scene.add(fill);

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(52, 42), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  const pitchTex = assets.pitchTexture;
  pitchTex.repeat.set(2, 3);
  const pitchMat = new THREE.MeshStandardMaterial({
    map: pitchTex,
    roughness: 0.35,
    metalness: 0.05,
  });
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.halfWidth * 2, (PITCH.halfLength + PITCH.goalDepth) * 2),
    pitchMat
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  addMarkings(scene);
  addWalls(scene);
  addGoals(scene, assets.goal);

  const stadium = assets.stadium.scene;
  stadium.scale.setScalar(0.78);
  stadium.position.y = -0.05;
  stadium.traverse((node) => {
    if (node.isMesh) {
      node.receiveShadow = true;
    }
  });
  scene.add(stadium);

  const scoreboard = createScoreboard();
  scene.add(scoreboard.group);

  return { scene, scoreboard };
}

function addSkybox(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(170, 48, 24),
    new THREE.MeshBasicMaterial({
      map: createSkyboxTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);
}

function createSkyboxTexture() {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#5f89bd');
  sky.addColorStop(0.42, '#89b4df');
  sky.addColorStop(0.68, '#c6dced');
  sky.addColorStop(1, '#eef5fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createLinearGradient(0, height * 0.45, 0, height);
  haze.addColorStop(0, 'rgba(255, 255, 255, 0)');
  haze.addColorStop(1, 'rgba(255, 255, 255, 0.48)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.45, width, height * 0.55);

  drawCloudBand(ctx, width, height, 0.25, 24, 0.28, 123);
  drawCloudBand(ctx, width, height, 0.38, 18, 0.18, 241);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function drawCloudBand(ctx, width, height, yFraction, count, opacity, seed) {
  let value = seed;
  const rand = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };

  ctx.save();
  ctx.globalAlpha = opacity;
  for (let i = 0; i < count; i++) {
    const x = rand() * width;
    const y = height * (yFraction + (rand() - 0.5) * 0.16);
    const w = width * (0.04 + rand() * 0.08);
    const h = height * (0.018 + rand() * 0.036);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, w);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.42)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function addMarkings(scene) {
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const y = 0.012;

  const centerLine = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.halfWidth * 2, 0.09),
    lineMat
  );
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.y = y;
  scene.add(centerLine);

  const circle = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.65, 64), lineMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = y;
  scene.add(circle);

  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), lineMat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = y;
  scene.add(dot);

  for (const sign of [-1, 1]) {
    const goalLine = new THREE.Mesh(
      new THREE.PlaneGeometry(PITCH.halfWidth * 2, 0.09),
      lineMat
    );
    goalLine.rotation.x = -Math.PI / 2;
    goalLine.position.set(0, y, sign * PITCH.halfLength);
    scene.add(goalLine);
  }
}

function addWalls(scene) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4e8,
    transparent: true,
    opacity: 0.28,
    roughness: 0.2,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x35506e, roughness: 0.6 });

  const h = PITCH.wallHeight;
  const t = 0.18;
  const w = PITCH.halfWidth;
  const l = PITCH.halfLength;
  const gw = PITCH.goalHalfWidth;

  const make = (sx, sz, x, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), mat);
    m.position.set(x, h / 2, z);
    scene.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.08, sz + 0.02), trimMat);
    trim.position.set(x, h + 0.04, z);
    scene.add(trim);
  };

  make(t, l * 2 + t * 2, w + t / 2, 0, wallMat);
  make(t, l * 2 + t * 2, -(w + t / 2), 0, wallMat);

  const sideLen = w - gw;
  for (const sign of [-1, 1]) {
    make(sideLen, t, gw + sideLen / 2, sign * (l + t / 2), wallMat);
    make(sideLen, t, -(gw + sideLen / 2), sign * (l + t / 2), wallMat);
  }
}

function addGoals(scene, goalGltf) {
  for (const sign of [-1, 1]) {
    const goal = goalGltf.scene.clone(true);
    goal.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.material = new THREE.MeshStandardMaterial({
          color: sign > 0 ? 0xd94f43 : 0x4a7ee0,
          roughness: 0.4,
          metalness: 0.3,
        });
      }
    });
    goal.scale.setScalar(GOAL.scale);
    goal.position.set(0, footLift(goal) + PITCH.surfaceY, sign * (PITCH.halfLength + 0.1));
    goal.rotation.y = sign > 0 ? Math.PI : 0;
    scene.add(goal);
  }
}
