import * as THREE from 'three';
import { $ } from '../util/dom';

export const canvas = $<HTMLCanvasElement>('game-canvas');

export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.localClippingEnabled = true;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x162235);
scene.fog = new THREE.FogExp2(0x162235, 0.0075);

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 260);
scene.add(camera);

// Tactical Daylight / Overcast Military Compound Lighting
const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.95);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
sunLight.position.set(38, 62, 28);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 5;
sunLight.shadow.camera.far = 165;
const SHADOW_EXTENT = 62;
sunLight.shadow.camera.left = -SHADOW_EXTENT;
sunLight.shadow.camera.right = SHADOW_EXTENT;
sunLight.shadow.camera.top = SHADOW_EXTENT;
sunLight.shadow.camera.bottom = -SHADOW_EXTENT;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// Team Base Accent Lights
export const alphaBaseLight = new THREE.PointLight(0x3b82f6, 3.2, 28);
alphaBaseLight.position.set(0, 5.5, 40);
scene.add(alphaBaseLight);

export const bravoBaseLight = new THREE.PointLight(0xef4444, 3.2, 28);
bravoBaseLight.position.set(0, 5.5, -40);
scene.add(bravoBaseLight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
});
