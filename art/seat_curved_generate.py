"""Source-only common rolled-rim authoring. Outputs are unreviewed intent, never approval."""
import hashlib
import json
from pathlib import Path
import numpy as np
from seat_curved_authoring import Profile, fit, serializable
from seat_correspondence import author_correspondence

VERSION = 1
FACINGS = ('se', 'sw', 'ne', 'nw')


def eligible(model):
    return model.get('size') == [1, 1] and len(model.get('sits', [])) == 1 and \
        any(p.get('part') == 'wrap' for p in model.get('parts', [])) and \
        any(p.get('part') == 'seat' for p in model.get('parts', []))


def generator_hash():
    root = Path(__file__).parent
    return hashlib.sha256(b''.join((root / f).read_bytes() for f in
        ['seat_curved_generate.py', 'seat_curved_authoring.py', 'seat_correspondence.py'])).hexdigest()


def generate(request, source_hash):
    model = request['model']
    if not eligible(model) or request.get('style') != 'floor':
        raise ValueError('Rolled-rim authoring requires a single-contact one-tile floor wrap')
    if set(request['views']) != set(FACINGS):
        raise ValueError('All four explicit source views are required')
    views = []
    for facing in FACINGS:
        raw = request['views'][facing]
        # Only beauty, source semantic topology, geometry and contact enter fitting.
        v = {k: raw[k] for k in ['width', 'height', 'anchor', 'rgba']}
        v['facing'] = facing
        rgba = np.asarray(v['rgba'])
        if rgba.size != v['width'] * v['height'] * 4 or not np.isfinite(rgba).all() or \
                np.any(rgba < 0) or np.any(rgba > 255) or np.any(rgba != np.floor(rgba)):
            raise ValueError('Malformed original source RGBA')
        labels = np.asarray(raw['surface']['labels'])
        opaque = rgba.reshape(-1, 4)[:, 3] > 0
        if labels.shape != opaque.shape or np.any((labels > 0) != opaque) or \
                np.any(labels < 0) or np.any(labels > len(model['parts']) * 3):
            raise ValueError('Source identity must cover exactly original alpha')
        kinds = np.array([None] + [p['part'] for p in model['parts'] for _ in range(3)])
        top = (labels > 0) & ((labels - 1) % 3 == 0)
        v['crestTop'] = (top & (kinds[labels] == 'wrap')).tolist()
        v['wellTop'] = (top & (kinds[labels] == 'seat')).tolist()
        views.append(v)
    u, v, seat = model['sits'][0]
    crest = max(p['z'][1] for p in model['parts'])
    profile, loss = fit(Profile(seat=seat, rise=max(4, crest-seat+3), posterior=.35,
                                contact_u=u, contact_v=v), views)
    surfaces, audits = {}, {}
    for view in views:
        facing = view['facing']
        result = author_correspondence(profile, view)
        audits[facing] = result['audit']
        if result['audit']['problems']:
            raise ValueError(f"{facing}: bounded authored surface rejected: {result['audit']['problems']}")
        source = request['views'][facing]['surface']
        opaque = np.asarray(view['rgba']).reshape(-1, 4)[:, 3] > 0
        surfaces[facing] = {**source, 'version': 2, 'authored': {
            'kind': 'rolled-rim', 'provenance': 'authored-intent', 'identity': 'source-proposal',
            'profile': serializable(profile), 'geometry': request['geometry'], 'anchor': view['anchor'],
            'style': 'floor', 'generatorSha256': generator_hash(), 'sourceInputsSha256': source_hash,
            'z': [float(z) if op else None for z, op in zip(result['depth'].ravel(), opaque)],
            'correspondence': result['sourceToCurve'].reshape(-1, 2).tolist()}}
    return {'version': VERSION, 'status': 'UNREVIEWED_AUTHORED_INTENT', 'sourceInputsSha256': source_hash,
            'generatorSha256': generator_hash(), 'silhouetteLoss': loss, 'audits': audits, 'surfaces': surfaces}


def produce(source, output):
    source, output = Path(source), Path(output)
    raw = source.read_bytes()
    identity = hashlib.sha256(raw).hexdigest()
    if output.exists():
        cached = json.loads(output.read_text())
        if cached.get('sourceInputsSha256') == identity and cached.get('generatorSha256') == generator_hash():
            return cached
    result = generate(json.loads(raw), identity)
    output.write_text(json.dumps(result, allow_nan=False, separators=(',', ':')))
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    args = parser.parse_args()
    produce(args.source, args.output)
