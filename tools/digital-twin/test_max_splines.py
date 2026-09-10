import struct
import unittest
from max_splines import decode_knots, legacy_int


class SplineTests(unittest.TestCase):
    def test_source_cap_flags_use_integer_storage(self):
        class Chunk:
            def __init__(self,t,data=b'',children=()):self.types=t;self.data=data;self.children=children
            def get_first(self,t):return next((c for c in self.children if c.types==t),None)
        block=Chunk(0,children=[Chunk(2,children=[Chunk(3,struct.pack('<I',3)),Chunk(0x101,struct.pack('<i',0))])])
        self.assertEqual(legacy_int(block,3),0)
        self.assertIsNone(legacy_int(block,2))
    def test_source_point_and_tangents(self):
        row = struct.pack('<II10fI', 3, 0, .5, 1, 2, 3, 0, 2, 3, 2, 2, 3, 0)
        knot = decode_knots(row * 2, 2)[0]
        self.assertEqual(knot['point'], (1, 2, 3))
        self.assertEqual(knot['incoming'], (0, 2, 3))
        self.assertEqual(knot['outgoing'], (2, 2, 3))

    def test_incomplete_encoding_rejected(self):
        with self.assertRaises(ValueError): decode_knots(b'\0' * 51, 2)

    def test_nonfinite_rejected(self):
        row=struct.pack('<II10fI',3,0,.5,float('nan'),2,3,0,2,3,2,2,3,0)
        with self.assertRaises(ValueError):decode_knots(row*2,2)


if __name__=='__main__':unittest.main()
