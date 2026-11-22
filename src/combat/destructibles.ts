import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { scene } from '../core/renderer';
import { activeDebris, destructibleProps, game } from '../game/state';
import type { Collider, DestructibleProp } from '../types';
import { shakeScreenFromExplosion } from '../ui/feedback';
import { aabbDistanceToPoint } from '../world/collision';
import { removeCollider } from '../world/collisionWorld';
import type { CompiledCollider } from '../world/def/compile';

export function spawnDebris(center: THREE.Vector3, count: number, radius = 0.3, speed = 5): void {
  const palette = [0x475569, 0x64748b, 0x1e3a8a, 0x365314, 0x7f1d1d];
  for (let i = 0; i < count; i++) {
    const size = radius * (0.45 + Math.random() * 0.95);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({
        color: palette[Math.floor(Math.random() * palette.length)],
        roughness: 0.72,
        metalness: 0.2,
      }),
    );
    mesh.position
      .copy(center)
      .add(new THREE.Vector3((Math.random() - 0.5) * 0.7, Math.random() * 0.7, (Math.random() - 0.5) * 0.7));
    mesh.castShadow = true;
    scene.add(mesh);
    activeDebris.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.85 + 1.5,
        (Math.random() - 0.5) * speed,
      ),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      life: 1.4 + Math.random() * 0.9,
    });
  }
}

function destroyDestructible(
  prop: DestructibleProp | undefined,
  sourcePos: THREE.Vector3 | null = null,
): void {
  if (!prop || prop.destroyed) return;
  prop.destroyed = true;
  if (prop.radar) prop.radar.destroyed = true;
  removeCollider(prop.collider);
  // Open the route for bots: the matching dynamic nav obstacle is removed and affected tiles rebuild.
  game.navWorld?.removeObstacle(prop.collider as CompiledCollider);
  if (prop.mesh.parent) prop.mesh.parent.remove(prop.mesh);
  const center = new THREE.Vector3(
    (prop.collider.minX + prop.collider.maxX) * 0.5,
    (prop.collider.minY + prop.collider.maxY) * 0.5,
    (prop.collider.minZ + prop.collider.maxZ) * 0.5,
  );
  spawnDebris(center, 14, 0.22, 7);
  sfx.playExplosion(center);
  if (sourcePos) shakeScreenFromExplosion(sourcePos || center, 0.5);
}

export function damageDestructible(
  collider: Collider,
  amount: number,
  sourcePos: THREE.Vector3 | null = null,
): boolean {
  const prop = destructibleProps.find((item) => item.collider === collider && !item.destroyed);
  if (!prop) return false;
  prop.hp -= amount;
  const health = THREE.MathUtils.clamp(prop.hp / prop.maxHp, 0, 1);
  const material = prop.mesh.material as THREE.MeshStandardMaterial;
  if (material) {
    material.emissive.setRGB(0.22 * (1 - health), 0.05 * (1 - health), 0.02 * (1 - health));
    material.emissiveIntensity = 1;
  }
  if (prop.hp <= 0) {
    destroyDestructible(prop, sourcePos);
    return true;
  }
  return false;
}

export function damageDestructiblesInRadius(center: THREE.Vector3, radius: number, damage: number): void {
  for (const prop of destructibleProps) {
    if (prop.destroyed) continue;
    const dist = aabbDistanceToPoint(prop.collider, center);
    if (dist >= radius) continue;
    damageDestructible(prop.collider, damage * (1 - (dist / radius) * 0.55), center);
  }
}

export function damageDestructibleNearPoint(pos: THREE.Vector3, amount: number): void {
  for (const prop of destructibleProps) {
    if (prop.destroyed) continue;
    if (aabbDistanceToPoint(prop.collider, pos) <= 0.32) {
      damageDestructible(prop.collider, amount, pos);
    }
  }
}
