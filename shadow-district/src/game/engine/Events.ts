import type * as THREE from 'three';
import type { WeaponId } from '../weapons/weaponDefs';

/** All gameplay events flowing through the bus. Payloads are plain data. */
export interface GameEvents {
  shotFired: { by: 'player' | 'enemy'; position: THREE.Vector3; weapon: WeaponId; loudness: number };
  enemyDamaged: { enemyId: number; amount: number; headshot: boolean; killed: boolean };
  enemyKilled: { enemyId: number; tag: string; headshot: boolean; position: THREE.Vector3 };
  enemyAlerted: { enemyId: number };
  playerDamaged: { amount: number; from: THREE.Vector3 | null; health: number };
  playerDied: Record<string, never>;
  pickupCollected: { kind: string; id: string };
  interact: { id: string };
  objectiveUpdated: Record<string, never>;
  missionComplete: { missionId: string };
  missionFailed: { missionId: string; reason: string };
  explosion: { position: THREE.Vector3; radius: number };
  zoneEntered: { id: string };
  radio: { speaker: string; text: string; duration: number };
  notify: { title: string; subtitle?: string; kind?: 'mission' | 'objective' | 'info' | 'danger' };
  hint: { text: string; duration?: number };
  vehicleEnter: Record<string, never>;
  vehicleExit: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(type, handler);
  }

  off<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of Array.from(set)) {
      try {
        (h as Handler<GameEvents[K]>)(payload);
      } catch (err) {
        console.error(`[events] handler for ${String(type)} failed`, err);
      }
    }
  }

  listenerCount(): number {
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }

  clear(): void {
    this.handlers.clear();
  }
}
