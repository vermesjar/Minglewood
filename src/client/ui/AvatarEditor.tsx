import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AVATAR_ITEMS,
  CLOTH_COLORS,
  EYE_COLORS,
  FANTASY_SKIN,
  HAIR_COLORS,
  SKIN_TONES,
  VIBES,
  applyVibe,
  hasUnlock,
  normalizeLoadout,
  randomLoadout,
  type AvatarSlot,
  type FullLoadout,
} from '@shared/avatar';
import type { SavedOutfit } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { game } from '../app/game';
import { getState, setState, toast, useStore } from '../app/store';
import type { Pose } from '../engine/sprites/avatar';
import { AvatarCanvas, Modal } from './common';

type Crop = 'head' | 'bust' | 'face' | 'torso' | 'legs' | 'body' | 'full';

type Section =
  | { kind: 'items'; title: string; slot: AvatarSlot; field: keyof FullLoadout; crop: Crop }
  | { kind: 'colors'; title: string; field: keyof FullLoadout; palette: string[]; extra?: { label: string; palette: string[] }; allowNone?: boolean; when?: (l: FullLoadout) => boolean };

interface Category {
  id: string;
  label: string;
  icon: string;
  sections: Section[];
}

const neutral = (l: FullLoadout, field: keyof FullLoadout) => !String(l[field]).endsWith('.none');

const CATEGORIES: Category[] = [
  {
    id: 'body',
    label: 'Body',
    icon: '🙂',
    sections: [
      { kind: 'colors', title: 'Skin tone', field: 'skin', palette: SKIN_TONES, extra: { label: 'Just for fun', palette: FANTASY_SKIN } },
    ],
  },
  {
    id: 'face',
    label: 'Face',
    icon: '😊',
    sections: [
      { kind: 'items', title: 'Eyes', slot: 'eyes', field: 'eyes', crop: 'face' },
      { kind: 'colors', title: 'Eye color', field: 'eyeColor', palette: EYE_COLORS },
      { kind: 'items', title: 'Brows', slot: 'brows', field: 'brows', crop: 'face' },
      { kind: 'items', title: 'Mouth', slot: 'mouth', field: 'mouth', crop: 'face' },
      { kind: 'items', title: 'Facial hair', slot: 'facialHair', field: 'facialHair', crop: 'face' },
      { kind: 'items', title: 'Details', slot: 'faceDetail', field: 'faceDetail', crop: 'face' },
    ],
  },
  {
    id: 'hair',
    label: 'Hair',
    icon: '💇',
    sections: [
      { kind: 'items', title: 'Style', slot: 'hair', field: 'hair', crop: 'bust' },
      { kind: 'colors', title: 'Color', field: 'hairColor', palette: HAIR_COLORS },
      { kind: 'colors', title: 'Two-tone tips', field: 'hairHighlight', palette: HAIR_COLORS, allowNone: true },
    ],
  },
  {
    id: 'hats',
    label: 'Hats',
    icon: '🎩',
    sections: [
      { kind: 'items', title: 'Headwear', slot: 'headwear', field: 'headwear', crop: 'bust' },
      { kind: 'colors', title: 'Color', field: 'headwearColor', palette: CLOTH_COLORS, when: (l) => neutral(l, 'headwear') },
    ],
  },
  { id: 'eyewear', label: 'Eyewear', icon: '👓', sections: [{ kind: 'items', title: 'Eyewear', slot: 'eyewear', field: 'eyewear', crop: 'face' }] },
  {
    id: 'top',
    label: 'Tops',
    icon: '👕',
    sections: [
      { kind: 'items', title: 'Style', slot: 'top', field: 'top', crop: 'torso' },
      { kind: 'colors', title: 'Main color', field: 'topColor', palette: CLOTH_COLORS },
      { kind: 'items', title: 'Pattern', slot: 'topPattern', field: 'topPattern', crop: 'torso' },
      { kind: 'colors', title: 'Accent color', field: 'topAccent', palette: CLOTH_COLORS },
    ],
  },
  {
    id: 'bottom',
    label: 'Bottoms',
    icon: '👖',
    sections: [
      { kind: 'items', title: 'Style', slot: 'bottom', field: 'bottom', crop: 'legs' },
      { kind: 'colors', title: 'Color', field: 'bottomColor', palette: CLOTH_COLORS },
    ],
  },
  {
    id: 'shoes',
    label: 'Shoes',
    icon: '👟',
    sections: [
      { kind: 'items', title: 'Style', slot: 'shoes', field: 'shoes', crop: 'legs' },
      { kind: 'colors', title: 'Color', field: 'shoesColor', palette: CLOTH_COLORS },
    ],
  },
  {
    id: 'extras',
    label: 'Extras',
    icon: '✨',
    sections: [
      { kind: 'items', title: 'In your hand', slot: 'held', field: 'held', crop: 'full' },
      { kind: 'colors', title: 'Its color', field: 'heldColor', palette: CLOTH_COLORS, when: (l) => ['held.book', 'held.balloon', 'held.umbrella', 'held.boba'].includes(l.held) },
      { kind: 'items', title: 'Buddy', slot: 'pet', field: 'pet', crop: 'full' },
      { kind: 'colors', title: 'Buddy color', field: 'petColor', palette: ['#e8a15a', '#3a3a46', '#fffaf0', '#c98f4a', '#9aa0a8', '#f2c14e', '#7cc576', '#e27ca7'], when: (l) => neutral(l, 'pet') },
      { kind: 'items', title: 'Around your neck', slot: 'neck', field: 'neck', crop: 'torso' },
      { kind: 'colors', title: 'Neck color', field: 'neckColor', palette: CLOTH_COLORS, when: (l) => ['neck.scarf', 'neck.bowtie', 'neck.tie', 'neck.bandana', 'neck.lanyard'].includes(l.neck) },
      { kind: 'items', title: 'Pins & little things', slot: 'accessory', field: 'accessory', crop: 'bust' },
    ],
  },
];

