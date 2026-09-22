#!/usr/bin/env python3
"""Build and verify Plysmith Chess from its vector sources.

SPDX-License-Identifier: OFL-1.1
Copyright 2026 The Plysmith Project Authors.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def write_text(path: Path, text: str) -> None:
    path.write_bytes(text.replace('\r\n', '\n').encode('utf-8'))


def compile_font(source: dict, meta: dict, license_text: str, ttf: Path) -> None:
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    codes = meta['codepoints']
    require(set(source['glyphs']) == set(codes), 'Genau zwoelf Schachglyphen erforderlich.')
    order = ['.notdef', 'space', *codes]
    builder = FontBuilder(meta['units_per_em'], isTTF=True)
    builder.setupGlyphOrder(order)
    glyphs = {}
    allowed = {'moveTo', 'lineTo', 'curveTo', 'qCurveTo', 'closePath'}
    for name in order:
        pen = TTGlyphPen(None)
        if name in codes:
            drawing = TransformPen(
                Cu2QuPen(pen, max_err=meta['quadratic_error'], reverse_direction=False),
                tuple(meta['source_transform']),
            )
            for command, points in source['glyphs'][name]:
                require(command in allowed, f'Ungueltiger Pfadbefehl: {command}.')
                getattr(drawing, command)(*[tuple(point) for point in points])
        elif name == '.notdef':
            pen.moveTo((375, 300)); pen.lineTo((875, 300)); pen.lineTo((875, 800)); pen.lineTo((375, 800)); pen.closePath()
            pen.moveTo((425, 350)); pen.lineTo((425, 750)); pen.lineTo((825, 750)); pen.lineTo((825, 350)); pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupCharacterMap({32: 'space', **{cp: name for name, cp in codes.items()}})
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({
        name: tuple(source['horizontal_metrics'].get(name, [meta['advance_width'], getattr(glyph, 'xMin', 0)]))
        for name, glyph in glyphs.items()
    })
    builder.setupHorizontalHeader(ascent=meta['ascent'], descent=meta['descent'], lineGap=meta['line_gap'])
    builder.setupNameTable({
        'familyName': meta['family'], 'styleName': meta['style'],
        'fullName': meta['family'] + ' ' + meta['style'], 'psName': meta['postscript_name'],
        'uniqueFontIdentifier': f'{meta["version"]};NONE;{meta["postscript_name"]}',
        'version': 'Version ' + meta['version'], 'copyright': meta['copyright'],
        'description': meta['description'], 'licenseDescription': license_text,
        'licenseInfoURL': meta['license_url'], 'manufacturer': meta['manufacturer'],
        'designer': meta['designer'], 'typographicFamily': meta['family'],
        'typographicSubfamily': meta['style'],
    })
    builder.setupOS2(
        version=4, sTypoAscender=meta['ascent'], sTypoDescender=meta['descent'],
        sTypoLineGap=meta['line_gap'], usWinAscent=meta['ascent'], usWinDescent=-meta['descent'],
        fsSelection=0xc0, fsType=0, usWeightClass=400, usWidthClass=5, achVendID='NONE',
        sxHeight=0, sCapHeight=0,
        ySubscriptXSize=650, ySubscriptYSize=650, ySubscriptXOffset=0, ySubscriptYOffset=140,
        ySuperscriptXSize=650, ySuperscriptYSize=650, ySuperscriptXOffset=0, ySuperscriptYOffset=350,
        yStrikeoutSize=50, yStrikeoutPosition=300,
    )
    builder.setupPost(isFixedPitch=1, underlinePosition=-175, underlineThickness=50)
    builder.setupMaxp()
    builder.font['head'].fontRevision = float(meta['version'])
    builder.font['head'].created = meta['created']
    builder.font['head'].modified = meta['modified']
    builder.font.recalcTimestamp = False
    builder.save(ttf)


def signature(font) -> dict:
    result = {}
    for name in font.getGlyphOrder():
        glyph = font['glyf'][name]
        result[name] = {
            'metrics': list(font['hmtx'][name]),
            'points': [list(point) for point in glyph.coordinates] if glyph.numberOfContours > 0 else [],
            'flags': list(glyph.flags) if glyph.numberOfContours > 0 else [],
            'ends': list(glyph.endPtsOfContours) if glyph.numberOfContours > 0 else [],
            'instructions': list(glyph.program.getBytecode()) if hasattr(glyph, 'program') else [],
        }
    return {
        'glyphs': result, 'cmap': font.getBestCmap(), 'upem': font['head'].unitsPerEm,
        'vertical': [font['hhea'].ascent, font['hhea'].descent, font['hhea'].lineGap,
                     font['OS/2'].sTypoAscender, font['OS/2'].sTypoDescender, font['OS/2'].sTypoLineGap,
                     font['OS/2'].usWinAscent, font['OS/2'].usWinDescent],
    }


def sfnt_checksum(data: bytes) -> int:
    padded = data + b'\0' * (-len(data) % 4)
    return sum(struct.unpack(f'>{len(padded) // 4}I', padded)) & 0xffffffff


def validate_sfnt(path: Path) -> None:
    data = path.read_bytes()
    require(sfnt_checksum(data) == 0xb1b0afba, 'TTF-Gesamtpruefsumme falsch.')
    flavor, count, search_range, selector, shift = struct.unpack('>IHHHH', data[:12])
    require(flavor == 0x10000, 'TrueType-Datei erwartet.')
    power = 1 << (count.bit_length() - 1)
    require((search_range, selector, shift) == (power * 16, count.bit_length() - 1, count * 16 - power * 16), 'TTF-Tabellenverzeichnis fehlerhaft.')
    records = []
    for index in range(count):
        tag, checksum, offset, size = struct.unpack('>4sIII', data[12 + 16 * index:28 + 16 * index])
        require(offset % 4 == 0 and offset >= 12 + 16 * count and offset + size <= len(data), f'{tag}: ungueltige Tabellengrenze.')
        payload = data[offset:offset + size]
        if tag == b'head':
            payload = payload[:8] + b'\0' * 4 + payload[12:]
        require(sfnt_checksum(payload) == checksum, f'{tag}: Tabellenpruefsumme falsch.')
        records.append((tag, offset, size))
    require([entry[0] for entry in records] == sorted({entry[0] for entry in records}), 'TTF-Tabellen nicht eindeutig/sortiert.')
    positions = sorted(records, key=lambda entry: entry[1])
    require(all(a[1] + a[2] <= b[1] for a, b in zip(positions, positions[1:])), 'TTF-Tabellen ueberlappen.')


def build_outputs(root: Path, destination: Path) -> dict:
    """Generate a self-contained application asset directory."""
    from fontTools.ttLib import TTFont
    source = json_file(root / 'src/glyphs.json')
    meta = json_file(root / 'src/font.json')
    license_text = (root / 'OFL.txt').read_text(encoding='utf-8')
    destination.mkdir(parents=True, exist_ok=True)
    ttf = destination / (meta['postscript_name'] + '.ttf')
    woff2 = destination / (meta['postscript_name'] + '.woff2')
    compile_font(source, meta, license_text, ttf)
    validate_sfnt(ttf)
    with TTFont(ttf, recalcTimestamp=False) as font:
        for table in font.keys():
            if table != 'GlyphOrder':
                _ = font[table]
        require(font['name'].getDebugName(1) == meta['family'], 'Familienname stimmt nicht.')
        require(font['name'].getDebugName(5) == 'Version ' + meta['version'], 'Fontversion stimmt nicht.')
        require(font['name'].getDebugName(6) == meta['postscript_name'], 'PostScript-Name stimmt nicht.')
        require(font['name'].getDebugName(13) == license_text, 'Eingebettete Lizenz stimmt nicht.')
        require(font['OS/2'].fsType == 0, 'Einbettungskennzeichnung stimmt nicht.')
        require(font.getBestCmap() == {32: 'space', **{cp: name for name, cp in meta['codepoints'].items()}}, 'Zeichenzuordnung stimmt nicht.')
        require(len(font.getGlyphOrder()) == 14 and font['post'].isFixedPitch == 1, 'Glyphenanzahl/Laufweite stimmt nicht.')
        require(all(font['hmtx'][name][0] == meta['advance_width'] for name in font.getGlyphOrder()), 'Abweichende Laufweite.')
        before = signature(font)
        font.flavor = 'woff2'
        font.save(woff2)
    with TTFont(woff2, recalcTimestamp=False) as font:
        require(signature(font) == before, 'WOFF2 veraendert Konturen oder Metriken.')
        require(font['name'].getDebugName(13) == license_text, 'WOFF2-Lizenz stimmt nicht.')
    for source_path, name in [
        (root / 'OFL.txt', 'OFL.txt'),
        (root / 'licenses/Apache-2.0.txt', 'Apache-2.0.txt'),
        (root / 'integration/README.md', 'README.md'),
        (root / 'integration/plysmith-chess.css', 'plysmith-chess.css'),
        (root / 'integration/font-ready.ts', 'font-ready.ts'),
        (root / 'integration/beispiel.html', 'beispiel.html'),
    ]:
        shutil.copyfile(source_path, destination / name)
    files = {path.name: {'sha256': digest(path), 'bytes': path.stat().st_size} for path in (ttf, woff2)}
    manifest = {
        'family': meta['family'], 'style': meta['style'], 'version': meta['version'],
        'license': meta['license'], 'license_file': 'OFL.txt',
        'units_per_em': meta['units_per_em'], 'advance_width': meta['advance_width'],
        'ascent': meta['ascent'], 'descent': meta['descent'], 'line_gap': meta['line_gap'],
        'codepoints': {f'U+{code:04X}': name for name, code in meta['codepoints'].items()},
        'files': files,
    }
    write_text(destination / 'font.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    sums = ''.join(f'{digest(path)}  {path.name}\n' for path in sorted(destination.iterdir()) if path.is_file())
    write_text(destination / 'SHA256SUMS.txt', sums)
    return files


def check_inputs(root: Path, lock: dict) -> None:
    for relative, expected in lock['inputs'].items():
        path = root / relative
        require(path.is_file() and digest(path) == expected, f'Quelldatei fehlt oder ist veraendert: {relative}.')


def publish(stage: Path, target: Path) -> None:
    """Replace only the dedicated asset output, after a complete successful build."""
    backup = target.with_name('.dist-previous')
    if target.is_symlink() or backup.exists():
        raise RuntimeError('Ausgabeordner kann nicht sicher ersetzt werden. dist/.dist-previous pruefen.')
    moved = False
    try:
        if target.exists():
            require(target.is_dir(), 'dist ist kein Verzeichnis.')
            expected = {p.name for p in stage.iterdir()}
            require({p.name for p in target.iterdir()} <= expected, 'dist enthaelt fremde Dateien. Bitte einen leeren Ausgabeordner verwenden.')
            target.rename(backup)
            moved = True
        stage.rename(target)
    except Exception:
        if moved and not target.exists():
            backup.rename(target)
        raise
    if moved:
        shutil.rmtree(backup)


def release_archive(root: Path, directory: Path) -> Path:
    """Package only the generated application assets, with deterministic ZIP metadata."""
    version = json_file(root / 'src/font.json')['version']
    target = root / f'Plysmith-Chess-{version}.zip'
    with tempfile.NamedTemporaryFile(dir=root, suffix='.zip.part', delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(directory.iterdir()):
                require(path.is_file() and not path.is_symlink(), 'Ausgabe enthaelt unerwartete Verzeichnisse/Links.')
                info = zipfile.ZipInfo('Plysmith-Chess/' + path.name, date_time=(2026, 9, 21, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Nur bereits geladene Buildwerkzeuge verwenden.')
    parser.add_argument('--verify', action='store_true', help='Vorhandene dist-Dateien gegen ihre Pruefsummen pruefen.')
    args = parser.parse_args()
    try:
        lock = json_file(ROOT / 'build.lock.json')
        if args.verify:
            target = ROOT / 'dist'
            for line in (target / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
                expected, name = line.split('  ', 1)
                require(Path(name).name == name, 'Ungueltiger Dateiname in SHA256SUMS.txt.')
                require(digest(target / name) == expected, f'Pruefsumme falsch: {name}.')
            for name, expected in lock['outputs'].items():
                require(digest(target / name) == expected['sha256'], f'Font-Pruefsumme falsch: {name}.')
            print('Alle Ausgabedateien sind unveraendert.')
            return 0
        check_inputs(ROOT, lock)
        print(f'Plysmith Chess {json_file(ROOT / "src/font.json")["version"]}', flush=True)
        print(f'Python {sys.version.split()[0]} | {sys.executable}', flush=True)
        sys.path.insert(0, str(ROOT / 'tools'))
        from dependencies import activate
        activate(ROOT, offline=args.offline)
        cache = ROOT / '.build-cache'
        cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='build-', dir=cache) as temporary:
            stage = Path(temporary) / 'dist'
            actual = build_outputs(ROOT, stage)
            require(actual == lock['outputs'], 'Ausgabepruefsummen weichen ab. Keine Dateien uebernommen.')
            publish(stage, ROOT / 'dist')
        archive = release_archive(ROOT, ROOT / 'dist')
        print(f'Fertig: {archive.name}')
        print('Fontdateien ausserdem in dist/PlysmithChess-Regular.ttf und dist/PlysmithChess-Regular.woff2')
        print('Lizenz und Einbau: dist/README.md')
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, ImportError, EOFError) as error:
        print(f'Fehler: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
