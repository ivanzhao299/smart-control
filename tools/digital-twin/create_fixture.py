"""Synthetic geometry only, to test opposite camera and stable IDs without the real MAX."""
import sys
from pathlib import Path
import bpy

dest = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
if dest.exists():
    raise ValueError('Fixture output already exists')
dest.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
for index, (location, scale, color) in enumerate([
    ((0, 0, -0.3), (16, 12, 0.3), (0.13, 0.25, 0.26, 1)),
    ((-6, 3, 2), (3, 2, 2), (0.17, 0.58, 0.68, 1)),
    ((5, -2, 4), (2, 3, 4), (0.82, 0.42, 0.16, 1)),
    ((-6, 5.1, 2), (2, 0.1, 0.5), (0.9, 0.2, 0.3, 1)),
]):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
    obj = bpy.context.object
    obj.name = ['fixture-ground', 'fixture-A', 'fixture-B', 'fixture-rear-marker'][index]
    obj.scale = scale
    obj['twinId'] = obj.name
    mat = bpy.data.materials.new(obj.name)
    mat.diffuse_color = color
    mat.use_nodes = True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = color
    if index == 1:
        image = bpy.data.images.new('fixture-checker', width=64, height=64)
        image.pixels = [channel for y in range(64) for x in range(64) for channel in ((.2, .7, .8, 1) if (x // 8 + y // 8) % 2 else (.1, .3, .4, 1))]
        image.filepath_raw = str(dest.parent / 'fixture-checker.png')
        image.file_format = 'PNG'
        image.save()
        image.pack()
        texture = mat.node_tree.nodes.new('ShaderNodeTexImage'); texture.image = image
        mat.node_tree.links.new(texture.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    obj.data.materials.append(mat)
    if index == 2:
        back = bpy.data.materials.new('fixture-B-second-material')
        back.diffuse_color = (.3, .18, .1, 1)
        back.use_nodes = True
        back.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = back.diffuse_color
        obj.data.materials.append(back)
        obj.data.polygons[0].material_index = 1
if dest.suffix.lower() == '.fbx':
    bpy.ops.export_scene.fbx(filepath=str(dest), use_custom_props=True, bake_anim=False, path_mode='COPY', embed_textures=True)
else:
    bpy.ops.export_scene.gltf(filepath=str(dest), export_format='GLB', export_extras=True)
