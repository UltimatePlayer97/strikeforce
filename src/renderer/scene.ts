import * as THREE from 'three';

let canvas: HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;

let hemiLight: THREE.HemisphereLight;
let sunLight: THREE.DirectionalLight;
let alphaBaseLight: THREE.PointLight;
let bravoBaseLight: THREE.PointLight;

export function initRenderer(canvasElement: HTMLCanvasElement): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  canvas = canvasElement;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x162235);
  scene.fog = new THREE.FogExp2(0x162235, 0.0075);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 260);
  scene.add(camera);

  hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.95);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
  sunLight.position.set(38, 62, 28);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 5;
  sunLight.shadow.camera.far = 165;
  const d = 62;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  alphaBaseLight = new THREE.PointLight(0x3b82f6, 3.2, 28);
  alphaBaseLight.position.set(0, 5.5, 40);
  scene.add(alphaBaseLight);

  bravoBaseLight = new THREE.PointLight(0xef4444, 3.2, 28);
  bravoBaseLight.position.set(0, 5.5, -40);
  scene.add(bravoBaseLight);

  window.addEventListener('resize', onResize);

  return { renderer, scene, camera };
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

export function getRenderer(): THREE.WebGLRenderer { return renderer; }
export function getScene(): THREE.Scene { return scene; }
export function getCamera(): THREE.PerspectiveCamera { return camera; }
export function getSunLight(): THREE.DirectionalLight { return sunLight; }
export function getAlphaBaseLight(): THREE.PointLight { return alphaBaseLight; }
export function getBravoBaseLight(): THREE.PointLight { return bravoBaseLight; }

export function setCameraFov(fov: number): void {
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

export function dispose(): void {
  window.removeEventListener('resize', onResize);
  renderer.dispose();
}