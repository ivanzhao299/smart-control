"""Small compatibility layer for newer MAX compressed OLE streams.

No scene scripts are executed. Limited to the wrapper format observed in the
supplied MAX; unsupported versions must fail or remain explicitly unverified.
"""
import struct

PIN = '37db107126f956f7219152671443080360565691'
MAX_STREAM_BYTES = 1024 ** 3


def find_stream(self, filename):
    names = filename.split('/') if isinstance(filename, str) else filename
    node = self.root
    for name in names:
        matches = [k for k in node.kids if k.name.casefold() == name.casefold()]
        if not matches:
            matches = [k for k in node.kids if k.name.casefold() == (name + '_Compressed').casefold()]
        if len(matches) != 1: raise KeyError('Missing or ambiguous MAX stream: ' + str(name))
        node = matches[0]
    return node.sid


def decode_stream(raw, name):
    """Return decoded payload and whether it contained an open Scene wrapper."""
    if raw[:6] != bytes.fromhex('ffff28b52ffd'): return raw, False
    import zstandard
    declared = zstandard.frame_content_size(raw[2:])
    if declared not in (zstandard.CONTENTSIZE_UNKNOWN, zstandard.CONTENTSIZE_ERROR) and declared > MAX_STREAM_BYTES:
        raise ValueError('Declared MAX stream exceeds memory guard')
    raw = zstandard.ZstdDecompressor().decompress(raw[2:], max_output_size=MAX_STREAM_BYTES)
    if len(raw) > MAX_STREAM_BYTES: raise ValueError('MAX stream exceeds memory guard')
    print('MAX_ZSTD', name, len(raw), flush=True)
    if name == 'Scene' and raw[2:14] == bytes.fromhex('01000000ffffffffffffffff'):
        return raw, True
    if raw[2:6] == b'\xff' * 4: raw = raw[6:]
    return raw, False


def install(importer):
    importer.ImportMaxFile._find = find_stream
    def read_chunks(maxfile, name, conReader=importer.ContainerChunk, primReader=importer.ByteArrayChunk, superId=None):
        with maxfile.openstream(name) as stream: raw = stream.read()
        raw, scene_wrapper = decode_stream(raw, name)
        if scene_wrapper:
            parent = importer.SceneChunk(2, struct.unpack_from('<H', raw)[0], 0, 0, 0, len(raw))
            parent.children = importer.ChunkReader(name).get_chunks(2, raw[14:], 1, conReader, primReader)
            return [parent]
        return importer.ChunkReader(name).get_chunks(superId, raw, 0, conReader, primReader)
    importer.read_chunks = read_chunks
