"""Recover supported closed MAX Bezier profiles from source knots, not guessed footprints."""
import math
import struct


def decode_knots(data, count):
    if not 2 <= count <= 100000 or len(data) != count * 52:
        raise ValueError('Unsupported MAX spline knot encoding')
    knots = []
    for i in range(count):
        row = struct.unpack_from('<II10fI', data, i * 52)
        if not all(math.isfinite(v) for v in row[2:12]): raise ValueError('Non-finite spline coordinate')
        knots.append({'type': row[0], 'point': row[3:6], 'incoming': row[6:9], 'outgoing': row[9:12]})
    return knots


def profiles(chunk):
    count = chunk.get_first(0x2900)
    data = chunk.get_first(0x290A)
    closed = chunk.get_first(0x290D)
    if count and data and closed:
        n = struct.unpack_from('<I', count.data)[0]
        yield decode_knots(data.data, n), bool(struct.unpack_from('<I', closed.data)[0])
        return
    for ch in getattr(chunk, 'children', []): yield from profiles(ch)


def legacy_float(block, index):
    for ch in getattr(block, 'children', []):
        if ch.types != 2: continue
        key, val = ch.get_first(3), ch.get_first(0x100)
        if key and val and len(key.data) == 4 and len(val.data) == 4 and struct.unpack('<I', key.data)[0] == index:
            return struct.unpack('<f', val.data)[0]
    return None


def legacy_int(block, index):
    for ch in getattr(block, 'children', []):
        if ch.types != 2: continue
        key, val = ch.get_first(3), ch.get_first(0x101)
        if key and val and len(key.data) == 4 and len(val.data) == 4 and struct.unpack('<I', key.data)[0] == index:
            return struct.unpack('<i', val.data)[0]
    return None


def install(importer, report):
    import bpy
    from mathutils import Vector
    original = importer.create_shell
    report['recoveredProfiles'] = []
    report['profileWarnings'] = []

    def shell(context, settings, node, derived, mat, mtx):
        base = derived; modifiers = []; seen = set()
        while importer.get_guid(base) in (0x2032, 0x2033):
            if id(base) in seen: raise ValueError('Cyclic modifier chain')
            seen.add(id(base)); refs = importer.get_references(base)
            if not refs: return original(context, settings, node, derived, mat, mtx)
            modifiers.extend(refs[:-1]); base = refs[-1]
        if importer.get_guid(base) not in (0xA, 0x1040):
            return original(context, settings, node, derived, mat, mtx)
        source_profiles = list(profiles(base))
        closed = [points for points, is_closed in source_profiles if is_closed]
        name = importer.get_node_name(node)
        if not closed:
            report['profileWarnings'].append({'name': name, 'reason': 'open-profile-no-verified-render-width'})
            return original(context, settings, node, derived, mat, mtx)
        # Only recover known profile-to-mesh operations. Unknown modifiers remain an acceptance warning.
        height = 0.0; cap_start = True; cap_end = True
        for modifier in modifiers:
            if importer.get_guid(modifier) == 0xA0:
                params = importer.get_references(modifier)
                if not params: raise ValueError('Extrude missing parameter block')
                amount = legacy_float(params[0], 0)
                if amount is None or not math.isfinite(amount) or abs(amount) > 10000:
                    raise ValueError('Extrude amount not decoded')
                height += amount
                start, end = legacy_int(params[0], 2), legacy_int(params[0], 3)
                if start not in (0,1) or end not in (0,1): raise ValueError('Extrude cap flags not decoded')
                cap_start = bool(start); cap_end = bool(end)
        points = [k['point'] for profile in closed for k in profile]
        zmin, zmax = min(p[2] for p in points), max(p[2] for p in points)
        if zmax-zmin > .01:
            report['profileWarnings'].append({'name': name, 'reason': 'non-planar-profile'})
            return original(context, settings, node, derived, mat, mtx)
        curve = bpy.data.curves.new(name + '-source-profile', 'CURVE')
        curve.dimensions = '2D'; curve.fill_mode = 'BOTH'; curve.resolution_u = 6
        curve.extrude = abs(height) / 2
        for knots in closed:
            spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(knots)-1)
            spline.use_cyclic_u = True; spline.resolution_u = 6
            for bp, knot in zip(spline.bezier_points, knots):
                bp.co = (*knot['point'][:2], 0); bp.handle_left_type = 'FREE'; bp.handle_right_type = 'FREE'
                bp.handle_left = (*knot['incoming'][:2], 0); bp.handle_right = (*knot['outgoing'][:2], 0)
        obj = bpy.data.objects.new(name, curve)
        context.view_layer.active_layer_collection.collection.objects.link(obj)
        context.view_layer.update()
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(obj, do_unlink=True)
        obj = bpy.data.objects.new(name, mesh)
        context.view_layer.active_layer_collection.collection.objects.link(obj)
        bpy.data.curves.remove(curve)
        for v in mesh.vertices: v.co.z += zmin + height / 2
        if height and (not cap_start or not cap_end):
            import bmesh
            bm=bmesh.new();bm.from_mesh(mesh)
            start_z,end_z=zmin,zmin+height
            delete=[f for f in bm.faces if
                    (not cap_start and all(abs(v.co.z-start_z)<.0001 for v in f.verts)) or
                    (not cap_end and all(abs(v.co.z-end_z)<.0001 for v in f.verts))]
            bmesh.ops.delete(bm,geom=delete,context='FACES');bm.to_mesh(mesh);bm.free();mesh.update()
        if 'MATERIAL' in settings[1]: importer.adjust_material(settings[0], settings[2], obj, mat)
        obj['recoveredSourceProfile'] = True
        obj['sourceExtrusionHeight'] = height
        report['recoveredProfiles'].append({'name': name, 'profiles': len(closed), 'height': height,
                                             'vertices': len(mesh.vertices), 'capStart':cap_start,'capEnd':cap_end,
                                             'modifierClasses': [importer.get_cls_name(m) for m in modifiers]})
        return [obj]
    importer.create_shell = shell