const FACINGS: Facing[] = ['se', 'sw', 'nw', 'ne'];

function useHistory(initial: FullLoadout) {
  const [stack, setStack] = useState({ past: [] as FullLoadout[], now: initial, future: [] as FullLoadout[] });
  const set = useCallback((next: FullLoadout) => {
    setStack((s) => (JSON.stringify(next) === JSON.stringify(s.now) ? s : { past: [...s.past.slice(-50), s.now], now: next, future: [] }));
  }, []);
  const undo = useCallback(() => setStack((s) => (s.past.length ? { past: s.past.slice(0, -1), now: s.past[s.past.length - 1], future: [s.now, ...s.future] } : s)), []);
  const redo = useCallback(() => setStack((s) => (s.future.length ? { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1) } : s)), []);
  return { L: stack.now, set, undo, redo, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}

/** The preview stage: turns, walks and waves so you can see the whole look in motion. */
function Stage({ L, extra }: { L: FullLoadout; extra?: React.ReactNode }) {
  const [facing, setFacing] = useState(0);
  const [walking, setWalking] = useState(false);
  const [waveUntil, setWaveUntil] = useState(0);
  const [tick, setTick] = useState(0);
  const reduced = useStore((s) => s.prefs.reducedMotion);
  useEffect(() => {
    if (!walking || reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), 150);
    return () => clearInterval(id);
  }, [walking, reduced]);
  useEffect(() => {
    if (!waveUntil) return;
    const id = setTimeout(() => setWaveUntil(0), 1400);
    return () => clearTimeout(id);
  }, [waveUntil]);
  const cycle: Pose[] = ['walk1', 'stand', 'walk2', 'stand'];
  const pose: Pose = waveUntil ? 'wave' : walking ? cycle[tick % 4] : 'stand';
  return (
    <div className="stage-wrap">
      <div className={`preview-stage ${walking ? 'walking' : ''}`}>
        <div className="stage-floor" aria-hidden />
        <AvatarCanvas loadout={L} scale={4} facing={FACINGS[facing]} pose={pose} crop="full" className="stage-avatar" />
      </div>
      <div className="stage-controls" role="group" aria-label="Preview">
        <button className="btn small" onClick={() => setFacing((facing + 3) % 4)} aria-label="Turn left">
          ⟲
        </button>
        <button className="btn small" onClick={() => setFacing((facing + 1) % 4)} aria-label="Turn right">
          ⟳
        </button>
        <button className={`btn small ${walking ? 'primary' : ''}`} onClick={() => setWalking(!walking)} aria-pressed={walking} aria-label="Walk" title="Walk">
          🚶
        </button>
        <button className="btn small" onClick={() => setWaveUntil(Date.now())} aria-label="Wave" title="Wave">
          👋
        </button>
        {extra}
      </div>
    </div>
  );
}

