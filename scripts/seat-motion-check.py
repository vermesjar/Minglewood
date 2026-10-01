"""Audit every recorded motion state; furniture-overlap semantics remain a separate review.

Uses Pillow from the art environment. Usage:
  python scripts/seat-motion-check.py CAPTURE_FOLDER [EXPECTATIONS_FOLDER] --require-complete
The complete flag requires four facings and four outfits for every captured furniture key.
"""
from pathlib import Path
import base64, hashlib, io, json, math, sys
import argparse
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('folder', type=Path)
parser.add_argument('expectations', type=Path, nargs='?')
parser.add_argument('--require-complete', action='store_true')
args = parser.parse_args()
folder, expectation_folder = args.folder, args.expectations
def decode(url):
    return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')
def jsround(value):
    return math.floor(value + .5)

review_contexts = []
if expectation_folder:
    for review_path in expectation_folder.glob("*.json"):
        review = json.loads(review_path.read_text())
        if "context" in review and "points" in review:
            review_contexts.append(review)

results = []
for path in sorted(folder.glob('*-film.json')):
    raw = path.read_bytes()
    record = json.loads(raw)
    states=[frame['state'] for frame in record['frames']]
    settled_worlds={tuple(state['world']) for state in states
                    if state.get('onSeat') and state.get('serverSeat')==record['object']['id']
                    and state['pose'].startswith('sit')
                    and (state['phase'].startswith('seated-') or state['phase'].startswith('cushion-shift-'))}
    observed_coverage=dict(entryOutside=any(s['phase']=='entry' and not s['onSeat'] for s in states),
                           entryOnSeat=any(s['phase']=='entry' and s['onSeat'] for s in states),
                           exited=any(s['phase']=='exit' and not s['onSeat'] for s in states),
                           settledCushionCount=len(settled_worlds),requiredCushionCount=len(record['model']['sits']))
    view = next(v for v in json.loads(record['model']['compiler']['source'])[-1] if v[0] == record['facing'])
    obj = record['object']
    dx = (obj['x'] - obj['y']) * 16 - view[1] / 2
    dy = (obj['x'] + obj['y']) * 8 - obj.get('z', 0) - view[2] / 2
    art = decode(record['art']['png'])
    expectations = [(review['context']['cushion'], review) for review in review_contexts
                    if review['context']['key']==record['key']
                    and review['context']['facing']==record['facing']
                    and all(record['wornLook'].get(key)==value for key,value in review['context']['look'].items())]
    matched_cushions = set()
    semantic = dict(exactReviewedFrames=0,checkedOverlapPixels=0,wrongWinnerPixels=0,unmatchedFrames=0)
    counts = dict(exteriorRGBA=0, exteriorChanged=0, injectedAlpha=0, canvasExteriorRGBA=0,
                  canvasDifferences=0, canvasClipped=0, poseRaces=0)
    failures = []
    for number, frame in enumerate(record['frames']):
        f, state = frame['figure'], frame['state']
        canvas = decode(frame['png'])
        placement = frame.get('placement')
        k = placement['art']['pixelScale'] if placement else canvas.width / (art.width + 112)
        if abs(k-1)>1e-8:
            raise ValueError('Motion byte audit requires the documented 2x zoom / deviceScaleFactor=1 capture')
        scale = 2 * k
        at = state.get('at')
        x = at['x'] if at else jsround(state['sx'])
        y = at['y'] if at else jsround(state['sy'])
        feet = [jsround((x - dx) * 2), jsround((y - dy) * 2)]
        tx = jsround(frame['canvasSize']['width'] / 2 - state['camera']['x'] * scale)
        ty = jsround(frame['canvasSize']['height'] / 2 - state['camera']['y'] * scale)
        origin = [x * scale + tx - f['ax'] * k - frame['crop']['x'],
                  y * scale + ty - f['ay'] * k - frame['crop']['y']]
        art_origin = [dx * scale + tx - frame['crop']['x'], dy * scale + ty - frame['crop']['y']]
        if placement:
            assert abs(placement['figure']['pixelScale']-k)<1e-8
            assert abs(origin[0]-(placement['figure']['x']-frame['crop']['x']))<1e-7
            assert abs(origin[1]-(placement['figure']['y']-frame['crop']['y']))<1e-7
            assert abs(art_origin[0]-(placement['art']['x']-frame['crop']['x']))<1e-7
            assert abs(art_origin[1]-(placement['art']['y']-frame['crop']['y']))<1e-7
        matched_frame = False
        for cushion, expectation in expectations:
            context = expectation['context']
            fc = context['figureContext']
            matches = (record['model']['compiler']['source']==context['modelSource']
                       and state['pose']==context['pose'] and state['facing']==context['facing']
                       and feet==fc['feet'] and state.get('legs')==fc['legs']
                       and hashlib.sha256(bytes(f['rgba'])).hexdigest()==fc['figure']['rgbaSha256']
                       and hashlib.sha256(bytes(f['owner'])).hexdigest()==fc['figure']['ownerSha256'])
            if matches:
                matched_frame = True
                matched_cushions.add(cushion)
                semantic['exactReviewedFrames'] += 1
                for point in expectation['points']:
                    xx,yy = point['x']-feet[0]+f['ax'],point['y']-feet[1]+f['ay']
                    index=(yy*f['width']+xx)*4
                    assert f['rgba'][index+3] and point['winner'] in ['avatar','furniture']
                    actual_winner='avatar' if f['actual'][index+3] else 'furniture'
                    semantic['checkedOverlapPixels'] += 1
                    if actual_winner != point['winner']:
                        semantic['wrongWinnerPixels'] += 1
                break
        if expectation_folder and not matched_frame:
            semantic['unmatchedFrames'] += 1
        if state['poseRace']:
            counts['poseRaces'] += 1
        local = dict(changed=0, injected=0, canvasMismatch=0, clipped=0)
        examples = []
        for yy in range(f['height']):
            for xx in range(f['width']):
                i = (yy * f['width'] + xx) * 4
                original, actual = f['rgba'][i:i+4], f['actual'][i:i+4]
                if not original[3]:
                    if actual[3]:
                        counts['injectedAlpha'] += 1
                        local['injected'] += 1
                    continue
                ax, ay = xx + feet[0] - f['ax'], yy + feet[1] - f['ay']
                if 0 <= ax < art.width and 0 <= ay < art.height and art.getpixel((ax, ay))[3]:
                    continue
                counts['exteriorRGBA'] += 1
                if original != actual:
                    counts['exteriorChanged'] += 1
                    local['changed'] += 1
                # Independently sample the actual final canvas at this avatar pixel.
                cx, cy = jsround(origin[0] + xx*k), jsround(origin[1] + yy*k)
                if not (0 <= cx < canvas.width and 0 <= cy < canvas.height):
                    counts['canvasClipped'] += 1
                    local['clipped'] += 1
                    continue
                sx, sy = math.floor((cx+.5-art_origin[0])/k), math.floor((cy+.5-art_origin[1])/k)
                if 0 <= sx < art.width and 0 <= sy < art.height and art.getpixel((sx, sy))[3]:
                    continue
                counts['canvasExteriorRGBA'] += 1
                if tuple(original) != canvas.getpixel((cx,cy)):
                    counts['canvasDifferences'] += 1
                    local['canvasMismatch'] += 1
                    if len(examples) < 5:
                        examples.append(dict(figure=[xx,yy],canvas=[cx,cy],expected=original,actual=canvas.getpixel((cx,cy))))
        if any(local.values()):
            failures.append(dict(frame=number,phase=state['phase'],pose=state['pose'],counts=local,examples=examples))
    semantic['exactReviewedCushions'] = sorted(matched_cushions)
    results.append(dict(file=path.name,key=record['key'],sha256=hashlib.sha256(raw).hexdigest(),facing=record['facing'],look=record.get('reviewLook'),
                        frames=len(record['frames']),renderedFrames=record['renderedFrames'],coverage=record['coverage'],
                        observedCoverage=observed_coverage,rendererUnchanged=record['unchanged'],candidateFile=record['candidateFile'],swappedFields=record.get('swappedFields'),
                        counts=counts,settledIndependentExpectations=semantic,failures=failures))
    print(path.name, len(record['frames']), counts, flush=True)
