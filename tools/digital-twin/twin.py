"""Local asset workflow entry point. No automatic production deployment or cloud submission."""
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get('TWIN_HOME', Path.home() / '.local/share/smart-control-twin'))
BLENDER = ROOT / 'runtime/Blender-4.5.9.app/Contents/MacOS/Blender'
PYTHON = ROOT / 'runtime/py311/bin/python'


def execute(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def convert(source, output, source_id, ratio=1.0, fixture=False):
    execute([BLENDER, '--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1',
             '--python', HERE / 'blender_convert.py', '--', '--input', source, '--output', output,
             '--source-id', source_id, '--ratio', str(ratio)] + (['--fixture'] if fixture else []))
    execute([HERE / 'node_modules/.bin/gltf-transform', 'meshopt', output / 'scene-source.glb', output / 'scene.glb'])
    result = subprocess.run(['node', str(HERE / 'inspect-glb.mjs'), str(output / 'scene.glb')], text=True, capture_output=True)
    (output / 'validation.json').write_text(result.stdout, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('GLB validation/budget failed. See validation.json; do not publish this artifact.')
    # Cross-check optimized GLB and the stable entity map without relying on display names.
    from struct import unpack_from
    data = (output / 'scene.glb').read_bytes()
    document = json.loads(data[20:20 + unpack_from('<I', data, 12)[0]])
    ids = {n.get('extras', {}).get('twinId') for n in document.get('nodes', []) if 'mesh' in n}
    manifest = json.loads((output / 'twin-manifest.json').read_text())
    if ids != {e['id'] for e in manifest['entities']}:
        raise RuntimeError('Entity IDs changed during optimization; manual review required')
    print(result.stdout)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('doctor')
    a = sub.add_parser('intake'); a.add_argument('--model', required=True); a.add_argument('--textures', required=True); a.add_argument('--job', required=True)
    c = sub.add_parser('convert'); c.add_argument('--input', required=True); c.add_argument('--output', required=True); c.add_argument('--source-id', default='jinhu-park'); c.add_argument('--ratio', type=float, default=1)
    s = sub.add_parser('smoke'); s.add_argument('--job', required=True)
    w = sub.add_parser('pack-worker'); w.add_argument('--job', required=True); w.add_argument('--output', required=True)
    v = sub.add_parser('serve'); v.add_argument('--job', required=True); v.add_argument('--port', type=int, default=5199)
    args = p.parse_args()
    if args.command == 'doctor':
        checks = {'architecture': platform.machine(), 'blenderInstalled': BLENDER.is_file(),
                  'pythonInstalled': PYTHON.is_file(), 'nodeInstalled': bool(shutil.which('node')),
                  'meshoptInstalled': (HERE / 'node_modules/.bin/gltf-transform').is_file(),
                  'maxWorker': 'NOT_CONNECTED', 'apsCredentialsPresent': bool(os.environ.get('APS_CLIENT_ID') and os.environ.get('APS_CLIENT_SECRET'))}
        if checks['blenderInstalled']:
            checks['blenderVersion'] = subprocess.check_output([str(BLENDER), '--version'], text=True).splitlines()[0]
        print(json.dumps(checks, indent=2))
    elif args.command == 'intake':
        execute([PYTHON, HERE / 'intake.py', '--model', args.model, '--textures', args.textures, '--output', args.job])
    elif args.command == 'convert':
        convert(Path(args.input).resolve(), Path(args.output).resolve(), args.source_id, args.ratio)
    elif args.command == 'smoke':
        job = Path(args.job).resolve()
        execute([BLENDER, '--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', HERE / 'create_fixture.py', '--', job / 'test-input' / 'fixture.fbx'])
        convert(job / 'test-input/fixture.fbx', job / 'preview', 'synthetic-fixture', fixture=True)
    elif args.command == 'pack-worker':
        job, output = Path(args.job).resolve(), Path(args.output).resolve()
        report = json.loads((job / 'intake.json').read_text())
        if report['state'] != 'WAITING_MAX_EXPORT':
            raise ValueError('Job is not ready for MAX export')
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            for file in sorted((job / 'worker-input').rglob('*')):
                if file.is_file(): archive.write(file, file.relative_to(job).as_posix())
            for name in ['max-export.py', 'windows-export.ps1', 'WINDOWS-WORKER.md']:
                archive.write(HERE / name, name)
        print('Worker package created locally:', output)
    elif args.command == 'serve':
        execute(['node', HERE / 'server.mjs'], env={**os.environ, 'TWIN_JOB': str(Path(args.job).resolve()), 'TWIN_PORT': str(args.port)})


if __name__ == '__main__':
    main()
