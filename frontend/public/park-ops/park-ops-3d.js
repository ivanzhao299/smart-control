import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

const map = document.getElementById('parkMap');
const mapPage = map?.closest('.page');
const spatialSelectors = ['.aerial', '.window-lights', '.map-svg', '#phaseFlagLayer', '#buildingLayer', '#customTextLayer'];
const sceneRoot = document.createElement('div');
sceneRoot.className = 'map-scene';
sceneRoot.setAttribute('aria-label', '可旋转园区空间层');
for (const selector of spatialSelectors) {
  const layer = map?.querySelector(selector);
  if (layer) sceneRoot.appendChild(layer);
}
map?.prepend(sceneRoot);

const canvas = document.createElement('canvas');
canvas.id = 'park3dCanvas';
canvas.className = 'park-3d';
canvas.setAttribute('aria-label', '园区鸟瞰图轻量三维模型');
sceneRoot.prepend(canvas);

const controls = document.createElement('div');
controls.id = 'parkViewControls';
controls.className = 'toolbar-group map-view-controls';
controls.setAttribute('aria-label', '园区模型视角');
controls.innerHTML = `
  <span class="view-label">模型显示</span>
  <button id="park3dToggle" type="button" class="map-chip">3D 加载中</button>`;
map?.appendChild(controls);
const toggle = controls.querySelector('#park3dToggle');

const mapNote = map?.querySelector('.mapnote');
if (mapNote) mapNote.textContent = '低功耗轻量 3D · 正向俯视 · 分区、楼栋和文字可校准';
const headingNote = map?.closest('.park')?.querySelector('h3 small');
if (headingNote) headingNote.textContent = 'LOW-POWER 3D / EDITABLE PHASE MAP';

const state = {
  ready: false,
  enabled: true,
  mode: 'loading',
  asset: './park-aerial-relief.glb',
  vertices: 6528,
  triangles: 12730,
  error: '',
  fpsCap: 8,
  renderScale: 0.82,
  perspective: false,
  rotation: 0,
  calibrationMode: false,
};
window.PARK_3D = state;

function setToggle(label, disabled = false) {
  if (!toggle) return;
  toggle.textContent = label;
  toggle.disabled = disabled;
  toggle.classList.toggle('active', state.ready && state.enabled);
}

function applyView() {
  state.calibrationMode = document.body.classList.contains('park-editing');
  map?.classList.remove('view-perspective', 'view-reversed');
  if (mapNote) {
    mapNote.textContent = state.calibrationMode
      ? '校准模式 · 正向俯视图，拖动端点和文字即可精确定位'
      : '低功耗轻量 3D · 正向俯视 · 分区、楼栋和文字可校准';
  }
}
applyView();

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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
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

    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const sourceAspect = 1280 / 884;
    const coverZoom = 1.055;
    let model = null;
    let timer = 0;
    let disposed = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const interval = Math.round(1000 / state.fpsCap);

    function isVisible() {
      return !document.hidden && state.enabled && state.ready && (!mapPage || mapPage.classList.contains('active'));
    }

    function renderOnce(animateLight = false) {
      if (!state.ready || disposed) return;
      if (animateLight && !reducedMotion) {
        const t = performance.now() / 1000;
        movingLight.position.x = Math.sin(t * 0.14) * 2.25;
        movingLight.position.y = Math.cos(t * 0.11) * 1.45;
      }
      renderer.render(scene, camera);
    }

    function scheduleRender() {
      if (disposed || reducedMotion) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (isVisible()) renderOnce(true);
        scheduleRender();
      }, isVisible() ? interval : 750);
    }

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
      renderer.setSize(Math.round(width * state.renderScale), Math.round(height * state.renderScale), false);
      renderOnce();
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
      renderOnce();
    }
    applySceneLighting();
    const bodyObserver = new MutationObserver((records) => {
      if (records.some(record => record.attributeName === 'data-scene')) applySceneLighting();
      if (records.some(record => record.attributeName === 'class')) {
        applyView();
        renderOnce();
      }
    });
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['data-scene', 'class'] });
    const pageObserver = mapPage ? new MutationObserver(() => {
      if (mapPage.classList.contains('active')) renderOnce();
    }) : null;
    pageObserver?.observe(mapPage, { attributes: true, attributeFilter: ['class'] });

    new GLTFLoader().load(
      './park-aerial-relief.glb?v=20260908-camera-hotfix',
      (gltf) => {
        model = gltf.scene;
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.frustumCulled = false;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material?.map) {
              material.map.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
              material.map.needsUpdate = true;
            }
          }
        });
        scene.add(model);
        state.ready = true;
        state.mode = '3d-relief-low-power';
        map.classList.add('is-3d-ready');
        setToggle('3D 实景');
        resize();
        renderOnce();
        scheduleRender();
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
      if (state.enabled) renderOnce();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderOnce();
    });

    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      disposed = true;
      clearTimeout(timer);
      resizeObserver.disconnect();
      bodyObserver.disconnect();
      pageObserver?.disconnect();
      renderer.dispose();
    }, { once: true });
  }
}