function Swatches({ section, L, set }: { section: Extract<Section, { kind: 'colors' }>; L: FullLoadout; set: (l: FullLoadout) => void }) {
  const value = String(L[section.field] ?? '');
  const pick = (c: string) => set({ ...L, [section.field]: c });
  const row = (palette: string[]) =>
    palette.map((c) => (
      <button key={c} role="radio" aria-checked={value === c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => pick(c)} aria-label={`${section.title} ${c}`} title={c} />
    ));
  return (
    <div className="wr-section">
      <h4>{section.title}</h4>
      <div className="swatches" role="radiogroup" aria-label={section.title}>
        {section.allowNone && (
          <button role="radio" aria-checked={!value} className={`swatch none ${!value ? 'on' : ''}`} onClick={() => pick('')} aria-label="None" title="None">
            ⃠
          </button>
        )}
        {row(section.palette)}
        <label className="swatch custom" title="Pick any color">
          <input type="color" value={value || '#888888'} onChange={(e) => pick(e.target.value)} aria-label={`Custom ${section.title.toLowerCase()}`} />
          <span aria-hidden>🎨</span>
        </label>
      </div>
      {section.extra && (
        <>
          <p className="wr-sub">{section.extra.label}</p>
          <div className="swatches">{row(section.extra.palette)}</div>
        </>
      )}
    </div>
  );
}

