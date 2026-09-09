import unittest
from unittest.mock import patch
from types import SimpleNamespace as Node
import zstandard
from max_streams import decode_stream, find_stream


class MaxStreams(unittest.TestCase):
    def compressed(self, raw):
        return b'\xff\xff' + zstandard.ZstdCompressor().compress(raw)

    def test_exact_name_precedes_compressed(self):
        node = Node(root=Node(kids=[Node(name='Scene', sid=1), Node(name='Scene_Compressed', sid=2)]))
        self.assertEqual(find_stream(node, 'scene'), 1)

    def test_compressed_alias(self):
        node = Node(root=Node(kids=[Node(name='Scene_Compressed', sid=2)]))
        self.assertEqual(find_stream(node, 'Scene'), 2)
        with self.assertRaises(KeyError): find_stream(node, 'Missing')

    def test_ambiguous_rejected(self):
        node = Node(root=Node(kids=[Node(name='Scene', sid=1), Node(name='SCENE', sid=2)]))
        with self.assertRaises(KeyError): find_stream(node, 'Scene')

    def test_old_stream_unchanged(self):
        self.assertEqual(decode_stream(b'original', 'Scene'), (b'original', False))

    def test_directory_header(self):
        raw = bytes.fromhex('0422ffffffff') + b'children'
        self.assertEqual(decode_stream(self.compressed(raw), 'ClassDirectory3'), (b'children', False))

    def test_scene_header(self):
        raw = bytes.fromhex('292001000000ffffffffffffffff') + b'children'
        self.assertEqual(decode_stream(self.compressed(raw), 'Scene'), (raw, True))

    def test_invalid_zstd_fails(self):
        with self.assertRaises(zstandard.ZstdError): decode_stream(bytes.fromhex('ffff28b52ffd'), 'Scene')

    def test_declared_large_stream_rejected_before_allocation(self):
        with patch('max_streams.MAX_STREAM_BYTES', 5):
            with self.assertRaises(ValueError): decode_stream(self.compressed(b'123456'), 'Scene')


if __name__ == '__main__': unittest.main()
