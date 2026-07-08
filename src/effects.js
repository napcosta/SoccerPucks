import * as THREE from 'three';
import { disableOutline } from './toon.js';

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

// Solid saturated blue with normal blending — additive glows wash out against
// the bright ice, so the field is drawn as flat cartoon shapes instead.
const MAGNET_COLOR = 0x2e6bff;
const MAGNET_HALO = 0x7fd0ff;
const MAGNET_WAVE_COUNT = 4;
const MAGNET_WAVE_PERIOD = 0.55;
const MAGNET_RING_COUNT = 3;
const MAGNET_RING_PERIOD = 0.7;

// Flat cartoon FX material: normal blending, starts invisible, no outline.
function flatFXMaterial(color) {
  return disableOutline(
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
}

// Persistent cartoon "magnetic field" for Tesla's power: arc-shaped attraction
// waves that ride the line from the ball to the player, suction rings that
// collapse into the player along the ground, and a grip halo on a captured ball.
export function createMagnetFieldFX(scene) {
  const group = new THREE.Group();
  group.name = 'MagnetFieldFX';
  group.visible = false;
  scene.add(group);

  // Upper semicircle in the XY plane: a standing arch the ball slides under,
  // yawed each frame so it faces the pull direction.
  const waves = Array.from({ length: MAGNET_WAVE_COUNT }, () => {
    const geometry = new THREE.TorusGeometry(0.7, 0.1, 8, 24, Math.PI);
    const mesh = new THREE.Mesh(geometry, flatFXMaterial(MAGNET_COLOR));
    group.add(mesh);
    return mesh;
  });

  const rings = Array.from({ length: MAGNET_RING_COUNT }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), flatFXMaterial(MAGNET_COLOR));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.045 + i * 0.005;
    group.add(mesh);
    return mesh;
  });

  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), flatFXMaterial(MAGNET_HALO));
  group.add(halo);

  return {
    group,
    time: 0,
    intensity: 0,
    update(dt, { active, captured, playerX, playerZ, ballX, ballY, ballZ, ballRadius, range }) {
      this.time += dt;
      const target = active ? 1 : 0;
      this.intensity += (target - this.intensity) * Math.min(1, dt * 12);
      if (!active && this.intensity < 0.02) {
        this.group.visible = false;
        return;
      }
      this.group.visible = true;
      const glow = this.intensity;

      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        const k = (this.time / MAGNET_RING_PERIOD + i / MAGNET_RING_COUNT) % 1;
        const radius = range * 0.95 * (1 - k) + 0.5 * k;
        ring.position.x = playerX;
        ring.position.z = playerZ;
        ring.scale.setScalar(radius);
        ring.material.opacity = glow * 0.55 * Math.sin(Math.PI * k);
      }

      const dx = playerX - ballX;
      const dz = playerZ - ballZ;
      const dist = Math.hypot(dx, dz);
      const inRange = !captured && dist > 0.001 && dist < range * 1.05;
      // Fade the waves out when the ball is nearly touching so they don't pile up.
      const waveFade = inRange ? Math.max(0, Math.min(1, (dist - 0.9) / 0.7)) : 0;
      const yaw = Math.atan2(dx, dz);

      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        const k = (this.time / MAGNET_WAVE_PERIOD + i / MAGNET_WAVE_COUNT) % 1;
        wave.position.set(
          ballX + dx * k,
          0.02,
          ballZ + dz * k
        );
        wave.rotation.y = yaw;
        wave.scale.setScalar(1.05 - 0.5 * k);
        wave.material.opacity = glow * waveFade * 0.9 * Math.sin(Math.PI * k);
      }

      if (captured) {
        halo.position.set(ballX, ballY, ballZ);
        halo.scale.setScalar(ballRadius * 1.45 * (1 + 0.12 * Math.sin(this.time * 14)));
        halo.material.opacity = glow * 0.3;
      } else {
        halo.material.opacity = 0;
      }
    },
    dispose(targetScene) {
      targetScene.remove(this.group);
      for (const mesh of [...waves, ...rings, halo]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}

const FIELD_DURATION = 0.65;
const FIELD_COLOR = new THREE.Color(0x55d9ff);
const FIELD_FLASH = new THREE.Color(0xeaffff);

// The panel flexes into the pitch around the impact and springs back.
const FIELD_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec2 uImpact;
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    vec3 p = position;
    float d = distance(position.xy, uImpact);
    float spring = 1.0 - smoothstep(0.0, 0.4, uTime);
    p.z += exp(-d * d * 3.0) * 0.2 * uStrength * spring;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// Hex-cell energy shield: whole cells pop alight as a ripple sweeps out from
// the impact point, over a white shock core, all fading toward the panel
// borders so the field never spills past the wall.
const FIELD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uDuration;
  uniform float uStrength;
  uniform vec2 uImpact;
  uniform vec2 uSize;
  uniform vec3 uColor;
  uniform vec3 uFlash;
  varying vec2 vPos;

  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, vec2(0.5, 0.8660254)), p.x);
  }

  // Returns (offset within cell, cell id) for a pointy-top hex tiling.
  vec4 hexCoords(vec2 uv) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(uv, s) - s * 0.5;
    vec2 b = mod(uv - s * 0.5, s) - s * 0.5;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, uv - gv);
  }

  void main() {
    float t = uTime / uDuration;
    float fade = (1.0 - t) * (1.0 - t);

    const float cell = 0.24;
    vec4 h = hexCoords(vPos / cell);
    vec2 cellCenter = h.zw * cell;
    float edge = smoothstep(0.36, 0.48, hexDist(h.xy));

    // Ripple front sampled per-cell so hexes light up one by one.
    float cellD = distance(cellCenter, uImpact);
    float maxR = 1.4 + 2.0 * uStrength;
    float front = maxR * (1.0 - (1.0 - t) * (1.0 - t));
    float wave = exp(-5.0 * abs(cellD - front));
    float afterglow = max(0.0, 1.0 - cellD / maxR) * 0.3;
    float cells = (wave + afterglow) * fade;

    // Un-quantized white core right where the ball struck.
    float d = distance(vPos, uImpact);
    float core = exp(-d * d * 8.0) * exp(-uTime * 9.0) * (1.0 + uStrength);

    // Soft fade at the panel borders; the geometry itself already stops at
    // the wall's real top, bottom, and ends.
    vec2 hs = uSize * 0.5;
    float border = smoothstep(0.0, 0.5, hs.x - abs(vPos.x))
                 * smoothstep(0.0, 0.1, hs.y - abs(vPos.y));

    float glow = edge * cells * (1.2 + 0.8 * uStrength) + cells * 0.12 + core;
    vec3 col = uColor * (edge * cells * (1.2 + 0.8 * uStrength) + cells * 0.12) + uFlash * core;
    gl_FragColor = vec4(col, clamp(glow, 0.0, 1.0) * border);
  }
