"""Read-only multi-camera clay review of the accepted reference scene."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

p=argparse.ArgumentParser()
p.add_argument('--input',required=True);p.add_argument('--fit',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
scene=bpy.context.scene;cam=scene.camera
fit=json.loads(Path(a.fit).read_text())['parameters']
objects=[o for o in scene.objects if o.type=='MESH']
def fingerprint():
    h=hashlib.sha256()
    for o in objects:
        h.update(o.name.encode());h.update(str([list(r) for r in o.matrix_world]).encode())
        h.update(str((len(o.data.vertices),len(o.data.polygons))).encode())
    return h.hexdigest()
before=fingerprint()
scene.render.engine='BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples=16
clay=bpy.data.materials.new('AuditClay');clay.use_nodes=True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.67,.71,.75,1)
clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.85
scene.view_layers[0].material_override=clay
# Imported smooth normals on simple context boxes mimic dents; use faceted review shading.
for obj in objects:
    obj.data.materials.clear();obj.data.materials.append(clay)
    for polygon in obj.data.polygons:
        polygon.use_smooth=False;polygon.material_index=0
scene.display.shading.light='STUDIO';scene.display.shading.color_type='SINGLE'
scene.display.shading.single_color=(.72,.75,.78)
scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH';scene.display.shading.background_type='WORLD'
scene.world.color=(.12,.15,.19)
scene.render.resolution_x=1280;scene.render.resolution_y=884;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
reference_position=cam.location.copy();reference_rotation=cam.rotation_euler.copy()
park_bounds=[Vector((x,y,z)) for x in [-55,555] for y in [-460,240] for z in [0,60]]
views=[]
for name,delta in [('reference',0),('opposite',180),('left',90),('right',-90),('top',0)]:
    cam.data.type='PERSP'
    if name=='reference':cam.location=reference_position;cam.rotation_euler=reference_rotation
    else:
        center=Vector((250,-110,15));az=math.radians(fit['azimuth']+delta);el=math.radians(fit['elevation'])
        direction=Vector((math.cos(el)*math.cos(az),math.cos(el)*math.sin(az),math.sin(el)))
        if name=='top':
            direction=Vector((0,0,1));cam.data.type='ORTHO';cam.data.ortho_scale=1200
        distance=fit['distance']
        for _ in range(30):
            cam.location=center+distance*direction
            cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
            bpy.context.view_layer.update()
            uv=[world_to_camera_view(scene,cam,v) for v in park_bounds]
            if all(.06<v.x<.94 and .06<v.y<.94 and v.z>0 for v in uv):break
            distance*=1.06
    bpy.context.view_layer.update()
    scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
    views.append({'id':name,'azimuthDeltaDegrees':delta,'camera':list(cam.location),
        'rotation':list(cam.rotation_euler),'type':cam.data.type,'lens':cam.data.lens,'orthoScale':cam.data.ortho_scale})
after=fingerprint();assert before==after
report={'source':a.input,'referenceCorrespondence':'user-confirmed','views':views,
    'meshObjects':len(objects),'geometryFingerprintBefore':before,'geometryFingerprintAfter':after,
    'geometryUnchanged':True,'synthetic':False,'reviewStatus':'awaiting-multiview-inspection','productionEligible':False}
(out/'review.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
