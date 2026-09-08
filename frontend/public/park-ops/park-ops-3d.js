import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

const map = document.getElementById('parkMap');
const canvas = document.createElement('canvas');
canvas.id = 'park3dCanvas';
canvas.className = 'park-3d';
canvas.setAttribute('aria-label', '园区鸟瞰图轻量三维模型');
map?.prepend(canvas);
const toggle = document.createElement('button');
toggle.id = 'park3dToggle';
toggle.type = 'button';
toggle.className = 'map-chip';
toggle.textContent = '3D 加载中';
document.getElementById('phaseFilters')?.append(toggle);
const mapNote = map?.querySelector('.mapnote');
if (mapNote) mapNote.textContent = '真实园区鸟瞰图 · 轻量 3D 地形 · 分区、楼栋号及企业名称可校准';
const headingNote = map?.closest('.park')?.querySelector('h3 small');
if (headingNote) headingNote.textContent = 'LIGHTWEIGHT 3D / EDITABLE PHASE MAP';
const state = { ready: false, enabled: true, mode: 'loading', asset: './park-aerial-relief.glb', vertices: 6528, triangles: 12730, error: '' };
window.PARK_3D = state;

function setToggle(label, disabled = false) {
  if (!toggle) return;
  toggle.textContent = label;
  toggle.disabled = disabled;
  toggle.classList.toggle('active', state.ready && state.enabled);
}

function fallBack(error) {
  state.mode = 'static-fallback';
  state.error = error instanceof Error ? error.message : String(error || 'WebGL unavailable');
  state.enabled = false;
  canvas?.remove();
  map?.classList.remove('is-3d-ready');
  setToggle('平面实景', true);
  window.dispatchEvent(new CustomEvent('park3d:error', { detail: state.error }));
}

if (!map) {
  fallBack('3D canvas is missing');
} else {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    fallBack(error);
  }

  if (renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071522);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    const sky = new THREE.HemisphereLight(0xdaf5ff, 0x06121d, 2.05);
    const movingLight = new THREE.DirectionalLight(0xffffff, 1.65);
    movingLight.position.set(-1.8, -1.2, 2.8);
    scene.add(sky, movingLight);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const sourceAspect = 1280 / 884;
    const coverZoom = 1.055;
    function resize() {
      const width = Math.max(1, map.clientWidth);
      const height = Math.max(1, map.clientHeight);
      const viewportAspect = width / height;
      let halfWidth;
      let halfHeight;
      if (viewportAspect >= sourceAspect) {
        halfWidth = sourceAspect / coverZoom;
        halfHeight = sourceAspect / viewportAspect / coverZoom;
      } else {
        halfHeight = 1 / coverZoom;
        halfWidth = viewportAspect / coverZoom;
      }
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(map);

    function applySceneLighting() {
      const mode = document.body.dataset.scene || 'day';
      if (mode === 'night') {
        sky.intensity = 1.05;
        sky.color.set(0x91baff);
        movingLight.intensity = 0.75;
        movingLight.color.set(0x91c7ff);
        renderer.toneMappingExposure = 0.72;
      } else if (mode === 'dusk') {
        sky.intensity = 1.55;
        sky.color.set(0xffd0a5);
        movingLight.intensity = 1.05;
        movingLight.color.set(0xffad72);
        renderer.toneMappingExposure = 0.9;
      } else {
        sky.intensity = 2.05;
        sky.color.set(0xdaf5ff);
        movingLight.intensity = 1.65;
        movingLight.color.set(0xffffff);
        renderer.toneMappingExposure = 1.08;
      }
    }
    applySceneLighting();
    new MutationObserver(applySceneLighting).observe(document.body, { attributes: true, attributeFilter: ['data-scene'] });

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let model = null;
    let frame = 0;
    const clock = new THREE.Clock();
    function render() {
      frame = requestAnimationFrame(render);
      if (document.hidden || !state.enabled || !state.ready) return;
      if (!reducedMotion) {
        const t = clock.getElapsedTime();
        movingLight.position.x = Math.sin(t * 0.14) * 2.25;
        movingLight.position.y = Math.cos(t * 0.11) * 1.45;
        if (model) model.position.z = Math.sin(t * 0.18) * 0.0025;
      }
      renderer.render(scene, camera);
    }
    render();

    new GLTFLoader().load(
      './park-aerial-relief.glb?v=20260908-light-3d',
      (gltf) => {
        model = gltf.scene;
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.frustumCulled = false;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material?.map) {
              material.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
              material.map.needsUpdate = true;
            }
          }
        });
        scene.add(model);
        state.ready = true;
        state.mode = '3d-relief';
        map.classList.add('is-3d-ready');
        setToggle('3D 实景');
        renderer.render(scene, camera);
        window.dispatchEvent(new CustomEvent('park3d:ready', { detail: state }));
      },
      undefined,
      fallBack,
    );

    toggle?.addEventListener('click', () => {
      if (!state.ready) return;
      state.enabled = !state.enabled;
      map.classList.toggle('is-3d-disabled', !state.enabled);
      setToggle(state.enabled ? '3D 实景' : '平面实景');
      if (state.enabled) renderer.render(scene, camera);
    });

    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.dispose();
    }, { once: true });
  }
}
