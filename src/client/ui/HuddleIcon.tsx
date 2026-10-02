/** The headphone badge (see app/huddles.ts) as an inline SVG, for lists and cards. */
import type { VoiceBadge } from '../app/huddles';

export function HuddleIcon({ badge, title, size = 16 }: { badge: VoiceBadge | null; title?: string; size?: number }) {
  if (!badge) return null;
  const ink = badge.kind === 'none' ? '#f4efe6' : '#2a1f2d';
  return (
    <svg className={`huddle-icon ${badge.kind}`} width={size} height={size} viewBox="0 0 20 20" role="img" aria-label={title} style={{ color: badge.color }}>
      {title && <title>{title}</title>}
      <circle cx="10" cy="10" r="9.5" fill="#2a1f2d" />
      <circle cx="10" cy="10" r="8" fill="currentColor" />
      {badge.shape === 'phone' ? (
        <>
          <rect x="6.6" y="4.2" width="6.8" height="11.6" rx="1.4" fill={ink} />
          <rect x="7.7" y="5.8" width="4.6" height="7.4" rx="0.5" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M5.2 11.5 V9.6 A4.8 4.8 0 0 1 14.8 9.6 V11.5" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
          <rect x="4" y="10.6" width="2.6" height="4" rx="0.8" fill={ink} />
          <rect x="13.4" y="10.6" width="2.6" height="4" rx="0.8" fill={ink} />
        </>
      )}
      {badge.kind === 'none' && <path d="M4.5 15.5 L15.5 4.5" stroke="#e0453b" strokeWidth="2.4" strokeLinecap="round" />}
    </svg>
  );
}
