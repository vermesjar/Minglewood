"""Source-only close inspection of a flagged semantic boundary, never beauty edits.

The repair is another unapproved proposal. Existing independent pixel expectations
remain unchanged and the entire seat must pass again before publication.
"""
from __future__ import annotations
import argparse
import json
import hashlib
import copy
import time
from pathlib import Path
from PIL import Image, ImageDraw
import seat_surfaces as surfaces
import studio


def apply_review(data, original, proposal, bounds, pixels=None):
    w, h = data['width'], data['height']
    if original['drawing'] != data['drawing'] or original['modelParts'] != data['modelParts']:
        raise ValueError('Stale source or geometry in repair input')
    if 'ownership' in original:
        surfaces.validate_surface_ownership(data, original)
    left, top, right, bottom = bounds
    if not (0 <= left < right <= w and 0 <= top < bottom <= h) or \
       original.get('width') != w or original.get('height') != h or len(original.get('labels', [])) != w * h:
        raise ValueError('Invalid repair bounds or source dimensions')
    required = {(x, y) for y in range(top, bottom) for x in range(left, right)
                if data['rgba'][(y * w + x) * 4 + 3]}
    if pixels is not None:
        selected = {tuple(p) for p in pixels}
        if not selected or len(selected) != len(pixels) or not selected <= required:
            raise ValueError('Selected repair pixels must be unique opaque points inside bounds')
        required = selected
    seen = set()
    result = {**original, 'labels': original['labels'][:]}
    for pixel in proposal['pixels']:
        x, y, part, face = (pixel[k] for k in ['x', 'y', 'part', 'face'])
        if any(type(n) is not int for n in [x, y, part, face]) or (x, y) not in required or (x, y) in seen:
            raise ValueError('Invalid, duplicate, transparent or out-of-region repair pixel')
        if not 0 <= part < len(data['parts']) or face not in [0, 1, 2]:
            raise ValueError('Invalid physical surface identity')
        seen.add((x, y))
        result['labels'][y * w + x] = 1 + part * 3 + face
    if seen != required:
        raise ValueError(f'Incomplete repair region: {len(required - seen)} opaque pixels unreviewed')
    surfaces.validate_ownership(proposal, 'pixels')
    result['labels'] = surfaces.physical_assignments(data, result['labels'], proposal)
    if any(a != b for i, (a, b) in enumerate(zip(original['labels'], result['labels']))
           if (i % w, i // w) not in required):
        raise ValueError('Repair would reassign physical identities outside the reviewed region')
    result['ownership'] = surfaces.ownership_metadata(data, proposal, 'pixels')
    result['ownership']['previousSurfaceSha256'] = hashlib.sha256(
        json.dumps(original, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    # Preserve provenance for untouched pixels, without retroactively certifying legacy maps.
    result['ownership']['previousOwnership'] = copy.deepcopy(original.get('ownership',
        {'status': 'HISTORICAL_OWNERSHIP_UNRECORDED'}))
    return surfaces.bind_ownership_labels(result)


def repair(input_path, surface_path, bounds, out, context=8, pixels=None, context_inputs=None):
    data = json.loads(input_path.read_text(encoding='utf-8'))
    original = json.loads(surface_path.read_text(encoding='utf-8'))
    references = [json.loads(Path(path).read_text(encoding='utf-8')) for path in (context_inputs or [])]
    for reference in references:
        if reference.get('key') != data['key'] or reference.get('facing') not in ['ne','nw','se','sw']:
            raise ValueError('Cross-view context must be the same furniture with an explicit facing')
        if type(reference.get('width')) is not int or type(reference.get('height')) is not int or min(reference['width'],reference['height'])<=0 or len(reference.get('rgba',[]))!=reference['width']*reference['height']*4:
            raise ValueError('Invalid cross-view beauty source dimensions')
    request_hash = hashlib.sha256(json.dumps({'producer': 3, 'surfaceProducer': surfaces.SURFACE_PRODUCER_VERSION, 'data': data, 'original': original,
        'bounds': bounds, 'context': context, 'pixels': pixels, 'references': references}, sort_keys=True).encode()).hexdigest()
    w, h = data['width'], data['height']
    left, top, right, bottom = bounds
    if not (0 <= left < right <= w and 0 <= top < bottom <= h):
        raise ValueError('Repair bounds outside source')
    if type(context) is not int or context < 0:
        raise ValueError('Visual context must be a nonnegative pixel count')
    out.mkdir(parents=True, exist_ok=True)
    source = Image.frombytes('RGBA', (w, h), bytes(data['rgba']))
    scale, pad = 28, 36
    view_left, view_top = max(0, left-context), max(0, top-context)
    view_right, view_bottom = min(w, right+context), min(h, bottom+context)
    crop = source.crop((view_left, view_top, view_right, view_bottom)).resize(
        ((view_right-view_left)*scale, (view_bottom-view_top)*scale), Image.Resampling.NEAREST)
    grid = Image.new('RGB', (crop.width + pad * 2, crop.height + pad * 2), (242, 240, 244))
    grid.paste(crop, (pad, pad), crop)
    draw = ImageDraw.Draw(grid)
    for x in range(view_left, view_right):
        px = pad + (x - view_left) * scale
        draw.line((px, pad, px, pad + crop.height), fill=(110, 110, 125))
        draw.text((px + 6, 12), str(x), fill=(10, 10, 20))
    for y in range(view_top, view_bottom):
        py = pad + (y - view_top) * scale
        draw.line((pad, py, pad + crop.width, py), fill=(110, 110, 125))
        draw.text((6, py + 8), str(y), fill=(10, 10, 20))
    grid.save(out / 'source-closeup.png')
    prompt = f'''Independently identify the exact painted physical surface of EVERY opaque pixel inside the requested output bounds.
This is an isometric furniture sprite; first image is the full unmodified source, second is a nearest-neighbor closeup with original drawing coordinates.
Key {data['key']}, facing {data['facing']}, source {w}x{h}. Bounds [left,top,right,bottom), right/bottom excluded: {bounds}.
The numbered closeup includes {context} pixels of surrounding visual context. Classify ONLY pixels inside the output bounds above, not the entire closeup.
Physical indexed parts: {json.dumps(data['parts'])}
Their projected centers and near/far roles IN THIS VIEW: {json.dumps(data['projectedParts'])}
face0=top, face1=side normal local u, face2=side normal local v. Choose actual painted surface, not a proxy box silhouette.
Follow the complete pixel staircase of upholstery contours, raised rolled-arm crests, seams, and visible cushion. Shadow does not change part identity by itself.
Do not assume all bright pixels belong to the arm or all dark pixels belong to the seat. Preserve the actual physical part index from the projected legend.
Output one x,y,part,face item for every opaque source pixel inside bounds; transparent pixels must be omitted.
Do not modify beauty pixels or geometry. There are no avatar masks or expected winners in these inputs. Report genuinely ambiguous boundaries as uncertainties.
This region was flagged by an independent review; your proposal must be reverified over all views/outfits and is not approval.
{surfaces.SHARED_CONTOUR_AUTHORING_RULE}'''
    prompt += '\n' + surfaces.OWNERSHIP_PROMPT
    if pixels is not None:
        prompt += f'\nEXACT OUTPUT DOMAIN: classify ONLY these original source coordinates: {json.dumps(pixels)}. All other pixels are context and MUST NOT appear in your output. This overrides the rectangular output domain above.'
    if references:
        prompt += '\nAdditional images show only unmodified beauty sources of the SAME furniture from other facings. Use them to distinguish physically continuous parts (for example raised inner back cushions versus a seat or opposite arm), while classifying coordinates ONLY in the primary facing. Other views supply context, never transferable pixel coordinates or avatar winners.'
    pixel = {'type': 'object', 'additionalProperties': False, 'properties':
             {**{k: {'type': 'integer'} for k in ['x', 'y', 'part', 'face']},
              **surfaces.ownership_properties(), 'reason': {'type': 'string'}},
             'required': ['x', 'y', 'part', 'face', 'basis', 'convention', 'reason']}
    schema = {'type': 'object', 'additionalProperties': False, 'properties': {
        'pixels': {'type': 'array', 'items': pixel}, 'uncertainties': {'type': 'array', 'items': {'type': 'string'}},
        'reasoning': {'type': 'string'}}, 'required': ['pixels', 'uncertainties', 'reasoning']}
    (out / 'input.json').write_text(json.dumps(data), encoding='utf-8')
    (out / 'original-surface.json').write_text(json.dumps(original), encoding='utf-8')
    (out / 'prompt.txt').write_text(prompt, encoding='utf-8')
    receipt_path, response_path = out / 'request-sha256.txt', out / 'response.json'
    cached = response_path.exists() and receipt_path.exists() and receipt_path.read_text() == request_hash
    if not cached and studio.spent() + 1.5 > studio.cap():
        raise RuntimeError('Insufficient remaining art budget for independent boundary inspection')
    content = [{'type': 'input_text', 'text': prompt},
        {'type': 'input_image', 'image_url': surfaces.image_url(source), 'detail': 'high'},
        {'type': 'input_image', 'image_url': surfaces.image_url(grid), 'detail': 'high'}]
    for index, reference in enumerate(references):
        (out / f'context-source-{index}.json').write_text(json.dumps(reference), encoding='utf-8')
        content.extend([{'type':'input_text','text':f"Additional beauty-only view: facing {reference['facing']}, dimensions {reference['width']}x{reference['height']}, anchor {reference.get('anchor')}."},
            {'type':'input_image','image_url':surfaces.image_url(Image.frombytes('RGBA',(reference['width'],reference['height']),bytes(reference['rgba']))),'detail':'high'}])
    start = time.time()
    response = json.loads(response_path.read_text(encoding='utf-8')) if cached else studio.post(f'{studio.API}/responses', json={'model': surfaces.MODEL, 'store': False,
        'reasoning': {'effort': 'medium'}, 'max_output_tokens': 18000,
        'input': [{'role': 'user', 'content': content}],
        'text': {'format': {'type': 'json_schema', 'name': 'surface_boundary', 'strict': True, 'schema': schema}}})
    response_path.write_text(json.dumps(response), encoding='utf-8')
    if not cached:
        receipt_path.write_text(request_hash)
    usage = response.get('usage') or {}
    usd = (usage.get('input_tokens', 0) * surfaces.INPUT_USD + usage.get('output_tokens', 0) * surfaces.OUTPUT_USD) / 1e6
    if not cached:
        studio.log('seat-surface-repair', argparse.Namespace(model=surfaces.MODEL, quality='vision', size=f'{w}x{h}', count=1),
                   {**usage, 'usd': usd}, time.time() - start, f"surfaces/{data['key']}/{data['facing']}/repair")
    if response.get('status') != 'completed':
        raise RuntimeError(f"Incomplete boundary proposal: {response.get('status')}")
    text = ''.join(c.get('text', '') for o in response.get('output', []) for c in o.get('content', []) if c.get('type') == 'output_text')
    proposal = json.loads(text)
    try:
        revised = apply_review(data, original, proposal, bounds, pixels)
    finally:
        (out / 'proposal.json').write_text(json.dumps(proposal, indent=2), encoding='utf-8')
    (out / 'surface.json').write_text(json.dumps(revised), encoding='utf-8')
    print(json.dumps({'status': 'UNREVIEWED', 'surface': str(out / 'surface.json'), 'usd': 0 if cached else usd, 'cached': cached,
                      'uncertainties': proposal['uncertainties']}))
    return revised


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--surface', type=Path, required=True)
    parser.add_argument('--bounds', type=int, nargs=4, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--context', type=int, default=8, help='Visual context outside the classified ROI; never modified.')
    parser.add_argument('--pixels', type=Path, help='Optional JSON list of exact source coordinates to classify; all other pixels remain untouched.')
    parser.add_argument('--context-input', type=Path, action='append', help='Additional source-only export of this furniture from another facing; repeat for multiple views.')
    args = parser.parse_args()
    repair(args.input, args.surface, args.bounds, args.out, args.context,
           json.loads(args.pixels.read_text()) if args.pixels else None, args.context_input)
