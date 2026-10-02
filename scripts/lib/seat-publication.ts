/** Common publication gate for Design Lab, command-line publishing and catalog model writes. */
import { readFileSync } from 'node:fs';
import { seatPlacementProblems, type SeatModel } from '../../src/shared/world/seatModels';
import { canonical, sha256, verifySeatBundle, seatMechanicsDigest } from './seat-verification';
import { verifySeatMotionVisual } from './seat-motion-visual-verification';
import { verifySeatVisual } from './seat-visual-verification';
import { verifySeatWardrobe } from './seat-wardrobe-verification';

export interface SeatVerificationReference { contract: string; bundle: string }
const identity = seatMechanicsDigest;

export function requireSeatPublicationEvidence(key: string, model: SeatModel, previous?: SeatModel, evidence?: SeatVerificationReference): void {
  // Rebuilding exactly the same legacy catalog proxy is not a new pixel-verification claim.
  if (!model.surfaces && !("authoredGeometry" in model) && previous && !previous.surfaces && identity(model) === identity(previous)) return;
  if (!model.surfaces) throw new Error(`${key}: new or changed seating needs generated source-pixel surfaces and independent evidence before publication.`);
  if (!evidence?.contract || !evidence?.bundle) throw new Error(`${key}: generated seating surfaces need a complete independent verification bundle before publication.`);
  const contract = JSON.parse(readFileSync(evidence.contract, 'utf8'));
  const digests = Object.fromEntries(Object.entries(model.surfaces).map(([f, map]) => [f, sha256(canonical(map))]));
  if (contract.mechanicsDigest !== seatMechanicsDigest(model) || contract.key !== key || contract.modelParts !== JSON.stringify(model.parts) || canonical(contract.sits) !== canonical(model.sits) ||
      canonical(contract.compiler) !== canonical(model.compiler) || canonical(contract.surfaceDigests) !== canonical(digests))
    throw new Error(`${key}: independent verification contract does not match the model being published.`);
  const checked = verifySeatBundle(evidence.bundle, evidence.contract);
  if (!checked.ok) throw new Error(`${key}: ${checked.problems.slice(0, 20).join('; ')}`);
  const placement = seatPlacementProblems(model);
  if (placement.length) throw new Error(`${key}: sitting placement is not approved: ${placement.join('; ')}`);
  // Rigid and curved seats can both match a numerical reference while clipping
  // the original body. Every newly published surface needs visual acceptance.
  const visual = verifySeatVisual(evidence.bundle, evidence.contract);
  if (visual.length) throw new Error(`${key}: independent visual quality review required: ${visual.slice(0, 20).join('; ')}`);
  const motion = verifySeatMotionVisual(evidence.bundle, evidence.contract);
  if (motion.length) throw new Error(`${key}: independent movement review required: ${motion.slice(0,20).join('; ')}`);
  const wardrobe = verifySeatWardrobe(evidence.bundle, evidence.contract);
  if (wardrobe.length) throw new Error(`${key}: original-body wardrobe coverage required: ${wardrobe.slice(0, 20).join('; ')}`);
}
