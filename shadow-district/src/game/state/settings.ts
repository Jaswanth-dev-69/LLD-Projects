export type QualityPreset = 'low' | 'medium' | 'high';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type ShadowQuality = 'off' | 'low' | 'high';

export interface GraphicsSettings {
  preset: QualityPreset | 'custom';
  resolutionScale: number;
  adaptiveResolution: boolean;
  shadows: ShadowQuality;
  bloom: boolean;
  ambientOcclusion: boolean;
  antialiasing: boolean;
  weatherEffects: boolean;
  viewDistance: number;
  fov: number;
  cameraShake: number;
  dynamicLights: number;
}

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  ambience: number;
}

export interface ControlSettings {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  cameraDistance: number;
}

export interface GameplaySettings {
  difficulty: Difficulty;
  showFps: boolean;
  showMinimap: boolean;
  subtitles: boolean;
  hitMarkers: boolean;
}

export interface Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  gameplay: GameplaySettings;
}

export const GRAPHICS_PRESETS: Record<QualityPreset, Omit<GraphicsSettings, 'preset' | 'fov' | 'cameraShake'>> = {
  low: {
    resolutionScale: 0.75,
    adaptiveResolution: true,
    shadows: 'low',
    bloom: false,
    ambientOcclusion: false,
    antialiasing: false,
    weatherEffects: false,
    viewDistance: 0.7,
    dynamicLights: 2,
  },
  medium: {
    resolutionScale: 1,
    adaptiveResolution: true,
    shadows: 'low',
    bloom: true,
    ambientOcclusion: false,
    antialiasing: true,
    weatherEffects: true,
    viewDistance: 1,
    dynamicLights: 4,
  },
  high: {
    resolutionScale: 1,
    adaptiveResolution: true,
    shadows: 'high',
    bloom: true,
    ambientOcclusion: true,
    antialiasing: true,
    weatherEffects: true,
    viewDistance: 1.3,
    dynamicLights: 8,
  },
};

export function defaultSettings(): Settings {
  return {
    graphics: { preset: 'medium', fov: 70, cameraShake: 0.7, ...GRAPHICS_PRESETS.medium },
    audio: { master: 0.8, sfx: 0.85, music: 0.5, ambience: 0.7 },
    controls: { sensitivity: 1, adsSensitivity: 0.65, invertY: false, cameraDistance: 3.4 },
    gameplay: { difficulty: 'normal', showFps: false, showMinimap: true, subtitles: true, hitMarkers: true },
  };
}

export function applyPreset(g: GraphicsSettings, preset: QualityPreset): GraphicsSettings {
  return { ...g, ...GRAPHICS_PRESETS[preset], preset };
}

export const DIFFICULTY_TUNING: Record<Difficulty, {
  enemyHealth: number;
  enemyDamage: number;
  enemyAccuracy: number;
  reactionTime: number;
  label: string;
}> = {
  easy: { enemyHealth: 0.8, enemyDamage: 0.55, enemyAccuracy: 0.7, reactionTime: 1.45, label: 'Easy' },
  normal: { enemyHealth: 1, enemyDamage: 1, enemyAccuracy: 1, reactionTime: 1, label: 'Normal' },
  hard: { enemyHealth: 1.25, enemyDamage: 1.4, enemyAccuracy: 1.25, reactionTime: 0.7, label: 'Hard' },
};
