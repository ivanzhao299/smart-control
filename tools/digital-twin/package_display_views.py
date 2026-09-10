"""Encode offline renders as bounded-size WebP; do not publish source models."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True)
p.add_argument('--clay');p.add_argument('--landscape')
a=p.parse_args();src=Path(a.input);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
manifest=json.loads((src/'display-manifest.json').read_text());sizes={}
for v in manifest['views']:
    for lighting,name in v['images'].items():
        with Image.open(src/name.replace('.webp','.png')) as image:
            assert image.size==tuple(manifest['dimensions'])
            image.convert('RGB').save(out/name,'WEBP',quality=86,method=6)
        size=(out/name).stat().st_size
        if size>1_000_000:raise ValueError('View exceeds 1 MB budget: '+name)
        sizes[name]=size
    name=f'{v["id"]}-clay.webp'
    clay_path=Path(a.clay)/(v['id']+'.png') if a.clay else src/name.replace('.webp','.png')
    with Image.open(clay_path) as image:
        assert image.size==tuple(manifest.get('clayDimensions',[1280,884]))
        image.convert('RGB').save(out/name,'WEBP',quality=86,method=6)
    v['clayImage']=name;sizes[name]=(out/name).stat().st_size
    if sizes[name]>1_000_000:raise ValueError('Clay view exceeds 1 MB budget: '+name)
total=sum(sizes.values())
if total>10_000_000:raise ValueError('View package exceeds 10 MB')
if a.landscape:
    landscape=json.loads(Path(a.landscape).read_text())
    manifest['landscapeSummary']={k:landscape[k] for k in ['treeCount','parkTrees','provenance','sourceGeometryUnchanged']}
manifest['bytesByImage']=sizes;manifest['totalImageBytes']=total
manifest['imageHashes']={name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in sizes}
(out/'display-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'images':len(sizes),'bytes':total,'maxViewBytes':max(sizes.values()),'trees':manifest['landscapeSummary']['treeCount']}))
