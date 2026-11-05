import { readdir, readFile, mkdir, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, 'extension');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
if (pkg.version !== manifest.version || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Version mismatch.');
const members = [];
async function walk(path) {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const full = resolve(path, entry.name), info = await lstat(full);
    if (info.isSymbolicLink()) throw new Error('Archive members cannot be symlinks.');
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) members.push({ name: `tracelet/${relative(extension, full).replaceAll('\\', '/')}`, bytes: await readFile(full) });
    else throw new Error('Unsupported archive member.');
  }
}
await walk(extension);
if (members.length > 100 || members.reduce((sum, x) => sum + x.bytes.length, 0) > 2_000_000) throw new Error('Unexpected archive size.');
const table = Array.from({ length: 256 }, (_, index) => { let crc = index; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; return crc >>> 0; });
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; };
const locals = [], directory = [];
let offset = 0;
// Stored ZIP entries: deterministic bytes, UTF-8 names, fixed 2026-11-05 date.
const date = ((2026 - 1980) << 9) | (11 << 5) | 5;
for (const member of members) {
  const name = Buffer.from(member.name), crc = crc32(member.bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(member.bytes.length, 18); local.writeUInt32LE(member.bytes.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
  central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(member.bytes.length, 20); central.writeUInt32LE(member.bytes.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  locals.push(local, name, member.bytes); directory.push(central, name); offset += local.length + name.length + member.bytes.length;
}
const centralBytes = Buffer.concat(directory), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...locals, centralBytes, end]);
const output = resolve(root, 'site/downloads');
for (const directory of [resolve(root, 'site'), output]) {
  try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Archive output must be an owned directory, not a symlink.');
}
async function writeOutput(path, bytes) {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Archive output must be an ordinary unlinked file.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { await file.writeFile(bytes); } finally { await file.close(); }
}
const filename = `tracelet-${pkg.version}.zip`;
await writeOutput(resolve(output, filename), archive);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await writeOutput(resolve(output, 'integrity.json'), JSON.stringify({ version: pkg.version, filename, bytes: archive.length, sha256: sha(archive),
  members: members.map(x => ({ path: x.name, bytes: x.bytes.length, sha256: sha(x.bytes) })) }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ filename, bytes: archive.length, sha256: sha(archive), files: members.length }) + '\n');
