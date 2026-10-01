"""Independent numerical review of explicit authored geometry, not aesthetic approval.

Reconstructs both surfaces from source contracts. Does not read mapped z values,
renderer masks, masked figures, expected winners, or final canvases.
"""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from seat_body_reference import body_depths, BODY_REFERENCE_VERSION
from seat_curved_authoring import Profile, intersect
from seat_correspondence import audit_correspondence


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def drawing_print(art):
    w, h = art['width'], art['height']
    value = 0x811c9dc5
    for byte in [w, w >> 8, h, h >> 8, *art['rgba']]:
        value = ((value ^ (byte & 255)) * 16777619) & 0xffffffff
    return f'{value:08x}'


def review(data, surface):
    art = data['sourceArt']; w, h = art['width'], art['height']
    if surface.get('version') != 2 or surface.get('drawing') != drawing_print(art) or \
       surface.get('width') != w or surface.get('height') != h:
        raise ValueError('Authored surface does not match original beauty')
    authored = surface['authored']
    if authored['kind'] != 'rolled-rim' or authored['anchor'] != art['anchor']:
        raise ValueError('Authored source anchor/profile family changed')
    profile = Profile(**authored['profile'])
    correspondence = np.asarray(authored['correspondence'], dtype=float).reshape(h, w, 2)
    opaque = np.asarray(art['rgba']).reshape(h, w, 4)[:, :, 3] > 0
    # Complete correspondence quality is checked again without trusting producer reports.
    u, v = profile.contact_u, profile.contact_v
    wx, wy = {'ne': (u,v), 'nw': (v,1-u), 'se': (1-v,u), 'sw': (1-u,1-v)}[data['facing']]
    contact = (art['anchor'][0]+32*(wx-wy)-.5, art['anchor'][1]+16*(wx+wy)-2*profile.seat-.5)
    audit = audit_correspondence(correspondence[:,:,0], correspondence[:,:,1], opaque, contact)
    if audit['problems']: raise ValueError(f'Invalid authored correspondence: {audit["problems"]}')
    # Independently ray-intersect the declared smooth solid, never surface.authored.z.
    furniture = intersect(profile, {'facing':data['facing'], 'anchor':art['anchor'],
        'sampleX':correspondence[:,:,0], 'sampleY':correspondence[:,:,1]}, .1)
    reviews = []
    for context in data['contexts']:
        body = body_depths(data, context)
        figure = context['figure']; feet = context['context']['figureContext']['feet']
        rgba = np.asarray(figure['rgba']).reshape(figure['h'], figure['w'], 4)
        ox, oy = math.floor(feet[0]+.5)-figure['ax'], math.floor(feet[1]+.5)-figure['ay']
        points, unknown = [], []
        for fy, fx in np.argwhere(rgba[:,:,3] > 0):
            x, y = int(fx+ox), int(fy+oy)
            if not(0 <= x < w and 0 <= y < h and opaque[y,x]): continue
            z_body, z_furni = body['frontZ'][fy,fx], furniture[y,x]
            winner = 'uncertain' if not np.isfinite(z_body) or not np.isfinite(z_furni) else 'furniture' if z_furni > z_body else 'avatar'
            if winner == 'uncertain': unknown.append([x,y])
            points.append({'x':x,'y':y,'winner':winner,'source':context['context']['modelSource'],
                           'reason':f'Independent authored solid intersection; body method {body["methods"][fy,fx]}',
                           'bodyFrontZ':float(z_body) if np.isfinite(z_body) else None,
                           'surfaceFrontZ':float(z_furni) if np.isfinite(z_furni) else None})
        reviews.append({'context':context['context'], 'points':points, 'uncertainties':unknown,
                        'coverage':{'overlaps':len(points),'uncertain':len(unknown)},
                        'provenance':{'kind':'independent-authored-geometry-reference','bodyVersion':BODY_REFERENCE_VERSION,
                                      'sourceContextSha256':digest(data),'authoredGeometrySha256':digest({k:v for k,v in authored.items() if k!='z'}),
                                      'claim':'Numerical implementation parity for explicit authoring conventions. Separate visual-quality evidence is required.'}})
    return reviews


def propose(source, model, output):
    source, output = Path(source), Path(output)
    data = json.loads(source.read_text())
    surface = model['surfaces'][data['facing']]
    root = Path(__file__).parent
    sources = {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in
               ['seat_authored_review.py','seat_body_reference.py','seat_curved_authoring.py','seat_correspondence.py']}
    # Cache namespace excludes tested runtime depth, and binds all independent source/body inputs.
    geometry = {k:v for k,v in surface['authored'].items() if k!='z'}
    identity = digest({'source':data,'geometry':geometry,'generators':sources})
    folder = output / identity / data['facing']; folder.mkdir(parents=True, exist_ok=True)
    if (folder/'complete.json').exists(): return folder
    reviews = review(data, surface)
    for i, result in enumerate(reviews):
        result['provenance']['generators'] = sources
        (folder/f'context-{i}.json').write_text(json.dumps(result, allow_nan=False, indent=2))
    (folder/'complete.json').write_text(json.dumps({'identity':identity,'contexts':len(reviews),'status':'NUMERICAL_REFERENCE_ONLY'}))
    return folder
