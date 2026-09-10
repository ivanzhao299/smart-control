"""Source-backed material wrappers missing from the pinned upstream importer."""
VRAY_OVERRIDE = 0x54E217EB15D20E6B


def install(importer, report):
    original = importer.adjust_material
    report['materialWrappersResolved'] = 0
    report['unsupportedMaterials'] = []
    stack = set()
    cache = {}
    def adjust(filename, search, obj, mat):
        if mat is None: return None
        if importer.get_guid(mat) == 0x82: return None  # Multi/Sub parameter block, not a material slot.
        if id(mat) in stack: raise ValueError('Cyclic MAX material reference')
        if importer.get_guid(mat) == VRAY_OVERRIDE:
            # ParamBlock, base material, GI, reflection, refraction, shadow.
            # Only the base is camera-visible. Do not substitute a GI override.
            refs = importer.get_references(mat)
            if len(refs) < 2 or refs[1] is None:
                report['unsupportedMaterials'].append('VRayOverrideMtl missing base')
                return None
            stack.add(id(mat))
            try:
                report['materialWrappersResolved'] += 1
                return adjust(filename, search, obj, refs[1])
            finally: stack.remove(id(mat))
        if obj and id(mat) in cache:
            slots, result = cache[id(mat)]
            for slot in slots: obj.data.materials.append(slot)
            return result
        before = len(obj.data.materials) if obj else 0
        result = original(filename, search, obj, mat)
        if obj and len(obj.data.materials) > before:
            cache[id(mat)] = (list(obj.data.materials)[before:], result)
        if obj and len(obj.data.materials) == before:
            report['unsupportedMaterials'].append(importer.get_cls_name(mat))
        return result
    importer.adjust_material = adjust
