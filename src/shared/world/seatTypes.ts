import type { SeatKind, SeatProfile } from './seats';

/** Authoring presets. A user chooses a furniture type; its mechanics are supplied by the pipeline. */
export const SEAT_TYPES: Array<{ kind: SeatKind; label: string; width: number; height: number; profile: SeatProfile }> = [
  { kind: 'chair', label: 'Chair / office chair', width: 1, height: 28, profile: { seat: 11, sitStyle: 'chair', backrest: true } },
  { kind: 'armchair', label: 'Armchair / lounge chair', width: 1, height: 28, profile: { seat: 10, sitStyle: 'lounge', backrest: true, arms: true } },
  { kind: 'couch', label: 'Sofa / loveseat', width: 2, height: 23, profile: { seat: 10, sitStyle: 'lounge', backrest: true, arms: true } },
  { kind: 'bench', label: 'Bench / banquette', width: 2, height: 24, profile: { seat: 10, sitStyle: 'chair', backrest: true, arms: true } },
  { kind: 'stool', label: 'Stool / bar stool', width: 1, height: 18, profile: { seat: 18, sitStyle: 'stool', backrest: false } },
  { kind: 'ottoman', label: 'Ottoman / pouf', width: 1, height: 8, profile: { seat: 8, sitStyle: 'chair', backrest: false } },
  { kind: 'beanbag', label: 'Beanbag / soft floor seat', width: 1, height: 14, profile: { seat: 6, sitStyle: 'floor', backrest: true } },
  { kind: 'floor-cushion', label: 'Floor cushion / meditation pillow', width: 1, height: 3, profile: { seat: 3, sitStyle: 'floor', backrest: false } },
  { kind: 'throne', label: 'Throne / high-back chair', width: 1, height: 36, profile: { seat: 10, sitStyle: 'chair', backrest: true, arms: true } },
];
