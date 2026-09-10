"""Add lightweight, deterministic vegetation on recovered grass surfaces only.

Trees are presentation reconstructions, not surveyed source trees. Source buildings stay fixed.
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

p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
scene=bpy.context.scene
source=[o for o in scene.objects if o.type=='MESH']
def geometry_hash():
    h=hashlib.sha256()
    for o in source:
        h.update(o.name.encode());h.update(str([list(r) for r in o.matrix_world]).encode())
        h.update(str((len(o.data.vertices),len(o.data.polygons))).encode())
    return h.hexdigest()
before=geometry_hash()
def material(name,color,roughness=1,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metal
    m.diffuse_color=(*color,1);return m
# Presentation materials intentionally replace only troublesome ground/context shaders.
grass=material('Display lawn',(.115,.23,.13))
ground=material('Display outer ground',(.125,.185,.16))
road=material('Display asphalt',(.115,.145,.165),.95)
context=material('Display context buildings',(.28,.34,.38),.9)
water=material('Display water',(.04,.24,.33),.24,.15)
for obj in source:
    for i,m in enumerate(list(obj.data.materials)):
        if not m:continue
        if obj.name=='Circle001':obj.data.materials[i]=ground
        elif 'DX-草地' in m.name:obj.data.materials[i]=grass
        elif '柏油马路' in m.name:obj.data.materials[i]=road
        elif m.name.startswith('DX-水'):obj.data.materials[i]=water
    # Context massing meshes are source objects 614..619, not the detailed park buildings.
    if obj.name in {'对象614','对象615','对象616','对象617','对象618','对象619'}:
        for i in range(len(obj.data.materials)):obj.data.materials[i]=context

bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
def hit(x,y):
    ok,co,normal,index,obj,_=scene.ray_cast(deps,Vector((x,y,100)),Vector((0,0,-1)),distance=150)
    if not ok:return None
    slot=obj.data.polygons[index].material_index
    mat=obj.data.materials[slot] if slot<len(obj.data.materials) else None
    return co,obj.name,mat.name if mat else ''
def grass_hit(x,y,outer=False):
    result=hit(x,y)
    if not result:return None
    co,name,mat=result
    allowed=(mat=='Display lawn' and co.z<2) or (outer and name=='Circle001')
    return co if allowed else None
rng=random.Random(20260910);placements=[]
# Test positions before adding instances, so the raycast cannot hit a tree we just placed.
for outer,spacing,bounds in [(False,8.5,(-65,625,-455,250)),(True,14,(-450,1020,-850,770))]:
    xmin,xmax,ymin,ymax=bounds
    x=xmin
    while x<xmax:
        y=ymin
        while y<ymax:
            px=x+rng.uniform(-2,2);py=y+rng.uniform(-2,2)
            y+=spacing
            if outer and -90<px<650 and -480<py<280:continue
            co=grass_hit(px,py,outer)
            if co is None:continue
            radius=rng.uniform(2.0,3.2) if not outer else rng.uniform(3.0,4.4)
            if not all(grass_hit(px+dx,py+dy,outer) is not None for dx,dy in [(radius,0),(-radius,0),(0,radius),(0,-radius)]):continue
            placements.append({'id':f'landscape-{len(placements)+1:04d}','position':list(co),
                'radius':radius,'height':rng.uniform(6,10) if not outer else rng.uniform(9,14),
                'outer':outer,'palette':rng.randrange(4),'rotation':rng.uniform(0,math.tau)})
        x+=spacing

trunk_mat=material('Tree bark',(.17,.11,.065))
leaves=[material('Tree leaves '+str(i),c) for i,c in enumerate([(.08,.21,.10),(.12,.28,.13),(.18,.32,.12),(.26,.33,.12)])]
def mesh_part(op,**kw):
    op(**kw);o=bpy.context.object;mesh=o.data;bpy.data.objects.remove(o,do_unlink=True);return mesh
crown=mesh_part(bpy.ops.mesh.primitive_ico_sphere_add,subdivisions=2,radius=1)
for f in crown.polygons:f.use_smooth=True
crown.materials.append(leaves[0])
crown_meshes=[]
for m in leaves:
    copy=crown.copy();copy.materials.clear();copy.materials.append(m);crown_meshes.append(copy)
trunk=mesh_part(bpy.ops.mesh.primitive_cylinder_add,vertices=6,radius=1,depth=1)
trunk.materials.append(trunk_mat)
collection=bpy.data.collections.new('Reconstructed landscape — not surveyed');scene.collection.children.link(collection)
for t in placements:
    x,y,z=t['position'];r=t['radius'];h=t['height']
    stem=bpy.data.objects.new(t['id']+'-stem',trunk);collection.objects.link(stem)
    stem.location=(x,y,z+h*.24);stem.scale=(r*.1,r*.1,h*.48)
    leaf=bpy.data.objects.new(t['id'],crown_meshes[t['palette']]);collection.objects.link(leaf)
    leaf.location=(x,y,z+h*.66);leaf.scale=(r,r*.87,h*.40);leaf.rotation_euler.z=t['rotation']
    leaf['provenance']='reference-inspired-landscape-not-surveyed'
assert geometry_hash()==before
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'landscape.blend'),compress=True)
report={'source':a.input,'sourceGeometryUnchanged':True,'sourceGeometryFingerprint':before,
 'trees':placements,'treeCount':len(placements),'parkTrees':sum(not t['outer'] for t in placements),
 'placementChecks':'Center and four crown-radius samples must hit ground-level grass; context planting stays outside park bounds.',
 'provenance':'deterministic-reference-inspired-reconstruction-not-surveyed',
 'sharedCrownMeshes':4,'sharedTrunkMeshes':1,'productionEligible':False}
(out/'landscape.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('LANDSCAPE',len(placements),flush=True)
