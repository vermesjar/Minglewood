import { describe, expect, it } from 'vitest';
import { worldTime } from './worldClock';

describe('world clock', () => {
  const noonUtc = Date.UTC(2026, 0, 15, 12, 30);

  it("reads the server's time in the organisation's zone, not the viewer's", () => {
    expect(worldTime(noonUtc, 'UTC')).toEqual({ hours: 12, minutes: 30, month: 0 });
    expect(worldTime(noonUtc, 'America/New_York')).toEqual({ hours: 7, minutes: 30, month: 0 });
    expect(worldTime(noonUtc, 'Asia/Tokyo')).toEqual({ hours: 21, minutes: 30, month: 0 });
  });

  it('falls back to UTC for a missing or unknown zone', () => {
    expect(worldTime(noonUtc, undefined).hours).toBe(12);
    expect(worldTime(noonUtc, 'Not/AZone').hours).toBe(12);
  });
});
