import { defaultSettings, type Settings, type QualityPreset, type Difficulty, type ShadowQuality } from './settings';

export const SAVE_KEY = 'shadow-district/save';
export const SAVE_VERSION = 2;

export interface Progress {
  /** Highest mission index (0-based) that is unlocked. */
  unlockedMission: number;
  completed: string[];
  collectibles: string[];
  bestTimes: Record<string, number>;
  campaignComplete: boolean;
}

export interface SaveFile {
  version: number;
  settings: Settings;
  progress: Progress;
}

export function defaultProgress(): Progress {
  return { unlockedMission: 0, completed: [], collectibles: [], bestTimes: {}, campaignComplete: false };
}

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
function oneOf<T extends string>(v: unknown, options: readonly T[], def: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : def;
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Validate untrusted data from storage, falling back to defaults field-by-field. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const r = obj(raw);
  const g = obj(r.graphics);
  const a = obj(r.audio);
  const c = obj(r.controls);
  const p = obj(r.gameplay);
  return {
    graphics: {
      preset: oneOf<QualityPreset | 'custom'>(g.preset, ['low', 'medium', 'high', 'custom'], d.graphics.preset),
      resolutionScale: num(g.resolutionScale, d.graphics.resolutionScale, 0.5, 1),
      adaptiveResolution: bool(g.adaptiveResolution, d.graphics.adaptiveResolution),
      shadows: oneOf<ShadowQuality>(g.shadows, ['off', 'low', 'high'], d.graphics.shadows),
      bloom: bool(g.bloom, d.graphics.bloom),
      ambientOcclusion: bool(g.ambientOcclusion, d.graphics.ambientOcclusion),
      antialiasing: bool(g.antialiasing, d.graphics.antialiasing),
      weatherEffects: bool(g.weatherEffects, d.graphics.weatherEffects),
      viewDistance: num(g.viewDistance, d.graphics.viewDistance, 0.5, 1.5),
      fov: num(g.fov, d.graphics.fov, 55, 95),
      cameraShake: num(g.cameraShake, d.graphics.cameraShake, 0, 1),
      dynamicLights: Math.round(num(g.dynamicLights, d.graphics.dynamicLights, 0, 8)),
    },
    audio: {
      master: num(a.master, d.audio.master, 0, 1),
      sfx: num(a.sfx, d.audio.sfx, 0, 1),
      music: num(a.music, d.audio.music, 0, 1),
      ambience: num(a.ambience, d.audio.ambience, 0, 1),
    },
    controls: {
      sensitivity: num(c.sensitivity, d.controls.sensitivity, 0.2, 3),
      adsSensitivity: num(c.adsSensitivity, d.controls.adsSensitivity, 0.2, 1.5),
      invertY: bool(c.invertY, d.controls.invertY),
      cameraDistance: num(c.cameraDistance, d.controls.cameraDistance, 2.2, 5.5),
    },
    gameplay: {
      difficulty: oneOf<Difficulty>(p.difficulty, ['easy', 'normal', 'hard'], d.gameplay.difficulty),
      showFps: bool(p.showFps, d.gameplay.showFps),
      showMinimap: bool(p.showMinimap, d.gameplay.showMinimap),
      subtitles: bool(p.subtitles, d.gameplay.subtitles),
      hitMarkers: bool(p.hitMarkers, d.gameplay.hitMarkers),
    },
  };
}

export function sanitizeProgress(raw: unknown, missionCount: number): Progress {
  const d = defaultProgress();
  const r = obj(raw);
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.length < 64))) : [];
  const times: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.bestTimes))) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) times[k] = v;
  }
  return {
    unlockedMission: Math.round(num(r.unlockedMission, d.unlockedMission, 0, Math.max(0, missionCount - 1))),
    completed: strings(r.completed),
    collectibles: strings(r.collectibles),
    bestTimes: times,
    campaignComplete: bool(r.campaignComplete, false),
  };
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__sd_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadSave(missionCount: number): { save: SaveFile; recovered: boolean } {
  const s = storage();
  const fresh: SaveFile = { version: SAVE_VERSION, settings: defaultSettings(), progress: defaultProgress() };
  if (!s) return { save: fresh, recovered: false };
  const text = s.getItem(SAVE_KEY);
  if (!text) return { save: fresh, recovered: false };
  try {
    const parsed = obj(JSON.parse(text));
    // Older/newer versions: keep whatever validates, default the rest.
    return {
      save: {
        version: SAVE_VERSION,
        settings: sanitizeSettings(parsed.settings),
        progress: sanitizeProgress(parsed.progress, missionCount),
      },
      recovered: parsed.version !== SAVE_VERSION,
    };
  } catch (err) {
    console.warn('[save] corrupted save data, resetting', err);
    return { save: fresh, recovered: true };
  }
}

export function writeSave(save: SaveFile): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify({ ...save, version: SAVE_VERSION }));
    return true;
  } catch (err) {
    console.warn('[save] failed to write save', err);
    return false;
  }
}
