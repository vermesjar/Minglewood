import { useState } from 'react';
import { AVATAR_ITEMS, CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type AvatarSlot } from '@shared/avatar';
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { game } from '../app/game';
import { getState, setState, toast, useStore } from '../app/store';
import { AvatarCanvas, Modal } from './common';

const SLOTS: Array<{ slot: AvatarSlot; label: string; color?: keyof AvatarLoadout; palette?: string[] }> = [
  { slot: 'hair', label: 'Hair', color: 'hairColor', palette: HAIR_COLORS },
  { slot: 'top', label: 'Top', color: 'topColor', palette: CLOTH_COLORS },
  { slot: 'bottom', label: 'Bottoms', color: 'bottomColor', palette: CLOTH_COLORS },
  { slot: 'shoes', label: 'Shoes', color: 'shoesColor', palette: CLOTH_COLORS },
  { slot: 'accessory', label: 'Extras' },
];

const FACINGS: Facing[] = ['se', 'sw', 'nw', 'ne'];

export function AvatarEditor() {
  const me = useStore((s) => s.boot?.me);
  const [L, setL] = useState<AvatarLoadout | null>(me?.avatar ?? null);
  const [tab, setTab] = useState<AvatarSlot>('hair');
  const [facing, setFacing] = useState(0);
  const [saving, setSaving] = useState(false);
  if (!me || !L) return null;
  // During onboarding the tour is queued (inactive) until the avatar is done.
  const pendingTour = () => {
    const t = getState().tour;
    return t && !t.active ? { tour: { active: true, step: 0 } } : {};
  };
  const set = (patch: Partial<AvatarLoadout>) => setL({ ...L, ...patch });
  const current = SLOTS.find((s) => s.slot === tab)!;
  const items = AVATAR_ITEMS.filter((i) => i.slot === tab);

  const save = async () => {
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
      <div className="wardrobe">
        <div className="wardrobe-preview">
          <div className="preview-stage">
            <AvatarCanvas loadout={L} scale={5} facing={FACINGS[facing]} />
          </div>
          <div className="row center">
            <button className="btn small" onClick={() => setFacing((facing + 3) % 4)} aria-label="Turn left">
              ⟲
            </button>
            <button className="btn small" onClick={() => setFacing((facing + 1) % 4)} aria-label="Turn right">
              ⟳
            </button>
          </div>
          <div className="field">
            <span>Skin tone</span>
            <div className="swatches" role="radiogroup" aria-label="Skin tone">
              {SKIN_TONES.map((c) => (
                <button key={c} role="radio" aria-checked={L.skin === c} className={`swatch ${L.skin === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ skin: c })} aria-label={`Skin tone ${c}`} />
              ))}
            </div>
          </div>
        </div>
        <div className="wardrobe-options">
          <h2 className="pixel">Wardrobe</h2>
          <div className="tabs" role="tablist">
            {SLOTS.map((s) => (
              <button key={s.slot} role="tab" aria-selected={tab === s.slot} className={tab === s.slot ? 'on' : ''} onClick={() => setTab(s.slot)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="item-grid" role="radiogroup" aria-label={current.label}>
            {items.map((item) => {
              const locked = !!item.unlock && !me.unlockedItems.includes(item.id);
              const selected = L[tab] === item.id;
              const preview = { ...L, [tab]: item.id };
              return (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={selected}
                  className={`item ${selected ? 'on' : ''} ${locked ? 'locked' : ''}`}
                  disabled={locked}
                  onClick={() => set({ [tab]: item.id } as Partial<AvatarLoadout>)}
                  title={locked ? item.unlock!.description : item.name}
                >
                  <AvatarCanvas loadout={preview} head={tab === 'hair' || tab === 'accessory'} scale={2} />
                  <span>{item.name}</span>
                  {item.unlock && <em className="unlock">{locked ? `🔒 ${item.unlock.description}` : `✨ ${item.unlock.description}`}</em>}
                </button>
              );
            })}
          </div>
          {current.color && current.palette && (
            <div className="field">
              <span>Color</span>
              <div className="swatches">
                {current.palette.map((c) => (
                  <button key={c} className={`swatch ${L[current.color!] === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ [current.color!]: c } as Partial<AvatarLoadout>)} aria-label={`Color ${c}`} />
                ))}
              </div>
            </div>
          )}
          <p className="fineprint">Special items come from being part of things — launches, celebrations, years together. They’re never for sale.</p>
          <div className="row end">
            <button className="btn" onClick={() => setL(me.avatar)}>
              Reset
            </button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save my look'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
