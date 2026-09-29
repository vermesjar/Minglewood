/** Catalog names: the label a model goes by in the decorate palette (the Design Lab, studio.py humanize). */

/** A name is a few words. */
export const NAME_MAX = 40;

/** A key as words, like studio.py's humanize: "chair-bistro.sage" → "Sage chair bistro". */
export function humanizeKey(key: string): string {
  const [base, ...variant] = key.replace('tree/', 'tree-').split('.');
  const words = base.replace(/^heirloom-/, '').split('-').filter(Boolean);
  const name = [...variant.filter((x) => !['a', 'b', 'c'].includes(x)), ...words].join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
