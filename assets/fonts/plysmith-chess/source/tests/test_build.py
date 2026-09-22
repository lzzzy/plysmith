"""Standard-library checks for the private build loader and asset packaging.
SPDX-License-Identifier: Apache-2.0
Copyright 2026 The Plysmith Project Authors.
"""
from __future__ import annotations
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import dependencies
spec = importlib.util.spec_from_file_location('font_build', ROOT / 'build.py')
font_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(font_build)


def wheel_bytes(entries: dict[str, bytes]) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return stream.getvalue()


class BuildTests(unittest.TestCase):
    def test_python_312_windows_selection(self):
        with patch.object(sys, 'platform', 'win32'), patch.object(sys, 'version_info', (3, 12, 1)), patch('dependencies.platform.machine', return_value='AMD64'), patch('dependencies.struct.calcsize', return_value=8):
            self.assertEqual(dependencies.runtime_key(), 'cp312-win_amd64')
        lock = json.loads((ROOT / 'tools/dependencies.lock.json').read_text())
        entry = lock['brotli']['wheels']['cp312-win_amd64']
        self.assertEqual(entry['filename'], 'brotli-1.2.0-cp312-cp312-win_amd64.whl')
        self.assertEqual(entry['sha256'], 'b35c13ce241abdd44cb8ca70683f20c0c079728a36a996297adb5334adfc1c44')

    def test_unsafe_archive_paths(self):
        for name in ['../outside.py', '/absolute.py', 'C:/drive.py', r'..\outside.py', 'injection.pth', 'tool.data/purelib/../mod.py']:
            with self.subTest(name=name), zipfile.ZipFile(io.BytesIO(wheel_bytes({name: b'x'}))) as archive:
                with self.assertRaises(RuntimeError):
                    list(dependencies._safe_members(archive))

    def test_fonttools_manpage_regression(self):
        # fontTools' wheel includes ordinary documentation under .data/data.
        name = 'fonttools-4.63.0.data/data/share/man/man1/ttx.1'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wheel = root / 'fonttools.whl'
            wheel.write_bytes(wheel_bytes({
                'fontTools/__init__.py': b'__version__ = "4.63.0"\n',
                name: b'.TH TTX 1\nA manual page, not an installation hook.\n',
                'fonttools-4.63.0.dist-info/METADATA': b'Name: fonttools\nVersion: 4.63.0\n',
            }))
            target = dependencies.extract_wheel(wheel, root / 'lib')
            self.assertTrue((target / 'fontTools/__init__.py').is_file())
            self.assertTrue((target / name).is_file())
            self.assertEqual(target, dependencies.extract_wheel(wheel, root / 'lib'))

    def test_library_scheme_mapping(self):
        files = {
            'tool.data/purelib/pkg/__init__.py': b'',
            'tool.data/platlib/_native.pyd': b'native payload',
            'tool.data/data/share/doc/readme.txt': b'documentation',
            'tool.data/headers/tool.h': b'header',
            'tool.data/scripts/example': b'#!python\nraise RuntimeError("must not run")',
            'tool.dist-info/METADATA': b'Name: tool\n',
        }
        with zipfile.ZipFile(io.BytesIO(wheel_bytes(files))) as archive:
            paths = {str(path) for _, path in dependencies._safe_members(archive)}
        self.assertIn('pkg/__init__.py', paths)
        self.assertIn('_native.pyd', paths)
        self.assertIn('tool.data/data/share/doc/readme.txt', paths)
        self.assertIn('tool.data/scripts/example', paths)

    def test_mapped_target_collisions(self):
        for files in [
            {'pkg/mod.py': b'', 'tool.data/purelib/pkg/mod.py': b''},
            {'tool.data/purelib/pkg/mod.py': b'', 'tool.data/platlib/PKG/mod.py': b''},
            {'pkg': b'', 'tool.data/purelib/pkg/mod.py': b''},
        ]:
            with self.subTest(files=list(files)), zipfile.ZipFile(io.BytesIO(wheel_bytes(files))) as archive:
                with self.assertRaises(RuntimeError):
                    list(dependencies._safe_members(archive))

    def test_unsupported_or_unsafe_data_layout(self):
        for name in ['tool.data/unknown/file', 'tool.data/purelib/inject.pth',
                     'tool.data/data/CON', 'tool.data/scripts/COM1.py',
                     'file.', './file', 'a//b', 'bad*/name']:
            with self.subTest(name=name), zipfile.ZipFile(io.BytesIO(wheel_bytes({name: b'x'}))) as archive:
                with self.assertRaises(RuntimeError):
                    list(dependencies._safe_members(archive))

    def test_symlink_rejected(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            info = zipfile.ZipInfo('tool.data/data/link')
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            archive.writestr(info, b'../outside')
        with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as archive:
            with self.assertRaises(RuntimeError):
                list(dependencies._safe_members(archive))

    def test_case_collisions(self):
        with zipfile.ZipFile(io.BytesIO(wheel_bytes({'a.py': b'a', 'A.py': b'b'}))) as archive:
            with self.assertRaises(RuntimeError):
                list(dependencies._safe_members(archive))

    def test_private_extract_and_integrity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'example.whl'
            source.write_bytes(wheel_bytes({'example/__init__.py': b'version = 1\n', 'example.dist-info/METADATA': b'Name: example\n'}))
            target = dependencies.extract_wheel(source, root / 'lib')
            self.assertEqual((target / 'example/__init__.py').read_bytes(), b'version = 1\n')
            self.assertEqual(target, dependencies.extract_wheel(source, root / 'lib'))
            (target / 'example/__init__.py').write_bytes(b'version = 9\n')
            with self.assertRaises(RuntimeError):
                dependencies.extract_wheel(source, root / 'lib')

    def test_download_hash_and_cache(self):
        content = wheel_bytes({'example.py': b'value = 1\n'})
        sha = hashlib.sha256(content).hexdigest()
        package = {'version': '1.0'}
        wheel = {'filename': 'example-1.0-py3-none-any.whl', 'sha256': sha}
        metadata = json.dumps({'urls': [{'filename': wheel['filename'], 'digests': {'sha256': sha}, 'url': 'https://files.pythonhosted.org/example.whl'}]}).encode()
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            with patch.object(dependencies, '_get', side_effect=[metadata, content]) as download:
                result = dependencies.fetch_wheel('example', package, wheel, cache, False)
                self.assertEqual(result.read_bytes(), content)
                self.assertEqual(download.call_count, 2)
            with patch.object(dependencies, '_get', side_effect=AssertionError('Network should not be used')):
                self.assertEqual(result, dependencies.fetch_wheel('example', package, wheel, cache, True))
            result.write_bytes(b'broken')
            with self.assertRaises(RuntimeError):
                dependencies.fetch_wheel('example', package, wheel, cache, True)

    def test_offline_missing_dependency(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(RuntimeError):
                dependencies.fetch_wheel('example', {'version':'1.0'}, {'filename':'x.whl','sha256':'0'*64}, Path(temp), True)

    def test_wrong_download_metadata(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(dependencies, '_get', return_value=b'{"urls": []}'):
            with self.assertRaises(RuntimeError):
                dependencies.fetch_wheel('example', {'version':'1.0'}, {'filename':'x.whl','sha256':'0'*64}, Path(temp), False)

    def test_wrong_download_bytes(self):
        wheel={'filename':'x.whl','sha256':'0'*64}
        meta=json.dumps({'urls':[{'filename':'x.whl','digests':{'sha256':'0'*64},'url':'https://files.pythonhosted.org/x.whl'}]}).encode()
        with tempfile.TemporaryDirectory() as temp, patch.object(dependencies, '_get', side_effect=[meta,b'wrong']):
            with self.assertRaises(RuntimeError):
                dependencies.fetch_wheel('example', {'version':'1.0'}, wheel, Path(temp), False)
            self.assertFalse((Path(temp)/'x.whl').exists())

    def test_source_contract(self):
        source = json.loads((ROOT / 'src/glyphs.json').read_text())
        self.assertEqual(set(source), {'schema_version','coordinate_system','glyphs','horizontal_metrics'})
        self.assertEqual(len(source['glyphs']), 12)
        meta = json.loads((ROOT / 'src/font.json').read_text())
        self.assertEqual(set(meta['codepoints'].values()), set(range(0x2654,0x2660)))

    def test_publish_preserves_unrelated_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp);stage=root/'stage';target=root/'dist';stage.mkdir();target.mkdir()
            (target/'private.txt').write_text('keep');(stage/'font.json').write_text('{}')
            with self.assertRaises(ValueError):
                font_build.publish(stage,target)
            self.assertEqual((target/'private.txt').read_text(),'keep')

    def test_publish_replaces_asset_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);stage=root/'stage';target=root/'dist';stage.mkdir();target.mkdir()
            (stage/'font.json').write_text('new');(target/'font.json').write_text('old')
            font_build.publish(stage,target)
            self.assertEqual((target/'font.json').read_text(),'new')
            self.assertFalse((root/'.dist-previous').exists())

    def test_input_lock(self):
        lock = json.loads((ROOT/'build.lock.json').read_text())
        font_build.check_inputs(ROOT,lock)


if __name__ == '__main__':
    unittest.main(verbosity=2)
