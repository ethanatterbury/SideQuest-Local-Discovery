import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url).pathname;
const modules = new Map();
/** Build-time tooling shares the application normalizer instead of duplicating it. */
export function loadProvider(file) {
  file = path.resolve(root, file);
  if (modules.has(file)) return modules.get(file);
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const loadedModule = { exports: {} };
  modules.set(file, loadedModule.exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) => {
      if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
      let target = name.startsWith("@/")
        ? path.resolve(root, "src", name.slice(2))
        : path.resolve(path.dirname(file), name);
      if (!path.extname(target)) target += ".ts";
      return loadProvider(target);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
