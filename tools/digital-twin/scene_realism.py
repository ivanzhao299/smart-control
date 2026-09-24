"""Reference-inspired presentation shaders and real leaf geometry; no building edits."""
import math
import random
import bpy
from mathutils import Vector

def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Roughness'].default_value=.82
    return m

def textured_surface(m,colors,scale,bump=.025):
    tree=m.node_tree;n=tree.nodes;l=tree.links;b=n.get('Principled BSDF')
    coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=scale
    noise.inputs['Detail'].default_value=3;noise.inputs['Roughness'].default_value=.72
    l.new(coord.outputs['Object'],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position=.2;ramp.color_ramp.elements[0].color=(*colors[0],1)
    ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(*colors[1],1)
    l.new(noise.outputs['Fac'],ramp.inputs['Fac']);l.new(ramp.outputs['Color'],b.inputs['Base Color'])
    normal=n.new('ShaderNodeBump');normal.inputs['Strength'].default_value=.25;normal.inputs['Distance'].default_value=bump
    l.new(noise.outputs['Fac'],normal.inputs['Height']);l.new(normal.outputs['Normal'],b.inputs['Normal'])
    b.inputs['Roughness'].default_value=.86

def leaf_mesh(seed,palette):
    """Shared compound crown: branch clusters and folded leaves, not a painted billboard."""
    rng=random.Random(seed);vertices=[];faces=[];indices=[]
    centers=[Vector((rng.uniform(-.64,.64),rng.uniform(-.64,.64),rng.uniform(-.62,.64))) for _ in range(26)]
    centers=[c for c in centers if c.length<.85]
    for c in centers:
        # Solid irregular lobes provide crown volume; leaf facets provide surface detail.
        radius=rng.uniform(.23,.34);base=len(vertices);rings=6;segments=10
        for row in range(rings+1):
            theta=math.pi*row/rings
            for col in range(segments):
                phi=math.tau*col/segments;r=radius*rng.uniform(.89,1.12)
                vertices.append(c+Vector((math.sin(theta)*math.cos(phi)*r,math.sin(theta)*math.sin(phi)*r,math.cos(theta)*r)))
        for row in range(rings):
            for col in range(segments):
                i=base+row*segments+col;j=base+row*segments+(col+1)%segments
                faces.extend([(i,j,j+segments),(i,j+segments,i+segments)]);indices.extend([rng.randrange(len(palette))]*2)
        for _ in range(48):
            point=c+Vector((rng.gauss(0,.17),rng.gauss(0,.17),rng.gauss(0,.19)))
            if point.length>1:point.normalize()
            normal=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(.15,1))).normalized()
            u=normal.cross(Vector((0,0,1))).normalized();v=normal.cross(u)
            size=rng.uniform(.038,.080);base=len(vertices)
            vertices.extend([point-u*size,point+v*size*.55,point+u*size,point-v*size*.55,point+normal*size*.12])
            faces.extend([(base,base+1,base+4),(base+1,base+2,base+4),(base+2,base+3,base+4),(base+3,base,base+4)])
            indices.extend([rng.randrange(len(palette))]*4)
    mesh=bpy.data.meshes.new(f'Reference foliage {seed}');mesh.from_pydata(vertices,[],faces);mesh.update()
    for m in palette:mesh.materials.append(m)
    for p,i in zip(mesh.polygons,indices):p.material_index=i
    return mesh

def apply_realism(scene):
    replacements=[]
    for m in list(bpy.data.materials):
        if not m.use_nodes:continue
        b=m.node_tree.nodes.get('Principled BSDF')
        if not b:continue
        name=m.name
        if name in ('Display lawn','Display outer ground'):
            textured_surface(m,[(.028,.058,.014),(.12,.17,.044)],.45,.045)
        elif name=='Display asphalt':
            textured_surface(m,[(.033,.040,.048),(.065,.070,.082)],4,.008)
        elif name=='Display water':
            textured_surface(m,[(.018,.10,.15),(.065,.26,.34)],.2,.035)
            b.inputs['Roughness'].default_value=.19;b.inputs['Metallic'].default_value=.15
        elif name=='Display context buildings':
            b.inputs['Base Color'].default_value=(.15,.18,.22,1);b.inputs['Roughness'].default_value=.9
        elif name.startswith(('DX-铺地','DX-人行道','DK= 铺地')):
            # Source paving UV modifiers are only partially recovered; retain a fine neutral paving shader.
            textured_surface(m,[(.10,.11,.12),(.18,.18,.17)],2,.008);replacements.append(name.split('_')[0])
        elif name.startswith(('JZ-屋顶檐子','JZ-白色条','JZ-白色','建筑-楼板','JZ-顶板')):
            for link in list(b.inputs['Base Color'].links):m.node_tree.links.remove(link)
            b.inputs['Base Color'].default_value=(.73,.69,.68,1);b.inputs['Roughness'].default_value=.64
        elif '玻璃' in name:
            b.inputs['Base Color'].default_value=(.023,.048,.069,1)
            b.inputs['Roughness'].default_value=.16;b.inputs['Metallic'].default_value=.35
        elif name.startswith('JZ-窗框'):
            b.inputs['Roughness'].default_value=.4
    green=[material('Foliage leaf '+str(i),c) for i,c in enumerate([
        (.018,.050,.012),(.032,.075,.018),(.048,.095,.022),(.095,.14,.031),(.13,.17,.040)])]
    gold=[material('Seasonal leaf '+str(i),c) for i,c in enumerate([
        (.12,.065,.010),(.24,.12,.015),(.34,.20,.030),(.20,.16,.024),(.30,.22,.06)])]
    crowns=[leaf_mesh(110+i,green if i<4 else gold) for i in range(6)]
    count=0
    for o in scene.objects:
        if o.type!='MESH':continue
        if (o.name.startswith('landscape-') and not o.name.endswith('-stem')) or o.name.startswith('overscan-tree-'):
            # Seasonal avenue trees are a reference-inspired suggestion, not an as-built planting plan.
            golden=o.name.startswith('landscape-') and -30<o.location.x<600 and -445<o.location.y<230 and count%7==0
            o.data=crowns[4+count%2 if golden else count%4];count+=1
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.eevee.use_gtao=True;scene.eevee.gtao_distance=3;scene.eevee.gtao_quality=1
    scene.eevee.use_shadows=True;scene.eevee.shadow_ray_count=2;scene.eevee.shadow_step_count=8
    # All higher-quality work occurs in the offline renderer, not in the display browser.
    return {'mode':'reference-inspired-material-lighting-foliage','exactReplica':False,
            'pavingShadersRetuned':sorted(set(replacements)),'leafCrownInstances':count,
            'sourceBuildingGeometryUnchanged':True,'surveyedVegetation':False}

def light(scene,night=False):
    world=scene.world.node_tree.nodes['Background']
    world.inputs['Color'].default_value=(.16,.24,.43,1) if night else (.55,.68,1,1)
    world.inputs['Strength'].default_value=.16 if night else .24
    for o in scene.objects:
        if o.type=='LIGHT' and o.data.type=='SUN':
            o.data.energy=.45 if night else 3.4;o.data.angle=math.radians(4)
            o.data.color=(.45,.62,1) if night else (1,.91,.79)
            o.rotation_euler=(math.radians(33),math.radians(-28),math.radians(-38))
    scene.view_settings.exposure=.2 if night else .0
