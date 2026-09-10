"""Render genuine 3D camera/light presets offline; the screen only loads WebP views."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--cameras',required=True)
p.add_argument('--fit',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
scene=bpy.context.scene;cam=scene.camera
views=json.loads(Path(a.cameras).read_text())['views']
fit=json.loads(Path(a.fit).read_text())
scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=32
scene.render.resolution_x=1600;scene.render.resolution_y=1105;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
world=scene.world.node_tree.nodes['Background']
suns=[o for o in scene.objects if o.type=='LIGHT' and o.data.type=='SUN']
if not suns:
    sun=bpy.data.objects.new('DisplaySun',bpy.data.lights.new('DisplaySun','SUN'));scene.collection.objects.link(sun);suns=[sun]
for sun in suns:
    sun.rotation_euler=(math.radians(32),math.radians(-23),math.radians(-32));sun.data.angle=math.radians(12)
glass=[]
for mat in bpy.data.materials:
    if mat.use_nodes and ('玻璃' in mat.name or 'glass' in mat.name.lower()):
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:glass.append(bsdf)
labels={'office-tower':'办公高楼','office-lake-north':'湖畔小楼','factory-south-long':'长栋厂房','factory-east-end':'标准厂房'}
anchors=[{'id':p['name'],'label':labels[p['name']],'world':p['world'],'sourceObject':p['object']} for p in fit['landmarks'] if p['name'] in labels]
manifest={'version':1,'revision':'jinhu-camera-20260910-v1','renderMode':'offline-real-3d-camera-cache',
 'dimensions':[1600,1105],'defaultView':'opposite','defaultLighting':'day','views':[],
 'anchors':anchors,'sourceGeometry':'actual-local-MAX-extraction','landscape':'reference-inspired-not-surveyed',
 'productionEligible':False,'businessData':'demo-or-unassigned','continuousWebGL':False,
 'limitations':['No free-orbit in the low-power screen; these are actual camera renders, not live 3D.',
                'Vegetation is reconstructed, not a tree-by-tree survey.','Source scale and official building/tenant mapping remain unverified.']}
for v in views:
    cam.data.type=v['type'];cam.data.lens=v['lens'];cam.data.ortho_scale=v['orthoScale']
    cam.location=v['camera'];cam.rotation_euler=v['rotation'];bpy.context.view_layer.update()
    projected={}
    for anchor in anchors:
        point=world_to_camera_view(scene,cam,Vector(anchor['world']))
        projected[anchor['id']]={'x':point.x*100,'y':(1-point.y)*100,'visible':point.z>0 and 0<=point.x<=1 and 0<=point.y<=1}
    item={**v,'labels':projected,'images':{}}
    for lighting in ['day','night']:
        night=lighting=='night'
        world.inputs['Color'].default_value=(.19,.30,.50,1) if night else (.65,.75,.9,1)
        world.inputs['Strength'].default_value=.20 if night else .48
        for sun in suns:
            sun.data.energy=.38 if night else 2.2
            sun.data.color=(.48,.65,1) if night else (1,.93,.83)
        for bsdf in glass:
            bsdf.inputs['Emission Color'].default_value=(1,.52,.18,1) if night else (0,0,0,1)
            bsdf.inputs['Emission Strength'].default_value=.65 if night else 0
        scene.view_settings.exposure=.25 if night else 0
        file=f'{v["id"]}-{lighting}.png';scene.render.filepath=str(out/file)
        bpy.ops.render.render(write_still=True);item['images'][lighting]=file.replace('.png','.webp')
    manifest['views'].append(item)
(out/'display-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('DISPLAY_VIEWS',len(views)*2,'glassMaterials',len(glass),flush=True)
