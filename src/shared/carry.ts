/**
 * The things you can carry (see CARRYABLE in protocol.ts), described once for every place that shows them:
 * the action bar ("☕ Coffee · Put down"), name tags, the hand-off toast, and what the person handing it
 * over says.
 */
export interface CarryMeta {
  emoji: string;
  name: string;
  /** The toast when it lands in your hands. */
  got: string;
  /** What an NPC says as they hand it over ({name} = your first name). */
  handOff: string;
}

export const CARRY_META: Record<string, CarryMeta> = {
  coffee: { emoji: '☕', name: 'Coffee', got: '☕ Coffee in hand — enjoy! Put it down whenever you like.', handOff: 'Here’s your flat white, {name} ☕' },
  boba: { emoji: '🧋', name: 'Boba', got: '🧋 Boba in hand — enjoy!', handOff: 'Here’s your boba, {name} 🧋' },
  icecream: { emoji: '🍦', name: 'Ice cream', got: '🍦 Ice cream in hand — quick, before it melts.', handOff: 'One scoop for you, {name} 🍦' },
  plush: { emoji: '🧸', name: 'Plush', got: '🧸 You won a prize! It’s yours to carry around.', handOff: 'A prize for you, {name}! 🧸' },
  popcorn: { emoji: '🍿', name: 'Popcorn', got: '🍿 Popcorn in hand — careful, it’s hot.', handOff: 'Fresh popcorn, {name} 🍿' },
  soda: { emoji: '🥤', name: 'Soda', got: '🥤 Soda in hand — ice cold.', handOff: 'One soda, {name} 🥤' },
  book: { emoji: '📖', name: 'Book', got: '📖 Borrowed a book — put it back whenever you like.', handOff: 'Enjoy the read, {name} 📖' },
  water: { emoji: '💧', name: 'Water', got: '💧 A cup of water — stay hydrated.', handOff: 'Here’s some water, {name} 💧' },
  apple: { emoji: '🍎', name: 'Apple', got: '🍎 An apple from the bowl — crunchy.', handOff: 'An apple for you, {name} 🍎' },
};

export function carryMeta(item: string | null | undefined): CarryMeta | undefined {
  return item ? CARRY_META[item] : undefined;
}
