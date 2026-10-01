import {verifySeatMotionVisual} from './lib/seat-motion-visual-verification';
const [bundle,contract,folder]=process.argv.slice(2);
const problems=verifySeatMotionVisual(bundle,contract,folder);
process.stdout.write(JSON.stringify({ok:!problems.length,problems}));
if(problems.length)process.exitCode=1;
