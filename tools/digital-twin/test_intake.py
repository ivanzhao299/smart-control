import unittest
import zipfile
import io
from intake import decoded_name, safe_entries


class ArchiveSafety(unittest.TestCase):
    def archive(self, names):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for name in names: archive.writestr(name, 'texture')
        data.seek(0)
        return zipfile.ZipFile(data)

    def test_macos_legacy_utf8_names(self):
        info = zipfile.ZipInfo('路面.jpg'.encode('utf-8').decode('cp437'))
        self.assertEqual(decoded_name(info), '路面.jpg')

    def test_path_traversal_rejected(self):
        for name in ('../scene.max', '/scene.max', 'C:/scene.max', 'a\\..\\scene.max'):
            with self.subTest(name=name), self.archive([name]) as archive:
                with self.assertRaises(ValueError): safe_entries(archive)

    def test_case_collisions_rejected(self):
        with self.archive(['Maps/ROAD.jpg', 'maps/road.jpg']) as archive:
            with self.assertRaises(ValueError): safe_entries(archive)

    def test_resource_forks_ignored(self):
        with self.archive(['maps/road.jpg', '__MACOSX/maps/._road.jpg', '.DS_Store']) as archive:
            self.assertEqual(len(safe_entries(archive)), 1)

    def test_symlink_rejected(self):
        info = zipfile.ZipInfo('maps/link.jpg')
        info.external_attr = 0o120777 << 16
        with self.archive([info]) as archive:
            with self.assertRaises(ValueError): safe_entries(archive)


if __name__ == '__main__': unittest.main()
