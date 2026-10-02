/** Someone's picture from the company's platform (Slack / Discord), round; nothing when they have none. */
export function Photo({ url, size = 22, title, className = '' }: { url?: string; size?: number; title?: string; className?: string }) {
  if (!url) return null;
  return <img className={`photo ${className}`} src={url} width={size} height={size} alt="" title={title} loading="lazy" referrerPolicy="no-referrer" />;
}
