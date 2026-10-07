"""Conservative low-detail preparation that retains source materials and per-corner UVs."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
import numpy as np

p=argparse.ArgumentParser()
p.add_argument('--input',required=True);p.add_argument('--output',required=True)
p.add_argument('--cluster-size',type=float,default=.65)
p.add_argument('--target-triangles',type=int,default=275000)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
if not .05<=a.cluster_size<=1 or not 10000<=a.target_triangles<=300000:raise ValueError('Invalid optimization bounds')
out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=a.input)
objects=sorted((o for o in bpy.context.scene.objects if o.type=='MESH'),key=lambda o:o.get('twinId',o.name))
counts=[sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects]
protected=[n<=1000 or o.get('recoveredSourceProfile',False) for o,n in zip(objects,counts)]
# Dissolve coplanar subdivisions first. This retains exterior boundaries and UV seams,
# unlike collapsing a low-poly building down to an arbitrary triangle count.
for obj,n,keep in zip(objects,counts,protected):
    if keep and n>200:
        if obj.data.users>1:obj.data=obj.data.copy()
        mod=obj.modifiers.new('Remove coplanar subdivisions','DECIMATE');mod.decimate_type='DISSOLVE'
        mod.angle_limit=.02;mod.delimit={'MATERIAL','UV'};mod.use_dissolve_boundaries=False
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
protected_counts=[sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects]
base=sum(n if keep else 24 for n,keep in zip(protected_counts,protected))
print('PROTECTED_BASE',base,flush=True)
ratio=max(.0001,(a.target_triangles-base)/max(sum(n for n,keep in zip(counts,protected) if not keep),1))
entities=[];stats=[]
for obj,before,keep in zip(objects,counts,protected):
    if not before:continue
    if obj.data.users>1:obj.data=obj.data.copy()
    if not keep:
        old=obj.data;old.calc_loop_triangles()
        coords=np.empty(len(old.vertices)*3,dtype=np.float32);old.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)
        if not np.isfinite(coords).all():raise ValueError('Non-finite source geometry')
        tri=np.empty(len(old.loop_triangles)*3,dtype=np.int32);old.loop_triangles.foreach_get('vertices',tri)
        matidx=np.empty(len(old.loop_triangles),dtype=np.int32);old.loop_triangles.foreach_get('material_index',matidx)
        loops=np.empty(len(old.loop_triangles)*3,dtype=np.int32);old.loop_triangles.foreach_get('loops',loops)
        uv=None
        if old.uv_layers.active:
            uv=np.empty(len(old.loops)*2,dtype=np.float32);old.uv_layers.active.data.foreach_get('uv',uv)
            uv=uv.reshape(-1,2)[loops].reshape(-1,3,2)
        world_matrix=np.array(obj.matrix_world,dtype=np.float64)
        world=coords.astype(np.float64)@world_matrix[:3,:3].T+world_matrix[:3,3]
        grid=np.rint(world/a.cluster_size).astype(np.int64)
        _,inverse=np.unique(grid,axis=0,return_inverse=True)
        sums=np.zeros((inverse.max()+1,3),dtype=np.float64);np.add.at(sums,inverse,coords)
        averaged=sums/np.bincount(inverse)[:,None]
        faces=inverse[tri].reshape(-1,3)
        valid=(faces[:,0]!=faces[:,1])&(faces[:,1]!=faces[:,2])&(faces[:,0]!=faces[:,2])
        source_ids=np.flatnonzero(valid);faces=faces[valid]
        if len(faces):
            # Never merge coincident triangles carrying distinct material IDs.
            keys=np.column_stack((np.sort(faces,axis=1),matidx[source_ids]))
            _,unique=np.unique(keys,axis=0,return_index=True);unique=np.sort(unique)
            source_ids=source_ids[unique];faces=faces[unique]
            rebuilt=bpy.data.meshes.new(old.name+'-web')
            rebuilt.from_pydata(averaged.tolist(),[],faces.tolist());rebuilt.update()
            for material in old.materials:rebuilt.materials.append(material)
            rebuilt.polygons.foreach_set('material_index',matidx[source_ids])
            if uv is not None:
                layer=rebuilt.uv_layers.new(name='UVMap')
                layer.data.foreach_set('uv',uv[source_ids].reshape(-1))
            obj.data=rebuilt
        mod=obj.modifiers.new('Web fine-detail reduction','DECIMATE')
        remaining=sum(len(p.vertices)-2 for p in obj.data.polygons)
        mod.ratio=min(1,max(24,before*ratio)/max(remaining,1));mod.use_collapse_triangulate=True
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    mesh=obj.data;mesh.calc_loop_triangles();after=len(mesh.loop_triangles)
    if not after:raise ValueError('Lost component: '+obj.name)
    index=len(entities);tid=obj.get('twinId','unmapped-'+obj.name)
    attr=mesh.attributes.get('_ENTITY_ID') or mesh.attributes.new('_ENTITY_ID','FLOAT','POINT')
    attr.data.foreach_set('value',np.full(len(mesh.vertices),index,dtype=np.float32))
    entities.append({'id':tid,'nodeName':obj.name,'label':obj.get('sourceName',obj.name),'phase':None,
                     'buildingNumber':None,'tenantNames':[],'deviceIds':[],'mappingStatus':'unassigned-source-component'})
    stats.append({'id':tid,'before':before,'after':after,'protectedSilhouette':bool(keep),'recoveredProfile':bool(obj.get('recoveredSourceProfile',False))})
    if index%100==0:print('TEXTURED_LOD',index,len(objects),flush=True)
triangles=sum(s['after'] for s in stats)
(out/'simplification.json').write_text(json.dumps({'input':a.input,'originalTriangles':sum(counts),'triangles':triangles,
                                                'sourceObjects':len(entities),'clusterSizeSourceUnits':a.cluster_size,'objects':stats},indent=2))
if triangles>300000:raise ValueError(f'Web triangle budget exceeded: {triangles}')
for image in bpy.data.images:
    if image.source in ('FILE','GENERATED') and not image.has_data:raise ValueError('Missing image: '+image.name)
    if max(image.size,default=0)>2048:raise ValueError('Texture exceeds intake resolution budget')
# Remove non-rendering helper curves/empties from export selection, preserving parent transforms.
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'scene-source.glb'),export_format='GLB',use_selection=True,
    export_extras=False,export_attributes=True,export_yup=True,export_apply=True,export_animations=False,
    export_cameras=False,export_lights=False,export_image_format='AUTO')
manifest={'schemaVersion':1,'sourceId':'jinhu-max-textured-local','fixture':False,'asset':'scene.glb',
          'units':'unverified-source-units','upAxis':'Y','materialMode':'source-materials-recovered',
          'geometryType':'real-max-recovered-profiles','entities':entities,
          'acceptance':{'front':False,'opposite':False,'scale':False,'materials':False},
          'telemetry':{'mode':'disconnected','readOnly':True},
          'limitations':['Source UV modifiers on recovered profiles require review','Some open or nonplanar profiles remain unsupported',
                         'Source component IDs are revision-local, not verified building IDs','Scale and completeness unverified']}
(out/'twin-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('TEXTURED_EXPORT',json.dumps({'triangles':triangles,'entities':len(entities),'materials':len(bpy.data.materials)}),flush=True)
