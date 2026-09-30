/**
 * Client state: a tiny external store (useSyncExternalStore) so the render loop and React share
 * one source of truth without re-rendering on every frame.
 */
import { useSyncExternalStore } from 'react';
import type { Bootstrap, PublicConfig, PublicMember } from '@shared/api';
import type { ChatEntry, OrgEvent } from '@shared/domain/types';
import type { BoardNote, DirectoryEntry, KnockKind, Occupant } from '@shared/protocol';

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
  | { kind: 'object'; sceneId: string; objectId: string; x: number; y: number }
  /** A room NPC (the café's barista): shown as an NPC, never as a coworker. */
  | { kind: 'npc'; sceneId: string; npcId: string; x: number; y: number };

export type Panel = 'search' | 'people' | 'avatar' | 'profile' | null;

export interface Prefs {
  reducedMotion: boolean;
  highContrast: boolean;
  showAllNames: boolean;
  sidebarOpen: boolean;
  /** The space's conversation panel is folded down to its header. */
  chatCollapsed?: boolean;
  /** Show when I'm talking in voice, from my mic level on this device (opt-in; no audio leaves the page). */
  talkLight?: boolean;
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
  /** Notes left on the boards of the room you're in. */
  notes: BoardNote[];
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
  /**
   * Decorate mode: which catalog item is selected (floor or wall), or none: the remove tool, or with `move` the
   * move tool. `moving`: the team piece picked up to move (the selected item is what it is).
   */
  decorate: { itemId: string | null; move?: boolean; moving?: string } | null;
  authError: string | null;
  /** The conversation of the space you're in; `channel` is its linked text channel, if any. */
  chat: { sceneId: string | null; entries: ChatEntry[]; channel?: { name: string; provider: string } };
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
  notes: [],
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
  chat: { sceneId: null, entries: [] },
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
