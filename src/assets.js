import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { prepareSmokeTexture } from './effects.js';

const loader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

export async function loadAssets() {
  const [stadium, ball, sam, tesla, goal, pitchTexture, smokeTexture] = await Promise.all([
    loadGLB('assets/stadium.glb'),
    loadGLB('assets/ball.glb'),
    loadGLB('assets/sam.glb'),
    loadGLB('assets/tesla.glb'),
    loadGLB('assets/goal.glb'),
    textureLoader.loadAsync('assets/textures/rink_ice_ambientcg_ice003.jpg'),
    textureLoader.loadAsync('assets/textures/smoke_puff.png'),
  ]);

  pitchTexture.colorSpace = THREE.SRGBColorSpace;
  pitchTexture.wrapS = THREE.RepeatWrapping;
  pitchTexture.wrapT = THREE.RepeatWrapping;
  pitchTexture.anisotropy = 8;

  return {
    stadium,
    ball,
    sam,
    tesla,
    goal,
    pitchTexture,
    smokeTexture: prepareSmokeTexture(smokeTexture),
  };
}

export function footLift(object3D) {
  const box = new THREE.Box3();
  let found = false;
  object3D.updateMatrixWorld(true);
  object3D.traverse((node) => {
    if (node.isMesh || node.isSkinnedMesh) {
      box.expandByObject(node);
      found = true;
    }
  });
  return !found || box.isEmpty() ? 0 : -box.min.y;
}

export function cloneHeroScene(gltf) {
  const clone = SkeletonUtils.clone(gltf.scene);
  clone.traverse((node) => {
    if (node.isMesh || node.isSkinnedMesh) {
      node.castShadow = true;
      if (Array.isArray(node.material)) {
        node.material = node.material.map((m) => m.clone());
      } else {
        node.material = node.material.clone();
      }
    }
  });
  return clone;
}

export function tintHero(object, color) {
  object.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const name = node.name.toLowerCase();
    if (name.includes('base') || name.includes('cylinder')) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        m.color = new THREE.Color(color);
      }
    }
  });
}
