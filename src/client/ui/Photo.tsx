/** Someone's picture from the company's platform (Slack / Discord), round; click to see it large. */
import { setState, useStore } from '../app/store';

export function Photo({ url, size = 22, title, name, className = '' }: { url?: string; size?: number; title?: string; name?: string; className?: string }) {
  if (!url) return null;
  return (
    <img
      className={`photo ${className}`}
      src={url}
      width={size}
      height={size}
      alt=""
      title={title ?? (name ? `${name} — click to enlarge` : 'Click to enlarge')}
      loading="lazy"
      referrerPolicy="no-referrer"
      onClick={(e) => {
        e.stopPropagation();
        setState({ photoView: { url: url.replace(/(_|=)\d{2,3}(\.png|\.jpg)?$/, (m) => m.replace(/\d{2,3}/, '512')), name: name ?? '' } });
      }}
    />
  );
}

/** The large view of a picture: anywhere outside it, Escape, or the ✕ closes it. */
export function PhotoLightbox() {
  const view = useStore((s) => s.photoView);
  if (!view) return null;
  const close = () => setState({ photoView: null });
  return (
    <div className="lightbox" role="dialog" aria-label={view.name ? `${view.name}’s picture` : 'Picture'} onClick={close} onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={view.url} alt={view.name} referrerPolicy="no-referrer" />
        {view.name && <figcaption>{view.name}</figcaption>}
        <button className="close-x" onClick={close} aria-label="Close">
          ×
        </button>
      </figure>
    </div>
  );
}
