"""Offline opposite-camera evidence for extracted MAX geometry, not an AI image."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

p = argparse.ArgumentParser()
p.add_argument('--input', required=True)
p.add_argument('--output', required=True)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(a.output); out.mkdir(parents=True, exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
corners = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
lo = Vector([min(v[k] for v in corners) for k in range(3)])
hi = Vector([max(v[k] for v in corners) for k in range(3)])
center = (lo + hi) / 2
span = max(hi - lo)
cam = bpy.data.objects.new('ReviewCamera', bpy.data.cameras.new('ReviewCamera'))
scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = span * 1.18
cam.data.clip_start = .1; cam.data.clip_end = span * 10
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.display.shading.background_type = 'WORLD'
if scene.world is None: scene.world = bpy.data.worlds.new('ReviewWorld')
scene.world.color = (.07, .08, .10)
scene.render.resolution_x = 1400; scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
matrices = {o.name: [list(row) for row in o.matrix_world] for o in meshes}
evidence = {'source': str(Path(a.input).resolve()), 'synthetic': False, 'materialFidelity': 'unverified-solid-review', 'views': []}
for name, angle in [('front', -55), ('opposite', 125)]:
    rad = math.radians(angle)
    cam.location = center + Vector((math.cos(rad), math.sin(rad), .92)) * span * 1.8
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / (name + '.png'))
    bpy.ops.render.render(write_still=True)
    evidence['views'].append({'name': name, 'azimuth': angle, 'camera': list(cam.location)})
evidence['geometryUnchanged'] = all(matrices[o.name] == [list(row) for row in o.matrix_world] for o in meshes)
(out / 'camera-evidence.json').write_text(json.dumps(evidence, indent=2))
