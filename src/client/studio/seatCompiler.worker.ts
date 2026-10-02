import { compileSeat } from '../engine/sprites/seatCompiler';
import type { SeatCompileInput } from '../engine/sprites/seatCompiler';
self.onmessage = (event: MessageEvent<SeatCompileInput>) => {
  try { self.postMessage(compileSeat(event.data)); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
