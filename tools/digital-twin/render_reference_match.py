"""Render actual recovered MAX geometry for reference matching (no AI/image warp)."""
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
p.add_argument('--azimuth', type=float, default=-135)
p.add_argument('--elevation', type=float, default=45)
p.add_argument('--center', type=float, nargs=3, default=[277, -101, 0])
p.add_argument('--scale', type=float, default=1250)
p.add_argument('--distance', type=float, default=1400)
p.add_argument('--lens', type=float, default=38)
p.add_argument('--perspective', action='store_true')
p.add_argument('--textured', action='store_true')
p.add_argument('--top', action='store_true')
p.add_argument('--save-scene', action='store_true')
p.add_argument('--fit', help='Landmark camera-fit JSON')
p.add_argument('--clean-frustum', action='store_true', help='Clip only the derived review copy to this camera frustum')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
if a.fit:
    fit = json.loads(Path(a.fit).read_text()); values = fit['parameters']
    a.center = [values['centerX'], values['centerY'], 0]
    a.azimuth = values['azimuth']; a.elevation = values['elevation']
    a.distance = values['distance']; a.lens = fit['lensMm']; a.perspective = True
out = Path(a.output); out.mkdir(parents=True, exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
cam = bpy.data.objects.new('ReferenceMatchCamera', bpy.data.cameras.new('ReferenceMatchCamera'))
scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'PERSP' if a.perspective else 'ORTHO'
cam.data.ortho_scale = a.scale
cam.data.lens = a.lens
cam.data.clip_start = .1; cam.data.clip_end = 15000
center = Vector(a.center)
az, el = math.radians(a.azimuth), math.radians(a.elevation)
cam.location = center + a.distance * Vector((math.cos(el)*math.cos(az), math.cos(el)*math.sin(az), math.sin(el)))
if a.top: cam.location = center + Vector((0, 0, a.distance))
cam.rotation_euler = (center-cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'BLENDER_EEVEE_NEXT' if a.textured else 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.display.shading.background_type = 'WORLD'
if scene.world is None: scene.world = bpy.data.worlds.new('ReferenceWorld')
scene.world.color = (.22, .25, .3)
if a.textured:
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.65, .75, .9, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
    sun = bpy.data.objects.new('ReviewSun', bpy.data.lights.new('ReviewSun', 'SUN'))
    scene.collection.objects.link(sun); sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(28), math.radians(-25), math.radians(-30))
    scene.eevee.taa_render_samples = 16
scene.render.resolution_x = 1280; scene.render.resolution_y = 884
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(out / 'matched.png')
bpy.context.view_layer.update()
cleanup = {'removedObjects': [], 'clippedObjects': [], 'sourceUntouched': True}
if a.clean_frustum:
    if not a.perspective: raise ValueError('Frustum cleanup requires a perspective camera')
    import bmesh
    rotation = cam.matrix_world.to_quaternion()
    right, up, forward = [rotation @ Vector(v) for v in [(1,0,0),(0,1,0),(0,0,-1)]]
    tx = 18 / cam.data.lens; ty = tx * 884 / 1280
    planes = [right+tx*forward, -right+tx*forward, up+ty*forward, -up+ty*forward]
    for obj in list(meshes):
        corners = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        distances = [[(v-cam.location).dot(n) for v in corners] for n in planes]
        if any(max(ds) < -.001 for ds in distances):
            cleanup['removedObjects'].append({'name': obj.name, 'id': obj.get('twinId')})
            meshes.remove(obj); bpy.data.objects.remove(obj, do_unlink=True)
            continue
        crossing = [n for n,ds in zip(planes,distances) if min(ds)<-.001]
        if not crossing: continue
        old_vertices = len(obj.data.vertices)
        obj.data = obj.data.copy()  # shared mesh users must remain unaffected
        bm = bmesh.new(); bm.from_mesh(obj.data)
        inv = obj.matrix_world.inverted()
        for n in crossing:
            bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                dist=.00001, plane_co=inv @ cam.location,
                plane_no=(obj.matrix_world.to_3x3().transposed() @ n).normalized(),
                clear_inner=True, clear_outer=False)
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
        cleanup['clippedObjects'].append({'name':obj.name,'id':obj.get('twinId'),
            'verticesBefore':old_vertices,'verticesAfter':len(obj.data.vertices)})
    bpy.context.view_layer.update()
objects = []
for o in meshes:
    corners = [o.matrix_world @ Vector(v) for v in o.bound_box]
    lo = [min(v[k] for v in corners) for k in range(3)]
    hi = [max(v[k] for v in corners) for k in range(3)]
    objects.append({'name': o.name, 'id': o.get('twinId'), 'min': lo, 'max': hi,
                    'materials': [m.name.split('_')[0] for m in o.data.materials if m]})
(out / 'evidence.json').write_text(json.dumps({'source': a.input, 'parameters': vars(a),
    'camera': list(cam.location), 'rotation': list(cam.rotation_euler), 'objects': objects,
    'synthetic': False, 'productionEligible': False, 'cleanup':cleanup}, ensure_ascii=False, indent=2))
bpy.ops.render.render(write_still=True)
if a.save_scene: bpy.ops.wm.save_as_mainfile(filepath=str(out / 'comparison.blend'), compress=True)
