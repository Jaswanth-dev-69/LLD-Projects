import * as THREE from 'three';

export interface Interactable {
  /** Unique id (re-registering the same id replaces the old entry). */
  id: string;
  position: THREE.Vector3;
  /** Max horizontal distance from the player's feet. */
  radius: number;
  /** HUD text after "[E]". */
  prompt: string | (() => string);
  /** Return false to temporarily hide/disable. */
  enabled?: () => boolean;
  onInteract: () => void;
  /** Higher wins when several are in range. */
  priority?: number;
  /** Mission-scoped entries are removed by clear('mission'). */
  scope?: 'mission' | 'world';
}

/**
 * Registry of "[E] to interact" targets. Game calls update() with the player's position/facing
 * every frame; the best candidate is exposed for the HUD and triggered on the E key.
 */
export class Interactions {
  private items = new Map<string, Interactable>();
  current: Interactable | null = null;
  currentPrompt: string | null = null;

  register(i: Interactable): void {
    this.items.set(i.id, i);
  }

  unregister(id: string): void {
    this.items.delete(id);
    if (this.current?.id === id) {
      this.current = null;
      this.currentPrompt = null;
    }
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  clear(scope: 'mission' | 'all' = 'all'): void {
    if (scope === 'all') this.items.clear();
    else for (const [id, i] of this.items) if ((i.scope ?? 'mission') === 'mission') this.items.delete(id);
    this.current = null;
    this.currentPrompt = null;
  }

  /**
   * Pick the best interactable near `pos`. `forward` (horizontal, normalized) biases toward
   * what the player is facing. Returns true when `pressed` triggered an interaction.
   */
  update(pos: THREE.Vector3, forward: THREE.Vector3, pressed: boolean, allowed: boolean): boolean {
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    if (allowed) {
      for (const i of this.items.values()) {
        if (i.enabled && !i.enabled()) continue;
        const dx = i.position.x - pos.x, dz = i.position.z - pos.z;
        const dy = Math.abs(i.position.y - (pos.y + 1));
        const d = Math.hypot(dx, dz);
        if (d > i.radius || dy > 2.2) continue;
        const facing = d > 0.01 ? (dx * forward.x + dz * forward.z) / d : 1;
        const score = (i.priority ?? 0) * 10 - d + facing * 0.75;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    this.current = best;
    this.currentPrompt = best ? (typeof best.prompt === 'function' ? best.prompt() : best.prompt) : null;
    if (best && pressed) {
      best.onInteract();
      return true;
    }
    return false;
  }
}
