"""Create a clay, geometry-only GLB proof from an extracted MAX blend.

Per-vertex entity indices survive meshopt reordering and allow picking individual
source objects after batching. Original geometry and textures are never changed.
This is not a material-faithful or survey-calibrated delivery.
"""
import argparse
import json
import struct
import sys
from pathlib import Path
import bpy
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--input', required=True)
p.add_argument('--output', required=True)
p.add_argument('--target-triangles', type=int, default=250000)
p.add_argument('--cluster-size', type=float, default=.35, help='Source-unit vertex clustering for disconnected fine detail')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
if not 10000 <= a.target_triangles <= 280000: raise ValueError('Invalid preview budget')
if not 0 < a.cluster_size <= 2: raise ValueError('Invalid detail clustering size')
out = Path(a.output).resolve(); out.mkdir(parents=True, exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
meshes = sorted((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: o.get('twinId', o.name))
counts = [sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes]
total = sum(counts)
# Leave room for small, simple objects, instead of collapsing every wall to dust.
base = sum(n if n <= 200 else 24 for n in counts)
ratio = max(.0001, (a.target_triangles - base) / max(total, 1))
entities, positions, normals, labels, stats = [], [], [], [], []
for obj, before in zip(meshes, counts):
    clustered = before
    if before > 1000:
        old = obj.data; old.calc_loop_triangles()
        coords = np.empty(len(old.vertices) * 3, dtype=np.float32)
        old.vertices.foreach_get('co', coords); coords = coords.reshape(-1, 3)
        if not np.isfinite(coords).all(): raise ValueError('Non-finite source coordinates: ' + obj.name)
        indices = np.empty(len(old.loop_triangles) * 3, dtype=np.int32)
        old.loop_triangles.foreach_get('vertices', indices)
        # Cluster only inside the same source object. Retain its ID and transform.
        grid = np.rint(coords / a.cluster_size).astype(np.int64)
        _, inverse = np.unique(grid, axis=0, return_inverse=True)
        sums = np.zeros((inverse.max() + 1, 3), dtype=np.float64)
        np.add.at(sums, inverse, coords)
        averaged = sums / np.bincount(inverse)[:, None]
        faces = inverse[indices].reshape(-1, 3)
        faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
        if len(faces):
            _, unique_indices = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
            faces = faces[np.sort(unique_indices)]
            rebuilt = bpy.data.meshes.new(old.name + '-clustered')
            rebuilt.from_pydata(averaged.tolist(), [], faces.tolist()); rebuilt.update()
            obj.data = rebuilt; clustered = len(faces)
        # If a small object collapses completely, preserve its original geometry.
    if before > 200:
        bpy.context.view_layer.objects.active = obj
        if obj.data.users > 1: obj.data = obj.data.copy()
        mod = obj.modifiers.new('Web proof reduction', 'DECIMATE')
        mod.ratio = min(1, max(24, before * ratio) / max(clustered, 1))
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    mesh = obj.data; mesh.calc_loop_triangles()
    after = len(mesh.loop_triangles)
    if not after: raise ValueError('Simplification removed source object: ' + obj.name)
    idx = len(entities)
    twin_id = obj.get('twinId', 'unmapped-' + obj.name)
    entities.append({'id': twin_id, 'nodeName': obj.name, 'label': obj.get('sourceName', obj.name),
                     'phase': None, 'buildingNumber': None, 'tenantNames': [], 'deviceIds': [],
                     'mappingStatus': 'unassigned-source-component'})
    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', coords); coords = coords.reshape(-1, 3)
    tris = np.empty(after * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get('vertices', tris)
    matrix = np.array(obj.matrix_world, dtype=np.float32)
    world = coords @ matrix[:3, :3].T + matrix[:3, 3]
    if not np.isfinite(world).all(): raise ValueError('Non-finite transformed coordinates: ' + obj.name)
    # Blender Z-up -> glTF Y-up, determinant +1; not a mirror or guessed metric scale.
    world = world[:, [0, 2, 1]]; world[:, 2] *= -1
    vertices = world[tris].reshape(-1, 3)
    faces = vertices.reshape(-1, 3, 3)
    n = np.cross(faces[:, 1] - faces[:, 0], faces[:, 2] - faces[:, 0])
    lengths = np.linalg.norm(n, axis=1)
    n /= np.maximum(lengths[:, None], 1e-20)
    n[lengths < 1e-20] = (0, 1, 0)
    positions.append(vertices); normals.append(np.repeat(n, 3, axis=0))
    labels.append(np.full(len(vertices), idx, dtype=np.uint16))
    stats.append({'id': twin_id, 'before': before, 'clustered': clustered, 'after': after})
    if (idx + 1) % 100 == 0: print('MAX_WEB_PROGRESS', idx + 1, len(meshes), flush=True)
if len(entities) > 65535: raise ValueError('Too many entities for uint16')
pos = np.concatenate(positions).astype('<f4'); norm = np.concatenate(normals).astype('<f4')
ids = np.concatenate(labels).astype('<u2')
triangles = len(pos) // 3
(out / 'simplification.json').write_text(json.dumps({'input': a.input, 'originalTriangles': total, 'triangles': triangles,
                                                   'sourceObjects': len(entities), 'clusterSizeSourceUnits': a.cluster_size, 'objects': stats}, indent=2))
if triangles > 300000: raise ValueError(f'Budget exceeded after simplification: {triangles}')
binary = bytearray(); views = []; accessors = []
def attribute(values, kind, component, bounds=False):
    while len(binary) % 4: binary.append(0)
    offset = len(binary); payload = values.tobytes(); binary.extend(payload)
    views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload), 'target': 34962})
    entry = {'bufferView': len(views) - 1, 'componentType': component, 'count': len(values), 'type': kind}
    if bounds: entry.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
    accessors.append(entry); return len(accessors) - 1
