import { isUtf8 } from "node:buffer";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, unlink, writeFile } from "node:fs/promises";
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

function filesystemIdentity(info, type) {
  return { dev: info.dev, ino: info.ino, type };
}

export function sameFilesystemIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.type === right.type;
}

export async function readTextSnapshot(filePath) {
  const beforeInfo = await ensureRegularFile(filePath);
  const beforeIdentity = filesystemIdentity(beforeInfo, "file");
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error(`No se permiten enlaces simbólicos administrados: ${filePath}`);
    }
    throw error;
  }
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile()) throw new Error(`No es un archivo regular: ${filePath}`);
    const openedIdentity = filesystemIdentity(openedInfo, "file");
    const openedPathIdentity = filesystemIdentity(await ensureRegularFile(filePath), "file");
    if (
      !sameFilesystemIdentity(beforeIdentity, openedIdentity) ||
      !sameFilesystemIdentity(openedIdentity, openedPathIdentity)
    ) {
      throw new Error(`${path.basename(filePath)} cambió de identidad durante la lectura; vuelve a intentarlo.`);
    }
    const content = await handle.readFile();
    const afterHandleInfo = await handle.stat();
    const fileIdentity = filesystemIdentity(afterHandleInfo, "file");
    const afterPathIdentity = filesystemIdentity(await ensureRegularFile(filePath), "file");
    if (
      !sameFilesystemIdentity(openedIdentity, fileIdentity) ||
      !sameFilesystemIdentity(fileIdentity, afterPathIdentity)
    ) {
      throw new Error(`${path.basename(filePath)} cambió de identidad durante la lectura; vuelve a intentarlo.`);
    }
    if (!isUtf8(content)) {
      const error = new Error(`El archivo no contiene UTF-8 válido: ${filePath}`);
      error.code = "INVALID_UTF8";
      throw error;
    }
    return { bytes: content, text: content.toString("utf8"), fileIdentity, mode: afterHandleInfo.mode & 0o7777 };
  } finally {
    await handle.close();
  }
}

export async function readText(filePath) {
  return (await readTextSnapshot(filePath)).text;
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
  return filesystemIdentity(info, "directory");
}

async function managedRootIdentity(root) {
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Raíz administrada inválida: ${root}`);
  }
  const resolved = await realpath(root);
  if (!insideRoot(root, resolved)) throw new Error(`La raíz administrada cambió: ${root}`);
  return filesystemIdentity(info, "directory");
}

export async function readManagedTextSnapshot(root, filePath) {
  const beforeParentIdentity = await managedParentIdentity(root, filePath);
  const snapshot = await readTextSnapshot(filePath);
  const parentIdentity = await managedParentIdentity(root, filePath);
  if (!sameFilesystemIdentity(beforeParentIdentity, parentIdentity)) {
    throw new Error("El directorio administrado cambió durante la lectura; vuelve a intentarlo.");
  }
  return { ...snapshot, parentIdentity };
}

async function assertExpectedDestination(root, filePath, {
  expectedBytes,
  expectedFileIdentity,
  expectedParentIdentity
}) {
  const current = await readManagedTextSnapshot(root, filePath);
  if (expectedParentIdentity && !sameFilesystemIdentity(current.parentIdentity, expectedParentIdentity)) {
    throw new Error("El directorio administrado cambió durante la sincronización; vuelve a intentarlo.");
  }
  if (expectedFileIdentity && !sameFilesystemIdentity(current.fileIdentity, expectedFileIdentity)) {
    throw new Error("CONTEXT.md cambió de identidad durante la sincronización; vuelve a intentarlo.");
  }
  if (expectedBytes !== undefined && !current.bytes.equals(expectedBytes)) {
    throw new Error("CONTEXT.md cambió durante la sincronización; vuelve a intentarlo.");
  }
  return current;
}

async function assertExpectedTemporary(filePath, expectedIdentity, expectedBytes) {
  const current = await readTextSnapshot(filePath);
  if (!sameFilesystemIdentity(current.fileIdentity, expectedIdentity) || !current.bytes.equals(expectedBytes)) {
    throw new Error("El archivo temporal cambió durante la sincronización; vuelve a intentarlo.");
  }
}

async function unlinkExpectedTemporary(filePath, expectedIdentity) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info || !info.isFile()) return;
  const current = filesystemIdentity(info, "file");
  if (sameFilesystemIdentity(current, expectedIdentity)) await unlink(filePath);
}

export async function writeFileAtomic(root, filePath, content, {
  expectedBytes,
  expectedFileIdentity,
  expectedParentIdentity,
  afterTemporaryWrite
} = {}) {
  const initial = await assertExpectedDestination(root, filePath, {
    expectedBytes,
    expectedFileIdentity,
    expectedParentIdentity
  });
  const guardedState = {
    expectedBytes: expectedBytes ?? initial.bytes,
    expectedFileIdentity: expectedFileIdentity ?? initial.fileIdentity,
    expectedParentIdentity: expectedParentIdentity ?? initial.parentIdentity
  };
  const rootIdentity = await managedRootIdentity(root);
  const stagingInRoot = rootIdentity.dev === initial.parentIdentity.dev;
  const stagingDirectory = stagingInRoot ? root : path.dirname(filePath);
  const stagingIdentity = stagingInRoot ? rootIdentity : initial.parentIdentity;
  const mode = initial.mode;
  const temporaryBytes = Buffer.from(content, "utf8");
  const temporary = path.join(
    stagingDirectory,
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  );
  let temporaryHandle;
  let temporaryIdentity;
  try {
    temporaryHandle = await open(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      mode
    );
    temporaryIdentity = filesystemIdentity(await temporaryHandle.stat(), "file");
    await temporaryHandle.writeFile(content, { encoding: "utf8" });
    if (process.platform !== "win32") await temporaryHandle.chmod(mode);
    await temporaryHandle.close();
    temporaryHandle = undefined;
    if (afterTemporaryWrite) await afterTemporaryWrite();
    const currentStagingIdentity = stagingInRoot
      ? await managedRootIdentity(root)
      : await managedParentIdentity(root, filePath);
    if (!sameFilesystemIdentity(stagingIdentity, currentStagingIdentity)) {
      throw new Error("El directorio de staging cambió durante la sincronización; vuelve a intentarlo.");
    }
    await assertExpectedTemporary(temporary, temporaryIdentity, temporaryBytes);
    await assertExpectedDestination(root, filePath, guardedState);
    await rename(temporary, filePath);
  } catch (error) {
    await temporaryHandle?.close().catch(() => {});
    const currentStagingIdentity = await (
      stagingInRoot ? managedRootIdentity(root) : managedParentIdentity(root, filePath)
    ).catch(() => null);
    if (
      temporaryIdentity &&
      currentStagingIdentity &&
      sameFilesystemIdentity(stagingIdentity, currentStagingIdentity)
    ) {
      await unlinkExpectedTemporary(temporary, temporaryIdentity).catch(() => {});
    }
    throw error;
  }
}
