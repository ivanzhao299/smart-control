"""Run with Blender --background --factory-startup --python ... -- [options]."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='FBX, GLB or glTF with associated resources')
    parser.add_argument('--output', required=True, help='Fresh output directory')
    parser.add_argument('--source-id', required=True, help='Stable model identity, e.g. jinhu-park; reuse for revisions')
    parser.add_argument('--ratio', type=float, default=1.0, help='Explicit optional mesh simplification, 0.05..1')
    parser.add_argument('--texture-size', type=int, default=2048)
    parser.add_argument('--fixture', action='store_true', help='Label this as synthetic test data')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    if output.exists():
        raise ValueError('Output exists; use a fresh directory')
    if not (0.05 <= args.ratio <= 1) or args.texture_size not in (1024, 2048, 4096):
        raise ValueError('Invalid optimization parameters')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if source.suffix.lower() == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(source), use_custom_props=True)
    elif source.suffix.lower() in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=str(source))
    else:
        raise ValueError('Export MAX to FBX first; MAX is not accepted by Blender')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise ValueError('No mesh geometry in exported scene')
    output.mkdir(parents=True)
    entities, used_ids = [], set()
    for obj in meshes:
        # Preserve worker IDs across FBX -> glTF; fallback name IDs require review on renamed revisions.
        twin_id = str(obj.get('twinId', '')) or 'node-' + hashlib.sha256((args.source_id + ':' + obj.name).encode()).hexdigest()[:16]
        if twin_id in used_ids:
            raise ValueError(f'Duplicate twinId: {twin_id}')
        used_ids.add(twin_id)
        obj['twinId'] = twin_id
        entities.append({'id': twin_id, 'nodeName': obj.name, 'label': obj.get('sourceName', obj.name),
                         'phase': None, 'buildingNumber': None, 'tenantNames': [], 'deviceIds': [],
                         'mappingStatus': 'unassigned'})
        if args.ratio < 1 and len(obj.data.polygons) > 100:
            mod = obj.modifiers.new('Web mesh simplification', 'DECIMATE')
            mod.ratio = args.ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
    missing = []
    for image in bpy.data.images:
        if image.source not in ('FILE', 'GENERATED'):
            continue
        if not image.has_data:
            missing.append(image.name)
            continue
        w, h = image.size
        if max(w, h) > args.texture_size:
            scale = args.texture_size / max(w, h)
            image.scale(max(1, round(w * scale)), max(1, round(h * scale)))
    if missing:
        raise ValueError('Missing image data: ' + ', '.join(missing))
    bpy.ops.export_scene.gltf(filepath=str(output / 'scene-source.glb'), export_format='GLB',
                             export_extras=True, export_yup=True, export_apply=True,
                             export_animations=False, export_cameras=False, export_lights=False,
                             export_image_format='AUTO')
    manifest = {
        'schemaVersion': 1, 'sourceId': args.source_id, 'asset': 'scene.glb',
        'units': 'metres', 'upAxis': 'Y', 'fixture': args.fixture,
        'geometryType': 'mesh-scene-unreviewed', 'acceptance': {'front': False, 'opposite': False, 'scale': False, 'materials': False},
        'phases': [{'id': 'phase-1', 'label': '一期'}, {'id': 'phase-2', 'label': '二期'}, {'id': 'future', 'label': '远期'}],
        'entities': entities,
        'cameraPresets': [{'id': 'front', 'azimuthDegrees': 0, 'elevationDegrees': 40},
                          {'id': 'opposite', 'azimuthDegrees': 180, 'elevationDegrees': 40}],
        'telemetry': {'mode': 'disconnected', 'readOnly': True, 'staleAfterSeconds': 60},
    }
    (output / 'twin-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('TWIN_CONVERTED', json.dumps({'meshes': len(meshes), 'glbBytes': (output / 'scene-source.glb').stat().st_size}))


if __name__ == '__main__':
    main()