attrs = {'POSITION': attribute(pos, 'VEC3', 5126, True), 'NORMAL': attribute(norm, 'VEC3', 5126),
         '_ENTITY_ID': attribute(ids, 'SCALAR', 5123)}
document = {'asset': {'version': '2.0', 'generator': 'Smart Control local MAX geometry proof'},
            'scene': 0, 'scenes': [{'nodes': [0]}],
            'nodes': [{'mesh': 0, 'name': 'Jinhu source geometry - clay review',
                       'extras': {'twinId': 'jinhu-clay-batch', 'sourceEntities': entities, 'materialMode': 'clay-preview'}}],
            'meshes': [{'primitives': [{'attributes': attrs, 'material': 0}]}],
            'materials': [{'name': 'Review clay - not original material', 'doubleSided': True,
                           'pbrMetallicRoughness': {'baseColorFactor': [.48, .59, .64, 1], 'metallicFactor': 0, 'roughnessFactor': .95}}],
            'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(binary)}]}
metadata = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4); binary += b'\0' * (-len(binary) % 4)
glb = struct.pack('<III', 0x46546c67, 2, 12 + 8 + len(metadata) + 8 + len(binary))
glb += struct.pack('<II', len(metadata), 0x4e4f534a) + metadata + struct.pack('<II', len(binary), 0x004e4942) + binary
(out / 'scene-source.glb').write_bytes(glb)
manifest = {'schemaVersion': 1, 'sourceId': 'jinhu-max-local-clay', 'fixture': False, 'asset': 'scene.glb',
            'units': 'unverified-source-units', 'upAxis': 'Y', 'materialMode': 'clay-preview',
            'geometryType': 'real-max-decimated-components', 'entities': entities,
            'acceptance': {'front': False, 'opposite': False, 'scale': False, 'materials': False},
            'telemetry': {'mode': 'disconnected', 'readOnly': True},
            'limitations': ['Some source nodes skipped by importer; inspect import report', 'Clay material, original materials incomplete',
                            'Source component IDs are revision-local, not verified building IDs', 'Scale and completeness unverified']}
(out / 'twin-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('MAX_WEB_RESULT', json.dumps({'triangles': triangles, 'sourceObjects': len(entities), 'bytesUncompressed': len(glb)}), flush=True)
