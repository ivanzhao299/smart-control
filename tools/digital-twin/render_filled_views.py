"""Render a real-camera overscan pack with measured subject bounds for responsive framing.

Only presentation ground/forest is extended. No source building is moved, cloned or scaled.
Overscan is cropped by the viewer, not stretched. Source coordinates are not surveyed units.
"""
import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

p=argparse.ArgumentParser()
for name in ('input','cameras','fit','landscape','output'):p.add_argument('--'+name,required=True)
p.add_argument('--preview',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
scene=bpy.context.scene;cam=scene.camera
source=[o for o in scene.objects if o.type=='MESH']
def fingerprint():
    h=hashlib.sha256()
    for o in source:
        h.update(o.name.encode());h.update(str([list(r) for r in o.matrix_world]).encode())
        h.update(str((len(o.data.vertices),len(o.data.polygons))).encode())
    return h.hexdigest()
before=fingerprint()
# Small detailed meshes within the known park extent define the framing, not the background.
subject=[];subject_names=[]
for obj in source:
    if obj.name.startswith('landscape-') or obj.name in {'对象614','对象615','对象616','对象617','对象618','对象619'}:continue
    points=[obj.matrix_world@Vector(v) for v in obj.bound_box]
    lo=Vector(tuple(min(v[k] for v in points) for k in range(3)))
    hi=Vector(tuple(max(v[k] for v in points) for k in range(3)))
    mid=(lo+hi)/2
    if -65<mid.x<625 and -455<mid.y<250 and hi.z>5 and max(hi.x-lo.x,hi.y-lo.y)<250:
        subject.extend(points);subject_names.append(obj.name)
assert len(subject_names)>500, 'Incomplete subject selection'
center=Vector(tuple((min(v[k] for v in subject)+max(v[k] for v in subject))/2 for k in range(3)))

# Fill beyond the earlier reference-frustum cut with a neutral landscape, never invented buildings.
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
rng=random.Random(20260911);trees=[]
for x in range(-1500,1900,27):
    for y in range(-1700,1600,27):
        px=x+rng.uniform(-10,10);py=y+rng.uniform(-10,10)
        if -100<px<670 and -490<py<295:continue
        hit,co,normal,index,obj,_=scene.ray_cast(deps,Vector((px,py,150)),Vector((0,0,-1)),distance=200)
        if hit:continue
        trees.append((px,py,rng.uniform(4,7),rng.uniform(10,17),rng.random()*math.tau))
ground=bpy.data.materials.get('Display outer ground');assert ground
bpy.ops.mesh.primitive_plane_add(size=16000,location=(200,-150,-3))
base=bpy.context.object;base.name='Display overscan ground — not surveyed';base.data.materials.append(ground)
collection=bpy.data.collections.new('Display overscan forest — not surveyed');scene.collection.children.link(collection)
crown=[o.data for o in source if o.name.startswith('landscape-') and not o.name.endswith('-stem')][:4]
trunk=next(o.data for o in source if o.name.startswith('landscape-') and o.name.endswith('-stem'))
for i,(x,y,r,h,angle) in enumerate(trees):
    leaf=bpy.data.objects.new(f'overscan-tree-{i}',crown[i%len(crown)]);collection.objects.link(leaf)
    leaf.location=(x,y,-3+h*.66);leaf.scale=(r,r*.87,h*.4);leaf.rotation_euler.z=angle
    stem=bpy.data.objects.new(f'overscan-stem-{i}',trunk);collection.objects.link(stem)
    stem.location=(x,y,-3+h*.24);stem.scale=(r*.1,r*.1,h*.48)

scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=16 if a.preview else 24
scene.render.resolution_x=1500 if a.preview else 3000
scene.render.resolution_y=1200 if a.preview else 2400
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
world=scene.world.node_tree.nodes['Background']
suns=[o for o in scene.objects if o.type=='LIGHT' and o.data.type=='SUN']
for sun in suns:sun.rotation_euler=(math.radians(32),math.radians(-23),math.radians(-32))
glass=[m.node_tree.nodes.get('Principled BSDF') for m in bpy.data.materials if m.use_nodes and ('玻璃' in m.name or 'glass' in m.name.lower())]
glass=[m for m in glass if m]
fit=json.loads(Path(a.fit).read_text())
names={'office-tower':'办公高楼','office-lake-north':'湖畔小楼','factory-south-long':'长栋厂房','factory-east-end':'标准厂房'}
anchors=[{'id':v['name'],'label':names[v['name']],'world':v['world'],'sourceObject':v['object']} for v in fit['landmarks'] if v['name'] in names]
landscape=json.loads(Path(a.landscape).read_text())
manifest={'version':1,'revision':'jinhu-camera-20260910-v2-filled','renderMode':'offline-real-3d-camera-cache',
 'dimensions':[scene.render.resolution_x,scene.render.resolution_y],'clayDimensions':[scene.render.resolution_x,scene.render.resolution_y],
 'defaultView':'opposite','defaultLighting':'day','views':[],'anchors':anchors,
 'sourceGeometry':'actual-local-MAX-extraction','landscape':'reference-inspired-not-surveyed',
 'productionEligible':False,'businessData':'demo-or-unassigned','continuousWebGL':False,
 'responsiveFraming':{'padding':.035,'mode':'measured-subject-fit-with-overscan'},
 'landscapeSummary':{k:landscape[k] for k in ['treeCount','parkTrees','provenance','sourceGeometryUnchanged']},
 'limitations':['Pre-rendered camera views, not free orbit.','Peripheral landscape is presentation-only, not surveyed.',
                'Official building IDs, scale and tenant mapping remain unverified.']}
manifest['landscapeSummary']['overscanTrees']=len(trees)
def bounds():
    uv=[world_to_camera_view(scene,cam,v) for v in subject]
    return [min(v.x for v in uv),min(v.y for v in uv),max(v.x for v in uv),max(v.y for v in uv)]
def fit_camera(v):
    cam.data.type=v['type'];cam.data.lens=28;cam.data.shift_x=cam.data.shift_y=0
    cam.rotation_euler=v['rotation']
    # A horizontal plan composition uses the wide screen more effectively than a vertical plan.
    if v['id']=='top':cam.rotation_euler.z+=math.pi/2
    direction=cam.rotation_euler.to_matrix()@Vector((0,0,1))
    low,high=100,4000
    for _ in range(22):
        size=(low+high)/2
        cam.location=center+direction*(size if cam.data.type=='PERSP' else 1600)
        cam.data.ortho_scale=size;bpy.context.view_layer.update()
        b=bounds()
        if b[2]-b[0]>.56 or b[3]-b[1]>.46:low=size
        else:high=size
    # Camera sensor shifts recenter the projected silhouette without rotating the model.
    for _ in range(2):
        b=bounds();cx=(b[0]+b[2])/2;cy=(b[1]+b[3])/2
        cam.data.shift_x+=cx-.5
        cam.data.shift_y+=(cy-.5)*scene.render.resolution_y/scene.render.resolution_x
        bpy.context.view_layer.update()
    b=bounds();assert abs((b[0]+b[2])/2-.5)<.001 and abs((b[1]+b[3])/2-.5)<.001,b
    return [b[0],1-b[3],b[2],1-b[1]]

# Thousands of trees share a handful of meshes. Change each unique mesh once, not per instance.
meshes={o.data.as_pointer():o.data for o in scene.objects if o.type=='MESH'}
original_slots=[(mesh,list(mesh.materials)) for mesh in meshes.values()]
clay=bpy.data.materials.new('Filled view audit clay');clay.use_nodes=True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.67,.71,.75,1)
for v in json.loads(Path(a.cameras).read_text())['views']:
    region=fit_camera(v)
    item={**v,'camera':list(cam.location),'rotation':list(cam.rotation_euler),'lens':cam.data.lens,
          'orthoScale':cam.data.ortho_scale,'shift':[cam.data.shift_x,cam.data.shift_y],
          'subjectBounds':region,'labels':{},'images':{}}
    for anchor in anchors:
        uv=world_to_camera_view(scene,cam,Vector(anchor['world']))
        item['labels'][anchor['id']]={'x':uv.x*100,'y':(1-uv.y)*100,'visible':uv.z>0 and 0<=uv.x<=1 and 0<=uv.y<=1}
    for mode in (['day'] if a.preview else ['day','night','clay']):
        night=mode=='night'
        world.inputs['Color'].default_value=(.19,.30,.50,1) if night else (.65,.75,.9,1)
        world.inputs['Strength'].default_value=.20 if night else .48
        for sun in suns:sun.data.energy=.38 if night else 2.2;sun.data.color=(.48,.65,1) if night else (1,.93,.83)
        for bsdf in glass:
            bsdf.inputs['Emission Color'].default_value=(1,.52,.18,1) if night else (0,0,0,1)
            bsdf.inputs['Emission Strength'].default_value=.65 if night else 0
        scene.view_settings.exposure=.25 if night else 0
        if mode=='clay':
            for mesh,slots in original_slots:
                for i in range(len(slots)):mesh.materials[i]=clay
        filename=f'{v["id"]}-{mode}'
        scene.render.filepath=str(out/(filename+'.png'));bpy.ops.render.render(write_still=True)
        if mode=='clay':
            item['clayImage']=filename+'.webp'
            for mesh,slots in original_slots:
                for i,mat in enumerate(slots):mesh.materials[i]=mat
        else:item['images'][mode]=filename+'.webp'
    manifest['views'].append(item)
    print('FILLED_VIEW',v['id'],region,flush=True)
assert fingerprint()==before
manifest['geometryUnchanged']=True
(out/'display-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(out/'framing-review.json').write_text(json.dumps({'subjectObjects':len(subject_names),'subjectNames':subject_names,
 'sourceGeometryFingerprint':before,'sourceGeometryUnchanged':True,'overscanTrees':len(trees),
 'displayOnlyGroundAndForest':True,'productionEligible':False},ensure_ascii=False,indent=2))
