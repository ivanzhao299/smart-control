"""Inspect supplied MAX/texture archive; create a new local, immutable-source job."""
import argparse
import hashlib
import json
import shutil
import stat
import tempfile
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath

from PIL import Image, ImageOps
import olefile

Image.MAX_IMAGE_PIXELS = 150_000_000


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def decoded_name(info):
    value = info.filename
    if not info.flag_bits & 0x800:
        try:
            value = value.encode('cp437').decode('utf-8')
        except UnicodeError:
            pass
    return unicodedata.normalize('NFC', value)


def safe_entries(archive):
    result, seen = [], set()
    for info in archive.infolist():
        value = decoded_name(info).replace('\\', '/')
        path = PurePosixPath(value)
        mode = info.external_attr >> 16
        if (path.is_absolute() or '..' in path.parts
                or ':' in value or stat.S_ISLNK(mode)):
            raise ValueError(f'Unsafe ZIP entry: {value}')
        if info.is_dir() or value.startswith('__MACOSX/') or path.name == '.DS_Store':
            continue
        key = value.casefold()
        if key in seen:
            raise ValueError(f'Duplicate ZIP path: {value}')
        seen.add(key)
        if info.file_size > 512 * 1024**2:
            raise ValueError(f'Entry larger than 512 MiB: {value}')
        result.append((info, path))
    if len(result) > 2000 or sum(i.file_size for i, _ in result) > 2 * 1024**3:
        raise ValueError('Archive exceeds intake budget')
    return result


def intake(model, textures, output, max_side=2048):
    model, textures, output = Path(model), Path(textures), Path(output)
    if output.exists():
        raise ValueError('Use a fresh job directory; existing jobs are never overwritten')
    if model.suffix.lower() == '.zip':
        with zipfile.ZipFile(model) as archive:
            candidates = [(i, p) for i, p in safe_entries(archive) if p.suffix.lower() == '.max']
            if len(candidates) != 1:
                raise ValueError('Model archive must contain exactly one MAX scene')
            with tempfile.TemporaryDirectory(prefix='twin-max-source-') as scratch:
                extracted = Path(scratch) / 'scene.max'
                with archive.open(candidates[0][0]) as src, extracted.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
                return intake(extracted, textures, output, max_side)
    if max_side not in (1024, 2048, 4096):
        raise ValueError('Texture size must be 1024, 2048 or 4096')
    if not olefile.isOleFile(model):
        raise ValueError('Input is not a compound MAX scene')
    with olefile.OleFileIO(model) as scene:
        streams = [{'name': '/'.join(p), 'bytes': scene.get_size(p)} for p in scene.listdir()]
        if not any(s['name'] in ('Scene', 'Scene_Compressed') for s in streams):
            raise ValueError('MAX scene stream missing')
    with zipfile.ZipFile(textures) as archive:
        entries = safe_entries(archive)
        manifests = [(i, p) for i, p in entries if p.name.casefold() == 'maxfiles.txt']
        if len(manifests) != 1:
            raise ValueError('Exactly one MAXFILES.TXT is required')
        raw = archive.read(manifests[0][0]).decode('utf-8-sig')
        refs = [r for r in raw.splitlines() if PureWindowsPath(r).suffix.lower() in ('.jpg', '.jpeg', '.png', '.tif', '.tiff')]
        assets = []
        for ref in refs:
            suffix = unicodedata.normalize('NFC', str(PureWindowsPath(ref).relative_to(PureWindowsPath(ref).anchor))).replace('\\', '/').casefold()
            matches = [(i, p) for i, p in entries if str(p).casefold().endswith('/' + suffix)]
            if len(matches) != 1:
                raise ValueError(f'Missing or ambiguous asset: {PureWindowsPath(ref).name}')
            assets.append(matches[0])
        if len({p.name.casefold() for _, p in assets}) != len(assets):
            raise ValueError('Texture basenames collide; manual relinking is required')
        # CRC check streams all entries without allocating the archive in memory.
        bad = archive.testzip()
        if bad:
            raise ValueError(f'ZIP integrity failure: {bad}')
        (output / 'source' / 'textures').mkdir(parents=True)
        (output / 'worker-input' / 'textures').mkdir(parents=True)
        shutil.copy2(model, output / 'source' / 'scene.max')
        # Separate source hashes and conversion inputs: material optimization never changes originals.
        shutil.copy2(model, output / 'worker-input' / 'scene.max')
        report = {
            'schemaVersion': 1, 'state': 'WAITING_MAX_EXPORT',
            'model': {'sha256': digest(model), 'bytes': model.stat().st_size, 'streams': streams},
            'archive': {'sha256': digest(textures), 'bytes': textures.stat().st_size, 'crcValid': True},
            'matchedTextures': len(assets), 'textureMaxSide': max_side, 'textures': [],
            'geometryVerified': False, 'oppositeCameraVerified': False,
        }
        for info, path in assets:
            source = output / 'source' / 'textures' / path.name
            with archive.open(info) as src, source.open('xb') as dst:
                shutil.copyfileobj(src, dst)
            dest = output / 'worker-input' / 'textures' / path.name
            with Image.open(source) as image:
                original_size = list(image.size)
                if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError(f'Texture pixel budget exceeded: {path.name}')
                image.draft('RGB', (max_side, max_side))
                image = ImageOps.exif_transpose(image)
                image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
                if dest.suffix.lower() in ('.jpg', '.jpeg'):
                    image.convert('RGB').save(dest, quality=88, optimize=True)
                else:
                    image.save(dest)
                target_size = list(image.size)
            report['textures'].append({
                'name': path.name, 'sourceBytes': source.stat().st_size, 'sourceSize': original_size,
                'sourceSha256': digest(source), 'webBytes': dest.stat().st_size,
                'webSize': target_size, 'webSha256': digest(dest),
            })
        report['sourceTextureBytes'] = sum(t['sourceBytes'] for t in report['textures'])
        report['webTextureBytes'] = sum(t['webBytes'] for t in report['textures'])
        (output / 'intake.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--textures', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--texture-size', type=int, default=2048)
    args = parser.parse_args()
    result = intake(args.model, args.textures, args.output, args.texture_size)
    print(json.dumps({k: result[k] for k in ('state', 'matchedTextures', 'sourceTextureBytes', 'webTextureBytes')}, indent=2))