`;

// "Force field" reveal where the ball slams into a wall: an invisible energy
// barrier flush with the wall lights up. The panel is exactly wall-height and
// clamped to the wall segment it lives on, so the effect never leaves the
// wall. opts: { x, z } panel center on the wall plane, { nx, nz } inward
// normal, width/height panel size, { impactU, impactY } impact point in panel
// local coords, strength 0..1.
export function spawnForceFieldFX(scene, { x, z, nx, nz, width, height, impactU, impactY, strength = 1 }) {
  const material = disableOutline(
    new THREE.ShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uDuration: { value: FIELD_DURATION },
        uStrength: { value: strength },
        uImpact: { value: new THREE.Vector2(impactU, impactY - height / 2) },
        uSize: { value: new THREE.Vector2(width, height) },
        uColor: { value: FIELD_COLOR },
        uFlash: { value: FIELD_FLASH },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  );

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 48, 12), material);
  mesh.name = 'ForceFieldFX';
  // Local +Z faces into the pitch; nudge off the wall so it never z-fights.
  mesh.position.set(x + nx * 0.06, height / 2, z + nz * 0.06);
  mesh.rotation.y = Math.atan2(nx, nz);
  scene.add(mesh);

  return {
    time: 0,
    update(dt) {
      this.time += dt;
      if (this.time >= FIELD_DURATION) return false;
      material.uniforms.uTime.value = this.time;
      return true;
    },
    dispose(targetScene) {
      targetScene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
