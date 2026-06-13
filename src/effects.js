import * as THREE from 'three';

const SMOKE_FRAMES = 4;

export function prepareSmokeTexture(texture) {
  const img = texture.image;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.max(d[i], d[i + 1], d[i + 2]);
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = lum;
  }
  ctx.putImageData(pixels, 0, 0);

  const alphaTex = new THREE.CanvasTexture(canvas);
  alphaTex.colorSpace = THREE.SRGBColorSpace;
  alphaTex.wrapS = THREE.ClampToEdgeWrapping;
  alphaTex.wrapT = THREE.ClampToEdgeWrapping;
  alphaTex.minFilter = THREE.LinearFilter;
  alphaTex.magFilter = THREE.LinearFilter;
  return alphaTex;
}

const SMOKE_TINT = new THREE.Color(0xdfe6ef);

export function spawnDashSmoke(scene, texture, x, z, dirX, dirZ) {
  const len = Math.hypot(dirX, dirZ) || 1;
  const fwdX = dirX / len;
  const fwdZ = dirZ / len;
  const backX = -fwdX;
  const backZ = -fwdZ;
  const sideX = -fwdZ;
  const sideZ = fwdX;

  const burst = {
    particles: [],
    update(dt) {
      let alive = false;
      for (const p of this.particles) {
        p.life -= dt;
        if (p.life <= 0) {
          p.sprite.visible = false;
          continue;
        }
        alive = true;

        const drag = Math.exp(-p.drag * dt);
        p.vx *= drag;
        p.vz *= drag;
        p.vy = p.vy * drag + p.buoyancy * dt;

        p.sprite.position.x += p.vx * dt;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;

        const k = 1 - p.life / p.maxLife;
        const scale = p.startScale * (1 + k * p.growth);
        p.sprite.scale.set(scale, scale, 1);

        p.sprite.material.opacity = p.peakOpacity * Math.sin(Math.PI * k);
        p.sprite.material.rotation = p.startRotation + p.spin * k;

        const frame = Math.min(SMOKE_FRAMES - 1, Math.floor(k * SMOKE_FRAMES));
        p.sprite.material.map.offset.x = frame / SMOKE_FRAMES;
      }
      return alive;
    },
    dispose(targetScene) {
      for (const p of this.particles) {
        targetScene.remove(p.sprite);
        p.sprite.material.map?.dispose();
        p.sprite.material.dispose();
      }
      this.particles.length = 0;
    },
  };

  for (let i = 0; i < 12; i++) {
    const mat = new THREE.SpriteMaterial({
      map: texture.clone(),
      color: SMOKE_TINT,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    mat.map.repeat.set(1 / SMOKE_FRAMES, 1);
    mat.map.offset.x = 0;
    mat.rotation = Math.random() * Math.PI * 2;

    const sprite = new THREE.Sprite(mat);
    const backDist = 0.1 + Math.random() * 0.4;
    const sideOff = (Math.random() - 0.5) * 0.55;
    sprite.position.set(
      x + backX * backDist + sideX * sideOff,
      0.1 + Math.random() * 0.18,
      z + backZ * backDist + sideZ * sideOff
    );

    const scale = 0.45 + Math.random() * 0.4;
    sprite.scale.set(scale, scale, 1);
    scene.add(sprite);

    const life = 0.28 + Math.random() * 0.16;
    const spread = 0.5 + Math.random() * 0.7;
    burst.particles.push({
      sprite,
      life,
      maxLife: life,
      startScale: scale,
      growth: 1.6 + Math.random() * 0.9,
      peakOpacity: 0.5 + Math.random() * 0.25,
      startRotation: mat.rotation,
      spin: (Math.random() - 0.5) * 1.4,
      drag: 5 + Math.random() * 3,
      buoyancy: 1.4 + Math.random() * 1.0,
      vx: backX * spread + sideX * (Math.random() - 0.5) * 0.6,
      vz: backZ * spread + sideZ * (Math.random() - 0.5) * 0.6,
      vy: 0.25 + Math.random() * 0.35,
    });
  }

  return burst;
}
