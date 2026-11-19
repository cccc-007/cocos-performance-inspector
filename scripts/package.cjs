'use strict';

// Dependency-free ZIP (stored entries, UTF-8 filenames). Build first via npm run package.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const name = 'cocos-performance-inspector';
const release = path.join(root, 'release');
const output = path.join(release, name);
const archive = path.join(release, `${name}.zip`);
const includes = ['README.md', 'LICENSE', 'dist', 'static', 'docs', 'examples'];

if (!fs.existsSync(path.join(root, 'dist', 'src', 'main.js'))) {
    throw new Error('Missing dist/src/main.js. Run npm run build first.');
}
for (const relative of ['static/panel.html', 'static/panel.css', 'dist/src/panels/default/index.js',
    'dist/runtime/auto-preview.js', 'dist/src/editor/preview.js']) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing ${relative}.`);
}

const entries = [];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete manifest.scripts;
delete manifest.devDependencies;
entries.push({ relative: 'package.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
function collect(relative) {
    const absolute = path.join(root, relative);
    const info = fs.lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink in package: ${relative}`);
    if (info.isDirectory()) {
        for (const child of fs.readdirSync(absolute).sort()) collect(path.join(relative, child));
    } else if (info.isFile()) {
        entries.push({ relative: relative.split(path.sep).join('/'), data: fs.readFileSync(absolute) });
    }
}
for (const relative of includes) {
    if (fs.existsSync(path.join(root, relative))) collect(relative);
}

const table = new Uint32Array(256);
for (let i = 0; i < table.length; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[i] = crc >>> 0;
}
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

const local = [], central = [];
let offset = 0;
// Fixed DOS timestamp makes identical input files produce identical ZIP output.
const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
for (const entry of entries) {
    const filename = Buffer.from(`${name}/${entry.relative}`, 'utf8');
    const size = entry.data.length;
    if (size > 0xffffffff || filename.length > 0xffff) throw new Error('ZIP32 file limit exceeded.');
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, entry.data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(dosDate, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(size, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + size;
}
const centralBytes = Buffer.concat(central);
if (entries.length > 0xffff || offset + centralBytes.length > 0xffffffff) {
    throw new Error('ZIP32 archive limit exceeded.');
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBytes.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, centralBytes, end]);

// Only replace this script's own generated output inside its fixed release directory.
if (path.dirname(path.resolve(output)) !== path.resolve(release) || path.basename(output) !== name) {
    throw new Error('Unsafe release output path.');
}
if (fs.existsSync(release) && fs.lstatSync(release).isSymbolicLink()) throw new Error('Release directory cannot be a symlink.');
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('Output directory cannot be a symlink.');
fs.mkdirSync(release, { recursive: true });
if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });
fs.mkdirSync(output);
for (const entry of entries) {
    const target = path.join(output, entry.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
}
fs.writeFileSync(archive, zip);
console.log(`Packaged ${entries.length} files (${zip.length} bytes)`);
console.log(output);
console.log(archive);
