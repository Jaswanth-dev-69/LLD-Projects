import { create } from 'zustand';
import type { Settings } from './settings';
import type { Progress } from './save';
import type { WeaponId } from '../weapons/weaponDefs';

export type Screen =
  | 'boot'
  | 'error'
  | 'menu'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'dead'
  | 'missionComplete'
  | 'campaignComplete'
  | 'cinematic';

export type MenuPanel = 'main' | 'missions' | 'settings' | 'controls' | 'credits';

export interface HudSnapshot {
  health: number;
  maxHealth: number;
  armor: number;
  weapon: WeaponId;
  weaponName: string;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  owned: WeaponId[];
  missionName: string;
  objective: string;
  objectiveProgress: string;
  interactPrompt: string | null;
  inVehicle: boolean;
  speedKmh: number;
  crouched: boolean;
  aiming: boolean;
  combat: boolean;
  enemiesRemaining: number;
  timer: string | null;
  collectibles: number;
  collectiblesTotal: number;
  freeRoam: boolean;
}

export interface Notification {
  id: number;
  title: string;
  subtitle?: string;
  kind: 'mission' | 'objective' | 'info' | 'danger';
}

export interface RadioLine {
  id: number;
  speaker: string;
  text: string;
}

export interface MissionResult {
  missionId: string;
  missionIndex: number;
  title: string;
  time: number;
  kills: number;
  headshots: number;
  accuracy: number;
  damageTaken: number;
  bestTime: number | null;
  nextMissionIndex: number | null;
}

export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  resolutionScale: number;
  enemiesActive: number;
}

export const EMPTY_HUD: HudSnapshot = {
  health: 100,
  maxHealth: 100,
  armor: 0,
  weapon: 'rifle',
  weaponName: '',
  mag: 0,
  magSize: 0,
  reserve: 0,
  reloading: false,
  owned: [],
  missionName: '',
  objective: '',
  objectiveProgress: '',
  interactPrompt: null,
  inVehicle: false,
  speedKmh: 0,
  crouched: false,
  aiming: false,
  combat: false,
  enemiesRemaining: 0,
  timer: null,
  collectibles: 0,
  collectiblesTotal: 0,
  freeRoam: false,
};

interface UIState {
  screen: Screen;
  menuPanel: MenuPanel;
  bootProgress: number;
  bootStatus: string;
  errorMessage: string;
  settings: Settings | null;
  progress: Progress | null;
  hud: HudSnapshot;
  notifications: Notification[];
  radio: RadioLine | null;
  hint: string | null;
  missionResult: MissionResult | null;
  deathReason: string;
  perf: PerfStats;
  pointerLocked: boolean;
  showClickToPlay: boolean;
  loadingTitle: string;
  loadingSubtitle: string;
  saveRecovered: boolean;
  set: (partial: Partial<Omit<UIState, 'set'>>) => void;
}

export const useUI = create<UIState>((set) => ({
  screen: 'boot',
  menuPanel: 'main',
  bootProgress: 0,
  bootStatus: 'Initializing',
  errorMessage: '',
  settings: null,
  progress: null,
  hud: EMPTY_HUD,
  notifications: [],
  radio: null,
  hint: null,
  missionResult: null,
  deathReason: '',
  perf: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, resolutionScale: 1, enemiesActive: 0 },
  pointerLocked: false,
  showClickToPlay: false,
  loadingTitle: '',
  loadingSubtitle: '',
  saveRecovered: false,
  set: (partial) => set(partial),
}));

let notifySeq = 1;
export function pushNotification(n: Omit<Notification, 'id'>, ttl = 4200): void {
  const id = notifySeq++;
  const note: Notification = { id, ...n };
  useUI.setState((s) => ({ notifications: [...s.notifications.slice(-2), note] }));
  window.setTimeout(() => {
    useUI.setState((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) }));
  }, ttl);
}

let radioSeq = 1;
let radioTimer = 0;
export function showRadio(speaker: string, text: string, duration: number): void {
  const id = radioSeq++;
  useUI.setState({ radio: { id, speaker, text } });
  window.clearTimeout(radioTimer);
  radioTimer = window.setTimeout(() => {
    useUI.setState((s) => (s.radio?.id === id ? { radio: null } : {}));
  }, duration * 1000);
}

let hintTimer = 0;
export function showHint(text: string, duration = 5): void {
  useUI.setState({ hint: text });
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => useUI.setState({ hint: null }), duration * 1000);
}

export function clearTransientUI(): void {
  window.clearTimeout(radioTimer);
  window.clearTimeout(hintTimer);
  useUI.setState({ notifications: [], radio: null, hint: null });
}
