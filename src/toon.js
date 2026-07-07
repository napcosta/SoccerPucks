import * as THREE from 'three';

let sharedGradientMap = null;

export function toonGradientMap() {
  if (!sharedGradientMap) {
    const steps = new Uint8Array([80, 150, 210, 255]);
    sharedGradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    sharedGradientMap.minFilter = THREE.NearestFilter;
    sharedGradientMap.magFilter = THREE.NearestFilter;
    sharedGradientMap.needsUpdate = true;
  }
  return sharedGradientMap;
}

export function toonifyMaterial(material) {
  if (
    !material ||
    material.isMeshToonMaterial ||
    material.isMeshBasicMaterial ||
    material.isSpriteMaterial ||
    material.isLineBasicMaterial ||
    material.isShaderMaterial
  ) {
    return material;
  }

  const toon = new THREE.MeshToonMaterial({
    name: material.name,
    color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
    map: material.map ?? null,
    gradientMap: toonGradientMap(),
    normalMap: material.normalMap ?? null,
    aoMap: material.aoMap ?? null,
    alphaMap: material.alphaMap ?? null,
    emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: material.emissiveMap ?? null,
    emissiveIntensity: material.emissiveIntensity ?? 1,
    vertexColors: material.vertexColors ?? false,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
  });
  toon.userData = material.userData;
  return toon;
}

export function toonifyObject(root) {
  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    if (Array.isArray(node.material)) {
      node.material = node.material.map(toonifyMaterial);
    } else {
      node.material = toonifyMaterial(node.material);
    }
  });
  return root;
}

export function disableOutline(material) {
  material.userData.outlineParameters = {
    ...material.userData.outlineParameters,
    visible: false,
  };
  return material;
}

export function setOutline(material, params) {
  material.userData.outlineParameters = {
    ...material.userData.outlineParameters,
    ...params,
  };
  return material;
}
