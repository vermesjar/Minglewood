/**
 * The one clock the world runs on. Every client shows the same time of day: the SERVER's time, read in the
 * ORGANISATION's time zone (falling back to UTC). A browser's own clock never decides whether it's night.
 *
 * How this should work for teams spread across the globe is still open (per-team zones, per-viewer skies,
 * a fixed "HQ time"…). Whatever is decided, this function is the only place to change.
 */
export interface WorldTime {
  hours: number;
  minutes: number;
  /** 0 = January. */
  month: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(timeZone: string): Intl.DateTimeFormat {
  let f = formats.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', month: 'numeric', hourCycle: 'h23' });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: 'numeric', month: 'numeric', hourCycle: 'h23' });
    }
    formats.set(timeZone, f);
  }
  return f;
}

/** The world's time of day at a moment (epoch ms, server time), in the organisation's zone. */
export function worldTime(epochMs: number, timeZone: string | undefined): WorldTime {
  const parts = formatFor(timeZone || 'UTC').formatToParts(new Date(epochMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hours: get('hour') % 24, minutes: get('minute'), month: get('month') - 1 };
}
