import { doctorRepository } from "./doctor.mjs";
import { initRepository } from "./init.mjs";
import { syncRepository } from "./sync.mjs";

export const VERSION = "0.3.1";

const HELP = `Project Brain Lite ${VERSION}

Uso:
  brain init [ruta]       crea el contexto mínimo sin sobrescribirlo
  brain sync [ruta]       refresca únicamente hechos verificables
  brain doctor [ruta]     valida tamaño, enlaces, duplicados y datos sensibles

Opciones:
  --json                  salida estructurada
  -h, --help              muestra esta ayuda
  -v, --version           muestra la versión`;

function parse(args) {
  const unknownOption = args.find((value) => value.startsWith("-") && value !== "--json");
  if (unknownOption) throw new Error(`Opción desconocida: ${unknownOption}. Usa brain --help.`);
  const json = args.includes("--json");
  const values = args.filter((value) => value !== "--json");
  if (values.length > 2) throw new Error("Se esperaba como máximo un comando y una ruta.");
  return { command: values[0], target: values[1] ?? ".", json };
}

function printResult(io, json, value, human) {
  io.log(json ? JSON.stringify(value, null, 2) : human);
}

export async function runCli(args = process.argv.slice(2), io = console) {
  const wantsJson = args.includes("--json");
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    io.log(HELP);
    return 0;
  }
  if (args.includes("-v") || args.includes("--version")) {
    io.log(VERSION);
    return 0;
  }

  try {
    const { command, target, json } = parse(args);
    if (command === "init") {
      const result = await initRepository(target);
      printResult(io, json, result, `Contexto listo: ${result.created.length} creados, ${result.preserved.length} preservados.`);
      return 0;
    }
    if (command === "sync") {
      const result = await syncRepository(target);
      printResult(io, json, result, result.changed ? "Hechos verificables actualizados." : "El contexto ya estaba actualizado.");
      return 0;
    }
    if (command === "doctor") {
      const result = await doctorRepository(target);
      if (json) io.log(JSON.stringify(result, null, 2));
      else {
        for (const issue of result.errors) io.error(`ERROR ${issue.code}: ${issue.message}`);
        for (const issue of result.warnings) io.warn(`AVISO ${issue.code}: ${issue.message}`);
        io.log(result.ok ? `Contexto sano (${result.checks.length} comprobaciones).` : `Contexto inválido (${result.errors.length} errores).`);
      }
      return result.ok ? 0 : 1;
    }
    throw new Error(`Comando desconocido: ${command ?? ""}. Usa brain --help.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson) {
      io.log(JSON.stringify({ ok: false, error: { code: "COMMAND_FAILED", message } }, null, 2));
    } else {
      io.error(message);
    }
    return 1;
  }
}
