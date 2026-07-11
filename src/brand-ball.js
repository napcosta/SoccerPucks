import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { toonifyObject } from './toon.js';

const canvas = document.getElementById('brand-ball-canvas');
const stage = canvas?.closest('.brand-ball-stage');

if (canvas && stage) {
  renderGameBall(canvas, stage).catch((error) => {
    stage.classList.add('is-failed');
    console.warn('Could not render the Soccer Pucks logo ball.', error);
  });
}

async function renderGameBall(target, targetStage) {
  const renderer = new THREE.WebGLRenderer({
    canvas: target,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(384, 320, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const outlineEffect = new OutlineEffect(renderer, {
    defaultThickness: 0.0032,
    defaultColor: [0.035, 0.045, 0.065],
    defaultAlpha: 0.92,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(25, 384 / 320, 0.01, 100);
  camera.position.set(0, 2.7, 5.7);
  camera.lookAt(0, -0.05, 0);

  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x32281e, 1.25));

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.35);
  sun.position.set(4, 7, 6);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8aa8ff, 0.72);
  fill.position.set(-5, 4, -3);
  scene.add(fill);

  const gltf = await new GLTFLoader().loadAsync('assets/ball.glb');
  const ball = toonifyObject(gltf.scene);
  const ballPose = new THREE.Group();
  ballPose.rotation.x = THREE.MathUtils.degToRad(24);
  ballPose.rotation.y = THREE.MathUtils.degToRad(-11);
  ballPose.rotation.z = THREE.MathUtils.degToRad(-6);
  ballPose.add(ball);
  scene.add(ballPose);

  ball.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(ball);
  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  // The larger transparent canvas stage needs genuine render padding. Scaling
  // the model down here (while the CSS stage grows proportionally) keeps its
  // apparent page size but prevents WebGL from cutting off the tilted rim.
  ball.scale.setScalar(2.45 / Math.max(sourceSize.x, sourceSize.y, sourceSize.z));
  ball.updateMatrixWorld(true);

  const scaledCenter = new THREE.Box3().setFromObject(ball).getCenter(new THREE.Vector3());
  ball.position.sub(scaledCenter);
  ball.updateMatrixWorld(true);

  const mixer = new THREE.AnimationMixer(ball);
  const idle = THREE.AnimationClip.findByName(gltf.animations, 'Default');
  const blink = THREE.AnimationClip.findByName(gltf.animations, 'Blink');
  const tired = THREE.AnimationClip.findByName(gltf.animations, 'Tired');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduceMotion) {
    if (idle) mixer.clipAction(idle).play();
    scheduleExpressions({
      blinkAction: blink ? mixer.clipAction(blink) : null,
      tiredAction: tired ? mixer.clipAction(tired) : null,
      isVisible: () => target.offsetParent !== null && !document.hidden,
    });
  }

  outlineEffect.render(scene, camera);
  targetStage.classList.add('is-ready');

  if (reduceMotion) return;

  const clock = new THREE.Clock();
  function frame() {
    if (target.offsetParent !== null && !document.hidden) {
      mixer.update(Math.min(clock.getDelta(), 0.05));
      outlineEffect.render(scene, camera);
    } else {
      clock.getDelta();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function scheduleExpressions({ blinkAction, tiredAction, isVisible }) {
  const playOnce = (action, timeScale = 1) => {
    if (!action) return 0;
    action.stop();
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = false;
    action.setLoop(THREE.LoopOnce, 1);
    action.timeScale = timeScale;
    action.play();
    return (action.getClip().duration / timeScale) * 1000;
  };

  const scheduleBlink = (delay = randomBetween(6500, 10500)) => {
    window.setTimeout(() => {
      if (isVisible()) {
        const blinkDuration = playOnce(blinkAction, 1.1);
        if (blinkDuration && Math.random() < 0.22) {
          window.setTimeout(() => playOnce(blinkAction, 1.25), blinkDuration + randomBetween(90, 180));
        }
      }
      scheduleBlink(randomBetween(7500, 14500));
    }, delay);
  };

  const scheduleTired = (delay = randomBetween(18000, 28000)) => {
    window.setTimeout(() => {
      if (isVisible()) playOnce(tiredAction, randomBetween(0.72, 0.92));
      scheduleTired(randomBetween(22000, 38000));
    }, delay);
  };

  if (blinkAction) scheduleBlink();
  if (tiredAction) scheduleTired();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
