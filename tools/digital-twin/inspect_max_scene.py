"""Local source-structure diagnostics; skips geometry construction and scene scripts."""
import argparse
import collections
import importlib.util
import json
import os
import sys
from pathlib import Path
import bpy
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).resolve().parent))
from max_streams import install

p = argparse.ArgumentParser()
p.add_argument('--model', required=True); p.add_argument('--plugin', required=True); p.add_argument('--output', required=True)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
sys.path.append(str(Path(os.environ.get('TWIN_HOME', Path.home() / '.local/share/smart-control-twin')) / 'runtime/py311/lib/python3.11/site-packages'))
spec = importlib.util.spec_from_file_location('max_inspect_parser', Path(a.plugin) / 'source/import_max.py')
imp = importlib.util.module_from_spec(spec); spec.loader.exec_module(imp); install(imp)
def value(v):
    if isinstance(v, bytes): return {'bytes': len(v), 'hex': v[:1000].hex()}
    if isinstance(v, (list, tuple)): return [value(x) for x in v[:30]]
    if isinstance(v, (str, int, float, bool)) or v is None: return v
    return str(v)[:300]
def dump(c, depth=2):
    if c is None: return None
    d = {'type': hex(c.types), 'guid': hex(imp.get_guid(c)), 'class': imp.get_cls_name(c)}
    if hasattr(c, 'data'): d['data'] = value(c.data)
    if depth > 0 and hasattr(c, 'children'): d['children'] = [dump(ch, depth-1) for ch in c.children[:40]]
    return d
def diagnose(context, settings, mscale, transform, parent):
    nodes = parent.children
    nodeidx = {id(n): i for i, n in enumerate(nodes)}
    mats, meshes, cls = {}, {}, collections.Counter()
    for i, n in enumerate(nodes):
        guid = imp.get_guid(n); cls[hex(guid) + ' ' + imp.get_cls_name(n)] += 1
        if not imp.get_node_parent(n): continue
        prs, mesh, mat, layer = imp.get_matrix_mesh_material(n)
        for obj, dest in [(mat, mats), (mesh, meshes)]:
            if obj is None: continue
            key = str(nodeidx.get(id(obj)))
            if key not in dest:
                refs = imp.get_references(obj); kv = imp.get_reference(obj)
                dest[key] = {'nodeIndex': nodeidx.get(id(obj)), 'name': imp.get_node_name(n), 'count': 0,
                             'chunk': dump(obj), 'refs': [nodeidx.get(id(r)) for r in refs],
                             'keyRefs': {str(k): nodeidx.get(id(v)) for k, v in kv.items()}}
            dest[key]['count'] += 1
    relevant = set()
    for d in mats.values(): relevant.update(d['refs']); relevant.update(d['keyRefs'].values())
    def refdump(i):
        n = nodes[i]
        return {'chunk': dump(n), 'refs': [nodeidx.get(id(r)) for r in imp.get_references(n)],
                'keyRefs': {str(k): nodeidx.get(id(v)) for k,v in imp.get_reference(n).items()}}
    references = {str(i): refdump(i) for i in relevant if i is not None}
    for d in list(references.values()): relevant.update(d['refs']); relevant.update(d['keyRefs'].values())
    references.update({str(i): refdump(i) for i in relevant if i is not None and str(i) not in references})
    extras = {}; captured = collections.Counter()
    for i, n in enumerate(nodes):
        guid = imp.get_guid(n)
        if guid in (0xa, 0xa0, 0x1040, 0xf72b1) and captured[guid] < 3:
            captured[guid] += 1
            extras[str(i)] = {'chunk': dump(n, 5), 'refs': [nodeidx.get(id(r)) for r in imp.get_references(n)]}
    # Follow geometry modifier chains for the first dropped rectangle and line.
    queue = [1360, 1361, 1364, 1474, 1503, 1532]
    for _ in range(4):
        next_ids = []
        for i in queue:
            if i is None or str(i) in extras: continue
            n = nodes[i]; refs = imp.get_references(n)
            extras[str(i)] = {'chunk': dump(n, 5), 'refs': [nodeidx.get(id(r)) for r in refs]}
            next_ids.extend(nodeidx.get(id(r)) for r in refs)
        queue = next_ids
    from max_splines import legacy_float, legacy_int
    ground = []; cap_settings = []
    for n in nodes:
        if not imp.get_node_parent(n): continue
        name = imp.get_node_name(n)
        detailed = name in ['Circle001','Rectangle003','Rectangle004','图形040','图形041']
        prs, base, mat, layer = imp.get_matrix_mesh_material(n)
        item = {'name':name,'pivot':[dump(n.get_first(t),2) for t in [0x96A,0x96B,0x96C]],'modifiers':[]}
        seen = set()
        while base and imp.get_guid(base) in (0x2032,0x2033) and id(base) not in seen:
            seen.add(id(base)); refs = imp.get_references(base)
            if not refs: break
            for mod in refs[:-1]:
                if detailed:
                    item['modifiers'].append({'class':imp.get_cls_name(mod),'chunk':dump(mod,3),
                        'parameters':[dump(r,5) for r in imp.get_references(mod)]})
                if imp.get_guid(mod)==0xA0:
                    params=imp.get_references(mod)
                    if params: cap_settings.append({'name':name,'amount':legacy_float(params[0],0),
                        'capStart':legacy_int(params[0],2),'capEnd':legacy_int(params[0],3)})
            base = refs[-1]
        if detailed: ground.append(item)
    result = {'sceneNodes': len(nodes), 'classes': dict(cls), 'materials': mats, 'meshes': meshes, 'references': references, 'extraGeometry': extras,'ground':ground,'capSettings':cap_settings}
    with Path(a.output).open('x') as f: json.dump(result, f, ensure_ascii=False, indent=2)
    print('DIAGNOSTICS', len(nodes), 'materialNodes', len(mats), 'meshNodes', len(meshes), flush=True)
    return []
imp.make_scene = diagnose
imp.read(bpy.context, str(Path(a.model).resolve()), Matrix.Identity(4), obtypes={'MATERIAL', 'UV', 'PRIMITIVE', 'EMPTY'}, search=False, transform=True)
