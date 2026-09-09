"""3ds Max Batch worker adapter. Requires licensed Max + compatible V-Ray; not run on Mac.

No network, scene save, or rendering. Creates FBX and an audit report for later visual review.
"""
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
from pymxs import runtime as rt


def run():
    root, out = Path(os.environ['TWIN_INPUT']), Path(os.environ['TWIN_OUTPUT'])
    source_id = os.environ['TWIN_SOURCE_ID']
    texture_files = {p.name.casefold(): p for p in (root / 'textures').iterdir() if p.is_file()}
    report = {'state': 'IN_PROGRESS', 'workerValidated': True, 'visualAcceptance': False,
              'sourceId': source_id, 'nodes': [], 'materialConversions': [], 'missingTextures': [],
              'unsupportedObjects': []}
    for bitmap in rt.getClassInstances(rt.Bitmaptexture):
        name = PureWindowsPath(str(bitmap.filename)).name
        replacement = texture_files.get(name.casefold())
        if replacement:
            bitmap.filename = str(replacement)
        else:
            report['missingTextures'].append(name)
    nodes = list(rt.geometry)
    for node in nodes:
        cls = str(rt.classOf(node))
        if any(word in cls.lower() for word in ('missing', 'proxy', 'forest', 'railclone', 'unknown')):
            report['unsupportedObjects'].append({'name': str(node.name), 'class': cls})
        source_name = str(node.name)
        handle = int(rt.getHandleByAnim(node))
        twin_id = 'node-' + hashlib.sha256(f'{source_id}:{handle}'.encode()).hexdigest()[:16]
        rt.setUserProp(node, 'twinId', twin_id)
        rt.setUserProp(node, 'sourceName', source_name)
        node.name = twin_id
        report['nodes'].append({'id': twin_id, 'sourceName': source_name, 'sourceHandle': handle, 'class': cls})
    if not nodes or report['missingTextures'] or report['unsupportedObjects']:
        report['state'] = 'BLOCKED_MISSING_OR_PROCEDURAL_ASSETS'
        (out / 'export-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        raise RuntimeError('Resolve missing/procedural assets in Max; see export-report.json')
    # Convert only ordinary VRayMtl diffuse channels to exportable Standard materials.
    # All other V-Ray shader semantics are recorded as lossy and require visual review.
    converted = {}
    def material_to_fbx(material):
        if material is None:
            return None
        key = int(rt.getHandleByAnim(material))
        if key in converted:
            return converted[key]
        cls = str(rt.classOf(material))
        if cls.lower() == 'multimaterial':
            for index in range(1, int(rt.getNumSubMtls(material)) + 1):
                rt.setSubMtl(material, index, material_to_fbx(rt.getSubMtl(material, index)))
            converted[key] = material
            return material
        if cls.lower() == 'vraymtl':
            result = rt.Standardmaterial(name=str(material.name))
            result.diffuse = material.diffuse
            diffuse_map = material.texmap_diffuse
            if diffuse_map is not None:
                if str(rt.classOf(diffuse_map)).lower() != 'bitmaptexture':
                    raise RuntimeError('Procedural diffuse map requires baking: ' + str(material.name))
                result.diffuseMap = diffuse_map
                result.diffuseMapEnable = True
            result.opacity = 100
            converted[key] = result
            report['materialConversions'].append({'name': str(material.name), 'from': cls,
                'to': 'Standardmaterial', 'preserved': ['diffuse', 'bitmap diffuse map'],
                'requiresReview': ['glass', 'opacity', 'reflection', 'roughness', 'bump', 'emission']})
            return result
        if cls.lower() not in ('standardmaterial', 'standard', 'physicalmaterial'):
            raise RuntimeError('Unsupported material requires conversion/baking: ' + cls)
        converted[key] = material
        return material
    for node in nodes:
        node.material = material_to_fbx(node.material)
    rt.pluginManager.loadClass(rt.FBXEXP)
    for key, value in [('Animation', False), ('Cameras', False), ('Lights', False),
                       ('EmbedTextures', True), ('SmoothingGroups', True), ('UpAxis', 'Y')]:
        rt.FBXExporterSetParam(key, value)
    rt.select(nodes)
    rt.exportFile(str(out / 'scene.fbx'), rt.Name('noPrompt'), selectedOnly=True, using=rt.FBXEXP)
    if not (out / 'scene.fbx').is_file():
        raise RuntimeError('FBX exporter did not produce scene.fbx')
    report['state'] = 'EXPORTED_REQUIRES_VISUAL_REVIEW'
    (out / 'export-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


run()
