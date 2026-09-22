"""Private, hash-locked wheel loading without pip, venv or site-packages.

SPDX-License-Identifier: Apache-2.0
Copyright 2026 The Plysmith Project Authors.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
from pathlib import Path, PurePosixPath
import shutil
import struct
import sys
import tempfile
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zipfile

MAX_DOWNLOAD = 32 * 1024 * 1024
MAX_EXTRACTED = 160 * 1024 * 1024


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
        return digest.hexdigest()


def runtime_key() -> str:
    if sys.implementation.name != 'cpython':
        raise RuntimeError('CPython erforderlich.')
    version = sys.version_info[:2]
    if not (3, 10) <= version <= (3, 14):
        raise RuntimeError('Python 3.10 bis 3.14 erforderlich.')
    if struct.calcsize('P') != 8:
        raise RuntimeError('Eine 64-Bit-Python-Ausgabe ist erforderlich.')
    if getattr(sys, 'abiflags', '') and 't' in sys.abiflags:
        raise RuntimeError('Die Free-Threaded-Python-Ausgabe wird nicht unterstuetzt.')
    if sys.platform == 'win32':
        if platform.machine().lower() not in ('amd64', 'x86_64'):
            raise RuntimeError('Die Windows-Buildwerkzeuge benoetigen Python fuer x86-64.')
        target = 'win_amd64'
    elif sys.platform.startswith('linux') and platform.machine().lower() in ('amd64', 'x86_64'):
        libc, version_text = platform.libc_ver()
        try:
            glibc = tuple(int(value) for value in version_text.split('.')[:2])
        except ValueError:
            glibc = ()
        if libc != 'glibc' or glibc < (2, 17):
            raise RuntimeError('Linux benoetigt glibc ab 2.17.')
        target = 'linux_x86_64'
    else:
        raise RuntimeError('Unterstuetzt: Windows x86-64 oder Linux x86-64 mit glibc.')
    return f'cp{version[0]}{version[1]}-{target}'


def _get(url: str, limit: int = MAX_DOWNLOAD) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ('pypi.org', 'files.pythonhosted.org'):
        raise RuntimeError('Nicht erlaubte Downloadadresse.')
    request = Request(url, headers={'User-Agent': 'Plysmith-Chess-Build/1.0'})
    try:
        with urlopen(request, timeout=45) as response:
            final = urlparse(response.geturl())
            if final.scheme != 'https' or final.hostname not in ('pypi.org', 'files.pythonhosted.org'):
                raise RuntimeError('Nicht erlaubte Downloadweiterleitung.')
            data = response.read(limit + 1)
    except (URLError, TimeoutError, OSError) as error:
        raise RuntimeError(
            'Buildwerkzeuge konnten nicht geladen werden. Internetzugang zu '
            'pypi.org und files.pythonhosted.org pruefen; bei Bedarf HTTPS_PROXY setzen. '
            f'Ursache: {error}'
        ) from error
    if len(data) > limit:
        raise RuntimeError('Download ueberschreitet die zulaessige Groesse.')
    return data


def fetch_wheel(name: str, package: dict, wheel: dict, cache: Path, offline: bool) -> Path:
    filename = wheel['filename']
    if Path(filename).name != filename or '/' in filename or '\\' in filename or not filename.endswith('.whl'):
        raise RuntimeError('Ungueltiger Paketdateiname.')
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / filename
    if target.is_file():
        if sha256(target) != wheel['sha256']:
            raise RuntimeError(f'Pruefsumme fehlerhaft: {target}. Datei loeschen und erneut starten.')
        return target
    if offline:
        raise RuntimeError(f'Offline fehlt das Buildwerkzeug {filename} in {cache}.')
    print(f'Lade {name} {package["version"]} ...', flush=True)
    metadata = json.loads(_get(f'https://pypi.org/pypi/{name}/{package["version"]}/json', 8 * 1024 * 1024))
    matches = [item for item in metadata.get('urls', []) if item.get('filename') == filename]
    if len(matches) != 1 or matches[0].get('digests', {}).get('sha256') != wheel['sha256']:
        raise RuntimeError(f'PyPI-Datei oder Pruefsumme fuer {filename} stimmt nicht mit dem Lockfile ueberein.')
    content = _get(matches[0]['url'])
    if hashlib.sha256(content).hexdigest() != wheel['sha256']:
        raise RuntimeError(f'Download-Pruefsumme fehlerhaft: {filename}.')
    with tempfile.NamedTemporaryFile(dir=cache, suffix='.part', delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(content)
    try:
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def _safe_members(archive: zipfile.ZipFile):
    """Map a locked wheel into a private import directory, never run installers.

    Wheel .data is an ordinary install-scheme directory, not an install hook.
    purelib/platlib payload belongs on the import path. Documentation, headers
    and command scripts are preserved under .data but never installed globally
    or executed. In particular, fontTools ships a ttx manual page there.
    """
    total = 0
    archive_paths = set()
    target_paths = set()
    target_parents = set()
    for info in archive.infolist():
        raw = info.filename
        path = PurePosixPath(raw)
        parts = raw.rstrip('/').split('/')
        if (not raw or path.is_absolute() or any(part in ('', '.', '..') for part in parts)
                or '\\' in raw or ':' in raw or any(ord(char) < 32 for char in raw)):
            raise RuntimeError(f'Unsicherer Pfad im Buildwerkzeug: {raw!r}.')
        # Reject names that alias other paths or devices on Windows.
        devices = {'con', 'prn', 'aux', 'nul', 'conin$', 'conout$',
                   *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}
        if any(part.endswith((' ', '.')) or part.split('.')[0].casefold() in devices
               or any(char in part for char in '<>"|?*') for part in parts):
            raise RuntimeError(f'Nicht portabler Pfad im Buildwerkzeug: {raw!r}.')
        if ((info.external_attr >> 16) & 0o170000) == 0o120000:
            raise RuntimeError('Symbolische Links im Buildwerkzeug sind nicht zulaessig.')
        if info.flag_bits & 1:
            raise RuntimeError('Verschluesselte Buildwerkzeuge werden nicht unterstuetzt.')
        if info.is_dir():
            continue
        if path.suffix.lower() == '.pth':
            raise RuntimeError(f'Python-Startdatei im Buildwerkzeug nicht zulaessig: {raw}.')

        archive_key = str(path).casefold()
        if archive_key in archive_paths:
            raise RuntimeError('Doppelter Dateipfad im Buildwerkzeug.')
        archive_paths.add(archive_key)

        if path.parts[0].endswith('.data'):
            if len(path.parts) < 3:
                raise RuntimeError(f'Ungueltiger Wheel-Datenpfad: {raw}.')
            scheme = path.parts[1]
            if scheme in ('purelib', 'platlib'):
                path = PurePosixPath(*path.parts[2:])
            elif scheme not in ('data', 'headers', 'scripts'):
                raise RuntimeError(f'Nicht unterstuetzter Wheel-Datenbereich: {scheme}.')
            # data/headers/scripts stay inert in their private .data subtree.

        key = str(path).casefold()
        parents = {str(parent).casefold() for parent in path.parents if str(parent) != '.'}
        if key in target_paths or key in target_parents or parents.intersection(target_paths):
            raise RuntimeError('Kollidierende Zielpfade im Buildwerkzeug.')
        target_paths.add(key)
        target_parents.update(parents)
        total += info.file_size
        if total > MAX_EXTRACTED:
            raise RuntimeError('Entpacktes Buildwerkzeug zu gross.')
        yield info, path


def extract_wheel(wheel_path: Path, library_root: Path) -> Path:
    destination = library_root / ('wheel-v2-' + sha256(wheel_path))
    library_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(wheel_path) as archive:
        members = list(_safe_members(archive))
        if destination.exists():
            if destination.is_symlink():
                raise RuntimeError('Ein Cacheverzeichnis darf kein symbolischer Link sein.')
            expected = {str(path) for _, path in members}
            if any(p.is_symlink() for p in destination.rglob('*')):
                raise RuntimeError('Symbolischer Link im Werkzeugcache.')
            actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file()}
            if actual != expected:
                raise RuntimeError(f'Veraenderter Werkzeugcache: {destination}. Ordner loeschen und erneut starten.')
            for info, path in members:
                local = destination.joinpath(*path.parts)
                if local.is_symlink() or local.stat().st_size != info.file_size or local.read_bytes() != archive.read(info):
                    raise RuntimeError(f'Veraenderte Werkzeugdatei: {local}. Cache loeschen und erneut starten.')
            return destination
        stage = Path(tempfile.mkdtemp(prefix='.extract-', dir=library_root))
        try:
            for info, path in members:
                target = stage.joinpath(*path.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(info))
            # Native modules remain in this private cache; do not remove loaded DLLs on Windows.
            os.replace(stage, destination)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    return destination


def activate(root: Path, *, offline: bool = False) -> None:
    """Load exact private tools, including under Python's isolated ._pth configuration."""
    key = runtime_key()
    locked = json.loads((root / 'tools/dependencies.lock.json').read_text(encoding='utf-8'))
    selections = []
    for name, package in locked.items():
        wheel = package['wheels'].get('any') or package['wheels'].get(key)
        if wheel is None:
            raise RuntimeError(f'Kein festgelegtes {name}-Wheel fuer {key}.')
        selections.append((name, package, wheel))
    cache = root / '.build-cache'
    paths = []
    for name, package, wheel in selections:
        downloaded = fetch_wheel(name, package, wheel, cache / 'wheels', offline)
        paths.append(str(extract_wheel(downloaded, cache / 'lib')))
    sys.dont_write_bytecode = True
    sys.path[:0] = paths
    from importlib.metadata import version
    for name, package, _ in selections:
        if version(name) != package['version']:
            raise RuntimeError(f'Falsche Werkzeugversion geladen: {name}.')
    try:
        import fontTools
        import brotli
        import _brotli
    except ImportError as error:
        raise RuntimeError(f'Buildwerkzeug kann fuer {key} nicht geladen werden: {error}') from error
    for module in (fontTools, brotli, _brotli):
        if not Path(module.__file__).resolve().is_relative_to((cache / 'lib').resolve()):
            raise RuntimeError(f'Buildwerkzeug wurde nicht aus dem privaten Cache geladen: {module.__name__}.')
