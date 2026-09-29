/**
 * Client state: a tiny external store (useSyncExternalStore) so the render loop and React share
 * one source of truth without re-rendering on every frame.
 */
import { useSyncExternalStore } from 'react';
import type { Bootstrap, PublicConfig, PublicMember } from '@shared/api';
import type { OrgEvent } from '@shared/domain/types';
import type { DirectoryEntry, KnockKind, Occupant } from '@shared/protocol';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'celebrate' | 'social';
  action?: { label: string; run: () => void };
}

export interface IncomingKnock {
  knockId: string;
  fromId: string;
  kind: KnockKind;
  at: number;
}

export type Selection =
  | { kind: 'member'; id: string; x: number; y: number }
  | { kind: 'object'; sceneId: string; objectId: string; x: number; y: number };

export type Panel = 'search' | 'people' | 'avatar' | 'profile' | null;

export interface Prefs {
  reducedMotion: boolean;
  highContrast: boolean;
  showAllNames: boolean;
  sidebarOpen: boolean;
  /** Little synthesized sound effects (off by default). */
  sound?: boolean;
  /** 0–1, default 0.5. */
  soundVolume?: number;
  /** Keep the town in daylight instead of following my clock. */
  alwaysDay?: boolean;
}

export interface State {
  config: PublicConfig | null;
  boot: Bootstrap | null;
  membersById: Map<string, PublicMember>;
  phase: 'loading' | 'landing' | 'world';
  view: 'world' | 'admin';
  connection: 'connecting' | 'online' | 'reconnecting';
  sceneId: string | null;
  occupants: Record<string, Occupant>;
  directory: Record<string, DirectoryEntry>;
  events: OrgEvent[];
  selection: Selection | null;
  panel: Panel;
  toasts: Toast[];
  knocks: IncomingKnock[];
  greeted: string[];
  dismissed: string[];
  quests: Record<string, boolean>;
  waves: number;
  tour: { active: boolean; step: number } | null;
  welcomeOpen: boolean;
  prefs: Prefs;
  hoverLabel: string | null;
  inDiscord: boolean;
  announce: string;
  /** Decorate mode: which catalog item is selected (null = remove mode). */
  decorate: { itemId: string | null } | null;
  authError: string | null;
}

const reducedDefault = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const wide = typeof innerWidth === 'number' ? innerWidth > 900 : true;

function loadPrefs(): Prefs {
  const base = { reducedMotion: reducedDefault, highContrast: false, showAllNames: false, sidebarOpen: wide };
  try {
    const p = JSON.parse(localStorage.getItem('mw.prefs') ?? '{}');
    return { ...base, ...p, ...(wide ? {} : { sidebarOpen: false }) };
  } catch {
    return base;
  }
}

let state: State = {
  config: null,
  boot: null,
  membersById: new Map(),
  phase: 'loading',
  view: location.hash === '#/admin' ? 'admin' : 'world',
  connection: 'connecting',
  sceneId: null,
  occupants: {},
  directory: {},
  events: [],
  selection: null,
  panel: null,
  toasts: [],
  knocks: [],
  greeted: [],
  dismissed: [],
  quests: {},
  waves: 0,
  tour: null,
  welcomeOpen: false,
  prefs: loadPrefs(),
  hoverLabel: null,
  inDiscord: false,
  announce: '',
  decorate: null,
  authError: null,
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if (p.prefs) {
    try {
      localStorage.setItem('mw.prefs', JSON.stringify(state.prefs));
    } catch {
      /* private mode */
    }
  }
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

let toastId = 0;
export function toast(text: string, tone?: Toast['tone'], action?: Toast['action'], ms = 6000) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, tone, action }], announce: text }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/** Per-member local memory (never sent to the server): quests, greeted, dismissed suggestions. */
export function persistLocal(memberId: string) {
  const s = getState();
  try {
    localStorage.setItem(
      `mw.local.${memberId}`,
      JSON.stringify({ quests: s.quests, greeted: s.greeted, dismissed: s.dismissed, waves: s.waves }),
    );
  } catch {
    /* ignore */
  }
}

export function loadLocal(memberId: string): Pick<State, 'quests' | 'greeted' | 'dismissed' | 'waves'> {
  try {
    const v = JSON.parse(localStorage.getItem(`mw.local.${memberId}`) ?? '{}');
    return { quests: v.quests ?? {}, greeted: v.greeted ?? [], dismissed: v.dismissed ?? [], waves: v.waves ?? 0 };
  } catch {
    return { quests: {}, greeted: [], dismissed: [], waves: 0 };
  }
}
