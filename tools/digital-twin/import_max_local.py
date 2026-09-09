"""Read MAX locally through pinned io_scene_max, collecting evidence of partial imports.

Run in Blender with --disable-autoexec. Never executes MAXScript or requires Autodesk.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path, PureWindowsPath
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from max_streams import PIN, install


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', required=True)
    p.add_argument('--textures', required=True)
    p.add_argument('--plugin', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--scale', type=float, default=1.0)
    a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    plugin = Path(a.plugin).resolve()
    actual_pin = subprocess.check_output(['git', '-C', str(plugin), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(plugin), 'status', '--porcelain', '--untracked-files=no'], text=True).strip()
    if actual_pin != PIN or dirty: raise ValueError('Importer must match the clean audited commit')
    root = Path(os.environ.get('TWIN_HOME', Path.home() / '.local/share/smart-control-twin'))
    sys.path.append(str(root / 'runtime/py311/lib/python3.11/site-packages'))
    out = Path(a.output).resolve(); out.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location('max_parser', Path(a.plugin) / 'source/import_max.py')
    importer = importlib.util.module_from_spec(spec); spec.loader.exec_module(importer)
    install(importer)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    textures = {f.name.casefold(): f for f in Path(a.textures).iterdir() if f.is_file()}
    # The upstream metadata parser drops UTF-16 null bytes. Resolve only an exact,
    # unambiguous encoding alias to a supplied local file, never guess a texture.
    aliases = {}
    for f in textures.values():
        alias = f.name.encode('utf-16le').replace(b'\0', b'').decode('utf-8', 'ignore').casefold()
        aliases.setdefault(alias, []).append(f)
    report = {'importer': 'nrgsille76/io_scene_max', 'pin': PIN, 'state': 'IMPORTING',
              'scaleApplied': a.scale, 'scaleVerified': False, 'oppositeCameraVerified': False,
              'created': [], 'errors': [], 'skipped': [], 'missingTextures': [], 'textureRequests': []}
    original_loader = importer.load_image
    def local_image(name, dirname, **kwargs):
        base = PureWindowsPath(str(name)).name.casefold()
        report['textureRequests'].append(base)
        file = textures.get(base)
        if not file and len(aliases.get(base, [])) == 1: file = aliases[base][0]
        if not file:
            report['missingTextures'].append(base)
            return None
        return original_loader(str(file), str(file.parent), place_holder=False, recursive=False, check_existing=True)
    importer.load_image = local_image
    original_create = importer.create_object
    counter = 0
    def create(context, settings, node, transform):
        nonlocal counter
        counter += 1
        name = importer.get_node_name(node)
        try:
            result = original_create(context, settings, node, transform)
            if not result[1]:
                _, mesh, _, _ = importer.get_matrix_mesh_material(node)
                report['skipped'].append({'name': name, 'class': importer.get_cls_name(mesh) if mesh else None})
            for i, obj in enumerate(result[1]):
                obj['twinId'] = f'jinhu-max-{counter:05d}-{i}'
                obj['sourceName'] = name
                obj['sourceRevisionNode'] = counter
            report['created'].append({'sourceName': name, 'objects': [o.name for o in result[1]]})
            return result
        except Exception as exc:
            report['errors'].append({'name': name, 'type': type(exc).__name__, 'error': str(exc)})
            raise
    importer.create_object = create
    started = time.time()
    try:
        importer.read(bpy.context, str(Path(a.model).resolve()), Matrix.Scale(a.scale, 4),
                      obtypes={'MATERIAL', 'UV', 'PRIMITIVE', 'EMPTY'}, search=False, transform=True)
        bpy.context.view_layer.update()
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        corners = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
        report['meshObjects'] = len(meshes)
        report['vertices'] = sum(len(o.data.vertices) for o in meshes)
        report['triangles'] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
        report['materials'] = len(bpy.data.materials)
        report['images'] = [{'name': image.name, 'size': list(image.size), 'loaded': image.has_data} for image in bpy.data.images]
        report['bounds'] = {'min': [min(v[k] for v in corners) for k in range(3)], 'max': [max(v[k] for v in corners) for k in range(3)]} if corners else None
        report['objectStats'] = [{'name': o.name, 'id': o.get('twinId'), 'vertices': len(o.data.vertices),
                                  'polygons': len(o.data.polygons), 'materials': [s.name for s in o.material_slots],
                                  'uvLayers': len(o.data.uv_layers), 'location': list(o.matrix_world.translation)} for o in meshes]
        report['state'] = 'IMPORTED_NEEDS_VISUAL_REVIEW' if meshes else 'NO_GEOMETRY'
        report['elapsedSeconds'] = round(time.time() - started, 2)
        (out / 'import-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if meshes:
            for image in bpy.data.images:
                if image.has_data: image.pack()
            bpy.ops.wm.save_as_mainfile(filepath=str(out / 'imported.blend'), compress=True)
        print('MAX_IMPORT_RESULT', json.dumps({k: report[k] for k in ('state', 'meshObjects', 'vertices', 'triangles', 'materials', 'bounds', 'elapsedSeconds')}), flush=True)
    except Exception as exc:
        report['state'] = 'FAILED'; report['fatalError'] = repr(exc)
        (out / 'import-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        raise


if __name__ == '__main__': main()