problems=[]
if not results:
    problems.append('No motion films found')
for row in results:
    if not row['rendererUnchanged'] or row['swappedFields']:
        problems.append(f"{row['file']}: changed renderer or substituted outfit")
    coverage=row['coverage']
    if not all(coverage.get(key) for key in ['entryOutside','entryOnSeat','exited']) or not coverage.get('settledCushions') or not all(coverage['settledCushions']):
        problems.append(f"{row['file']}: incomplete approach/contact/cushion/exit coverage")
    observed=row['observedCoverage']
    if not all(observed[key] for key in ['entryOutside','entryOnSeat','exited']) or observed['settledCushionCount']!=observed['requiredCushionCount']:
        problems.append(f"{row['file']}: actual recorded frames omit required motion phases or cushions")
    if any(row['counts'][key] for key in ['exteriorChanged','injectedAlpha','canvasDifferences','canvasClipped','poseRaces']) or row['settledIndependentExpectations']['wrongWinnerPixels']:
        problems.append(f"{row['file']}: pixel invariant or pose consistency failure")
    if expectation_folder and row['settledIndependentExpectations']['exactReviewedCushions'] != list(range(observed['requiredCushionCount'])):
        problems.append(f"{row['file']}: an exact independently reviewed settled context was not observed for every cushion")
if args.require_complete:
    for key in {row['key'] for row in results}:
        contexts=[(row['facing'],row['look']) for row in results if row['key']==key]
        required={(face,look) for face in ['se','sw','ne','nw'] for look in range(4)}
        if set(contexts)!=required or len(contexts)!=len(required):
            problems.append(f'{key}: expected exactly four facings by four outfits')
output = dict(scope='Every recorded changed state. Exterior original-avatar RGBA and direct final-canvas sampling; transition overlap semantics are not approved by this check.',
              requiredComplete=args.require_complete,invariantsPassed=not problems,problems=problems,results=results)
(folder/'motion-independent-check.json').write_text(json.dumps(output,indent=2))
if problems:
    print('\n'.join(problems),file=sys.stderr)
    sys.exit(1)
