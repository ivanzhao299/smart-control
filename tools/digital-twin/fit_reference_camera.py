"""Fit a real perspective camera to manually paired roof landmarks."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

p = argparse.ArgumentParser()
p.add_argument('--input', required=True); p.add_argument('--output', required=True)
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=a.input)
scene=bpy.context.scene
cam=bpy.data.objects.new('LandmarkCamera', bpy.data.cameras.new('LandmarkCamera'))
scene.collection.objects.link(cam); scene.camera=cam
scene.render.resolution_x=1280; scene.render.resolution_y=884
cam.data.type='ORTHO'; cam.data.ortho_scale=1200
cam.location=Vector((277,-101,0))+1400*Vector((-.5,-.5,math.sqrt(.5)))
cam.rotation_euler=(Vector((277,-101,0))-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.context.view_layer.update()
# Approximate roof centers in reference-camera-v1/matched.png and supplied aerial.
# Coordinates are review annotations, not cadastral/geospatial control points.
pairs=[
 ('office-tower',[431,222],[423,148]),
 ('office-north',[509,190],[510,144]),
 ('factory-left-edge',[194,405],[149,303]),
 ('factory-near-1',[526,587],[470,475]),
 ('factory-near-2',[580,630],[530,531]),
 ('factory-near-3',[637,667],[595,591]),
 ('factory-near-4',[690,707],[661,636]),
 ('factory-south-long',[803,643],[810,537]),
 ('factory-east-end',[1033,483],[1068,380]),
 ('office-lake-north',[778,402],[777,298]),
]
deps=bpy.context.evaluated_depsgraph_get(); landmarks=[]
for name,(u,v),target in pairs:
    local=Vector(((u/1280-.5)*1200,(.5-v/884)*1200*884/1280,0))
    origin=cam.matrix_world @ local
    direction=cam.matrix_world.to_quaternion() @ Vector((0,0,-1))
    hit, point, normal, index, obj, matrix=scene.ray_cast(deps,origin,direction)
    if not hit: raise RuntimeError('No source surface for '+name)
    landmarks.append({'name':name,'world':list(point),'target':target,'sourcePixel':[u,v],'object':obj.name})
pts=np.array([l['world'] for l in landmarks]); target=np.array([l['target'] for l in landmarks])
def project(x):
    cx,cy,az,el,dist,focal=x
    az,el=np.deg2rad([az,el])
    eye=np.array([cx,cy,0])+dist*np.array([np.cos(el)*np.cos(az),np.cos(el)*np.sin(az),np.sin(el)])
    forward=(np.array([cx,cy,0])-eye)/dist
    right=np.cross(forward,[0,0,1]); right/=np.linalg.norm(right)
    up=np.cross(right,forward)
    d=pts-eye
    return np.column_stack([640+focal*(d@right)/(d@forward),442-focal*(d@up)/(d@forward)])
def solve(x):
    damping=.01
    for _ in range(250):
        r=(project(x)-target).flatten()
        jac=np.column_stack([((project(x+np.eye(6)[i]*.001)-project(x))/.001).flatten() for i in range(6)])
        delta=np.linalg.solve(jac.T@jac+damping*np.eye(6),-jac.T@r)
        trial=x+delta
        valid=20<trial[3]<80 and 500<trial[4]<20000 and 200<trial[5]<15000
        if valid and np.linalg.norm(project(trial)-target)<np.linalg.norm(r):
            x=trial; damping=max(1e-8,damping*.5)
            if np.linalg.norm(delta)<1e-6:break
        else:damping*=4
    return x,float(np.linalg.norm(project(x)-target))
fits=[solve(np.array([277.,-101.,-135.,42.,dist,focal])) for dist,focal in [(1400,1500),(2500,2500),(5000,5000)]]
x,error=min(fits,key=lambda f:f[1]); predicted=project(x)
for l,pred in zip(landmarks,predicted):
    l['predicted']=pred.tolist(); l['errorPixels']=float(np.linalg.norm(pred-l['target']))
result={'parameters':dict(zip(['centerX','centerY','azimuth','elevation','distance','focalPixels'],x.tolist())),
 'lensMm':float(x[5]*36/1280),'landmarks':landmarks,'rmsPixels':float(error/np.sqrt(len(landmarks))),
 'status':'approximate-manual-landmark-fit-not-approved','productionEligible':False}
Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False),flush=True)
