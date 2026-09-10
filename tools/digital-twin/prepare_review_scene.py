"""Apply audited source cap flags and separate the display substrate in a new copy."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

p=argparse.ArgumentParser()
p.add_argument('--input',required=True);p.add_argument('--source-diagnostics',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
caps=json.loads(Path(a.source_diagnostics).read_text())['capSettings']
changes=[];building_matrices={}
for o in bpy.context.scene.objects:
    if o.type=='MESH':building_matrices[o.name]=[list(r) for r in o.matrix_world]
for entry in caps:
    obj=bpy.data.objects.get(entry['name'])
    if not obj or not obj.get('recoveredSourceProfile') or not entry['amount']:continue
    if entry['capStart']==1 and entry['capEnd']==1:continue
    if entry['capStart'] not in (0,1) or entry['capEnd'] not in (0,1):raise ValueError('Unverified cap flag')
    mesh=obj.data;zmin=min(v.co.z for v in mesh.vertices);zmax=max(v.co.z for v in mesh.vertices)
    start,end=(zmin,zmax) if entry['amount']>0 else (zmax,zmin)
    bm=bmesh.new();bm.from_mesh(mesh)
    faces=[f for f in bm.faces if
        (not entry['capStart'] and all(abs(v.co.z-start)<.0001 for v in f.verts)) or
        (not entry['capEnd'] and all(abs(v.co.z-end)<.0001 for v in f.verts))]
    count=len(faces);bmesh.ops.delete(bm,geom=faces,context='FACES');bm.to_mesh(mesh);bm.free();mesh.update()
    changes.append({'name':obj.name,'reason':'honor-source-extrude-cap-flags','removedFaces':count,**entry})
ground=bpy.data.objects.get('Circle001')
assert ground and ground.type=='MESH'
ground.location.z-=2
changes.append({'name':'Circle001','reason':'display-only-substrate-separation','offsetSourceUnits':-2,
                'surveyElevation':False,'note':'Background plane was coplanar with lawns and roads and above the water.'})
for obj in bpy.context.scene.objects:
    if obj.type=='MESH':
        for face in obj.data.polygons:face.use_smooth=False
bpy.context.view_layer.update()
unchanged=all([list(r) for r in bpy.data.objects[name].matrix_world]==matrix for name,matrix in building_matrices.items() if name!='Circle001')
assert unchanged
bpy.ops.wm.save_as_mainfile(filepath=str(out/'review.blend'),compress=True)
report={'source':a.input,'changes':changes,'nonSubstrateTransformsUnchanged':unchanged,
        'sourceCapDocumentation':'https://help.autodesk.com/cloudhelp/2026/ENU/MAXDEV-CPP-API-REF/group__param_block_i_ds.html',
        'productionEligible':False,'reviewStatus':'needs-multiview-inspection'}
(out/'repairs.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
