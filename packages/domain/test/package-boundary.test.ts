import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

test("domain production imports stay within domain or explicit pure dependencies", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const allowed = new Set(["decimal.js", "zod"]);
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) { inspect(path); continue; }
      if (!path.endsWith(".ts")) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")
            ? node.arguments[0] : undefined;
        if (specifier) {
          assert.ok(ts.isStringLiteral(specifier), `Nonliteral dependency in ${path}`);
          const name = specifier.text;
          if (name.startsWith(".")) {
            const target = relative(root, resolve(dirname(path), name));
            assert.ok(!target.startsWith("..") && !isAbsolute(target), `Escaping import: ${name}`);
          }
          else assert.ok(allowed.has(name), `Non-domain dependency: ${name}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspect(root);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    assert.ok(allowed.has(name), `Non-domain package dependency: ${name}`);
  }
});
