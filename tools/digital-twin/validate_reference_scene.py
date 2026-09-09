"""Read-only checks of the derived, camera-cropped reference scene."""
import argparse
import json
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
p=argparse.ArgumentParser()
p.add_argument('--scene',required=True);p.add_argument('--fit',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=a.scene)
scene=bpy.context.scene;cam=scene.camera
assert scene.render.resolution_x==1280 and scene.render.resolution_y==884
fit=json.loads(Path(a.fit).read_text());errors=[]
for point in fit['landmarks']:
    uv=world_to_camera_view(scene,cam,Vector(point['world']))
    rendered=np.array([uv.x*1280,(1-uv.y)*884])
    assert np.linalg.norm(rendered-np.array(point['predicted']))<.02
    errors.append(float(np.linalg.norm(rendered-point['target'])))
rotation=cam.matrix_world.to_quaternion()
right,up,forward=[rotation@Vector(v) for v in [(1,0,0),(0,1,0),(0,0,-1)]]
tx=18/cam.data.lens;ty=tx*884/1280
normals=np.array([right+tx*forward,-right+tx*forward,up+ty*forward,-up+ty*forward])
normals/=np.linalg.norm(normals,axis=1)[:,None]
outside=0;vertices=0;worst=0
for obj in scene.objects:
    if obj.type!='MESH':continue
    xyz=np.empty(len(obj.data.vertices)*3,dtype=np.float32)
    obj.data.vertices.foreach_get('co',xyz)
    xyz=xyz.reshape(-1,3)
    matrix=np.array(obj.matrix_world)
    # Avoid platform BLAS floating-point status artifacts for small N×3 products.
    assert np.isfinite(xyz).all() and np.isfinite(matrix).all(), obj.name
    world=np.einsum('ij,kj->ik',xyz,matrix[:3,:3],optimize=False)+matrix[:3,3]
    distance=np.einsum('ij,kj->ik',world-np.array(cam.location),normals,optimize=False)
    assert np.isfinite(world).all() and np.isfinite(distance).all(), obj.name
    vertices+=len(xyz)
    if len(xyz):
        worst=min(worst,float(distance.min()))
        outside+=int(np.any(distance<-.005,axis=1).sum())
assert outside==0, f'{outside} vertices remain outside camera frustum; minimum {worst}'
result={'status':'PASS','resolution':[1280,884], 'checkedVertices':vertices,
        'outsideFrustumVertices':outside,'frustumToleranceSourceUnits':.005,
        'landmarkProjectionMatchesBlender':True,
        'manualLandmarkRmsPixels':float(np.sqrt(np.mean(np.array(errors)**2))),
        'productionEligible':False,'modelCompleteness':'NOT_PASSED'}
Path(a.output).write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
