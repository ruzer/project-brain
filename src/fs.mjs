import { isUtf8 } from "node:buffer";
import { chmod, link, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function resolveRoot(input = ".", { create = false } = {}) {
  const absolute = path.resolve(input);
  if (create) await mkdir(absolute, { recursive: true });
  const resolved = await realpath(absolute);
  const info = await lstat(resolved);
  if (!info.isDirectory()) throw new Error(`No es un directorio: ${absolute}`);
  return resolved;
}

export function insideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function managedPath(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (!insideRoot(root, target)) throw new Error(`Ruta fuera del repositorio: ${relativePath}`);
  return target;
}

export async function ensureManagedDirectory(root, relativePath, { create = false } = {}) {
  const directory = managedPath(root, relativePath);
  if (create && !(await pathExists(directory))) await mkdir(directory);
  const info = await lstat(directory);
  if (info.isSymbolicLink()) throw new Error(`No se permiten directorios simbólicos administrados: ${directory}`);
  if (!info.isDirectory()) throw new Error(`No es un directorio: ${directory}`);
  const resolved = await realpath(directory);
  if (!insideRoot(root, resolved)) throw new Error(`El directorio administrado sale del repositorio: ${relativePath}`);
  return directory;
}

export async function ensureRegularFile(filePath) {
  const info = await lstat(filePath);
  if (info.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos administrados: ${filePath}`);
  if (!info.isFile()) throw new Error(`No es un archivo regular: ${filePath}`);
  return info;
}

export async function readText(filePath) {
  await ensureRegularFile(filePath);
  const content = await readFile(filePath);
  if (!isUtf8(content)) {
    const error = new Error(`El archivo no contiene UTF-8 válido: ${filePath}`);
    error.code = "INVALID_UTF8";
    throw error;
  }
  return content.toString("utf8");
}

export async function writeNewFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await link(temporary, filePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function managedParentIdentity(root, filePath) {
  const parent = path.dirname(filePath);
  const info = await lstat(parent);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Directorio padre administrado inválido: ${parent}`);
  }
  const resolved = await realpath(parent);
  if (!insideRoot(root, resolved)) throw new Error(`El directorio padre sale del repositorio: ${parent}`);
  return { dev: info.dev, ino: info.ino };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function writeFileAtomic(root, filePath, content) {
  const parentIdentity = await managedParentIdentity(root, filePath);
  let mode = 0o644;
  if (await pathExists(filePath)) mode = (await ensureRegularFile(filePath)).mode & 0o7777;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode });
    if (process.platform !== "win32") await chmod(temporary, mode);
    const afterWriteIdentity = await managedParentIdentity(root, filePath);
    if (!sameIdentity(parentIdentity, afterWriteIdentity)) {
      throw new Error("El directorio administrado cambió durante la escritura.");
    }
    await ensureRegularFile(filePath);
    await rename(temporary, filePath);
  } catch (error) {
    const currentIdentity = await managedParentIdentity(root, filePath).catch(() => null);
    if (currentIdentity && sameIdentity(parentIdentity, currentIdentity)) {
      await unlink(temporary).catch(() => {});
    }
    throw error;
  }
}
