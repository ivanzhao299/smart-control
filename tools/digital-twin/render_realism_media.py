"""Same-reference render and true camera-motion frames from the local enriched scene."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector,Quaternion
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0,str(Path(__file__).resolve().parent))
from scene_realism import light
p=argparse.ArgumentParser()
for key in ('input','fit','manifest','output'):p.add_argument('--'+key,required=True)
p.add_argument('--motion',action='store_true');p.add_argument('--frames',type=int,default=96)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input);scene=bpy.context.scene;cam=scene.camera
scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';light(scene,False)
fit=json.loads(Path(a.fit).read_text());manifest=json.loads(Path(a.manifest).read_text())
if not a.motion:
    params=fit['parameters'];target=Vector((params['centerX'],params['centerY'],0))
    az=math.radians(params['azimuth']);el=math.radians(params['elevation'])
    cam.data.type='PERSP';cam.data.lens=fit['lensMm'];cam.data.shift_x=cam.data.shift_y=0
    cam.location=target+params['distance']*Vector((math.cos(el)*math.cos(az),math.cos(el)*math.sin(az),math.sin(el)))
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.resolution_x=1280;scene.render.resolution_y=884;scene.eevee.taa_render_samples=64
    scene.render.filepath=str(out/'reference-match.png');bpy.ops.render.render(write_still=True)
    (out/'reference-review.json').write_text(json.dumps({'camera':list(cam.location),'rotation':list(cam.rotation_euler),
       'lens':cam.data.lens,'dimensions':[1280,884],'referenceFitUnchanged':True,'exactVisualReplica':False,
       'appearance':'reference-inspired-material-and-foliage','sourceBuildingTransformsUnchanged':True,'productionEligible':False},indent=2))
else:
    scene.render.resolution_x=1600;scene.render.resolution_y=1280;scene.eevee.taa_render_samples=16
    v=next(v for v in manifest['views'] if v['id']=='opposite')
    cam.data.type='PERSP';cam.data.lens=v['lens'];cam.data.shift_x,cam.data.shift_y=v['shift']
    cam.rotation_euler=v['rotation'];q=cam.rotation_euler.to_quaternion();base=Vector(v['camera'])
    target=base-(q@Vector((0,0,1)))*v['orthoScale']
    frames=[]
    for frame in range(a.frames):
        t=frame/(a.frames-1);angle=math.radians(3.2)*math.sin(math.tau*t)
        rotation=Quaternion((0,0,1),angle)
        cam.location=target+(rotation@(base-target))*(1-.016*math.sin(math.pi*t)**2)
        cam.rotation_euler=(rotation@q).to_euler();bpy.context.view_layer.update()
        anchors={}
        for anchor in manifest['anchors']:
            point=world_to_camera_view(scene,cam,Vector(anchor['world']))
            anchors[anchor['id']]={'x':point.x*100,'y':(1-point.y)*100}
        frames.append({'frame':frame,'time':frame/16,'camera':list(cam.location),'rotation':list(cam.rotation_euler),'anchors':anchors})
        scene.render.filepath=str(out/f'frame-{frame:04d}.png');bpy.ops.render.render(write_still=True)
    (out/'motion.json').write_text(json.dumps({'version':1,'revision':manifest['revision'],'view':'opposite','lighting':'day',
       'fps':16,'durationSeconds':a.frames/16,'dimensions':[1600,1280],'frames':frames,'source':'offline-true-camera-render',
       'modelTransformsUnchanged':True,'autoPlay':False,'loop':False,'productionEligible':False},ensure_ascii=False,indent=2))