function ItemGrid({ section, L, set, unlocked }: { section: Extract<Section, { kind: 'items' }>; L: FullLoadout; set: (l: FullLoadout) => void; unlocked: string[] }) {
  const items = AVATAR_ITEMS.filter((i) => i.slot === section.slot);
  return (
    <div className="wr-section">
      <h4>{section.title}</h4>
      <div className={`item-grid crop-${section.crop}`} role="radiogroup" aria-label={section.title}>
        {items.map((item) => {
          const locked = !!item.unlock && !hasUnlock(unlocked, item.id);
          const selected = L[section.field] === item.id;
          // Held items and pets would crowd small previews of hair, hats or faces.
          const clear = section.crop === 'full' ? {} : { held: 'held.none', pet: 'pet.none' };
          const preview = { ...L, ...clear, [section.field]: item.id };
          return (
            <button
              key={item.id}
              role="radio"
              aria-checked={selected}
              className={`item ${selected ? 'on' : ''} ${locked ? 'locked' : ''}`}
              disabled={locked}
              onClick={() => set({ ...L, [section.field]: item.id })}
              title={locked ? item.unlock!.description : item.name}
            >
              <AvatarCanvas loadout={preview} crop={section.crop} scale={section.crop === 'face' ? 4 : 2} />
              <span>{item.name}</span>
              {item.unlock && <em className="unlock">{locked ? `🔒 ${item.unlock.description}` : '✨ earned'}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const NO_OUTFITS: SavedOutfit[] = [];

function SavedLooks({ L, onApply }: { L: FullLoadout; onApply: (l: FullLoadout) => void }) {
  const outfits = useStore((s) => s.boot?.me.outfits ?? NO_OUTFITS);
  const [naming, setNaming] = useState<string | null>(null);
  const save = async () => {
    const name = (naming ?? '').trim() || `Look ${outfits.length + 1}`;
    const next: SavedOutfit[] = [...outfits, { id: Math.random().toString(36).slice(2, 10), name, loadout: L }].slice(-8);
    await game.saveOutfits(next);
    setNaming(null);
    toast(`Saved “${name}” to your looks`, 'celebrate', undefined, 2500);
  };
  return (
    <div className="saved-looks">
      <h4>My looks</h4>
      <div className="looks-row">
        {outfits.map((o) => (
          <div key={o.id} className="look">
            <button className="look-btn" onClick={() => onApply(normalizeLoadout(o.loadout))} title={`Try on ${o.name}`}>
              <AvatarCanvas loadout={o.loadout} crop="bust" scale={2} />
              <span>{o.name}</span>
            </button>
            <button className="look-x" onClick={() => void game.saveOutfits(outfits.filter((x) => x.id !== o.id))} aria-label={`Delete ${o.name}`}>
              ×
            </button>
          </div>
        ))}
        {naming === null ? (
          <button className="look add" onClick={() => setNaming('')} disabled={outfits.length >= 8}>
            ＋<span>Save this look</span>
          </button>
        ) : (
          <form
            className="look naming"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} maxLength={24} placeholder="Name it (e.g. Friday)" aria-label="Look name" />
            <button className="btn small primary">Save</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AvatarEditor() {
  const me = useStore((s) => s.boot?.me);
  const start = useMemo(() => normalizeLoadout(me?.avatar ?? getState().boot!.me.avatar), [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { L, set, undo, redo, canUndo, canRedo } = useHistory(start);
  const [tab, setTab] = useState('hair');
  const [saving, setSaving] = useState(false);
  const unlocked = me?.unlockedItems ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (!me) return null;
  // During onboarding the tour is queued (inactive) until the avatar is done.
  const pendingTour = () => {
    const t = getState().tour;
    return t && !t.active ? { tour: { active: true, step: 0 } } : {};
  };
  const category = CATEGORIES.find((c) => c.id === tab)!;

  const wear = async () => {
    setSaving(true);
    try {
      await game.saveAvatar(L);
      setState({ panel: null, ...pendingTour() });
      toast('Looking sharp ✨', 'celebrate', undefined, 3000);
    } catch (e) {
      toast(`Couldn’t save: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={() => setState({ panel: null, ...pendingTour() })} label="Wardrobe" wide>
      <div className="wardrobe2">
        <div className="wr-left">
          <h2 className="pixel">Wardrobe</h2>
          <Stage
            L={L}
            extra={
              <>
                <button className="btn small" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
                  ↶
                </button>
                <button className="btn small" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                  ↷
                </button>
              </>
            }
          />
          <div className="wr-actions">
            <button className="btn small" onClick={() => set(randomLoadout(`${Date.now()}${Math.random()}`, { unlocked, base: L }))}>
              🎲 Surprise me
            </button>
            <button className="btn small" onClick={() => set(randomLoadout(`${Date.now()}${Math.random()}`, { unlocked, base: L, keepIdentity: true }))} title="New outfit, same you">
              👕 New outfit
            </button>
          </div>
          <h4 className="vibes-title">Today’s vibe</h4>
          <div className="vibes">
            {VIBES.map((v) => (
              <button key={v.id} className="chip vibe" onClick={() => set(applyVibe(L, v, unlocked))} title={`${v.name}: changes your outfit, keeps you`}>
                <span aria-hidden>{v.emoji}</span> {v.name}
              </button>
            ))}
          </div>
        </div>

        <div className="wr-right">
          <nav className="wr-tabs" role="tablist" aria-label="Wardrobe sections">
            {CATEGORIES.map((c) => (
              <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
                <span aria-hidden>{c.icon}</span>
                {c.label}
              </button>
            ))}
          </nav>
          <div className="wr-panel" role="tabpanel">
            {category.sections.map((s) =>
              s.kind === 'items' ? (
                <ItemGrid key={s.title} section={s} L={L} set={set} unlocked={unlocked} />
              ) : !s.when || s.when(L) ? (
                <Swatches key={s.title} section={s} L={L} set={set} />
              ) : null,
            )}
          </div>
        </div>

        <div className="wr-footer">
          <SavedLooks L={L} onApply={set} />
          <div className="wr-save">
            <p className="fineprint">Special items come from being part of things — launches, celebrations, years together. They’re never for sale.</p>
            <div className="row end">
              <button className="btn" onClick={() => set(start)}>
                Reset
              </button>
              <button className="btn primary" onClick={wear} disabled={saving}>
                {saving ? 'Saving…' : 'Wear it ✨'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
