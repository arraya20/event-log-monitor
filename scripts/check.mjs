import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.m?js$/.test(path))
      execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  }
}
for (const dir of ["src", "public", "functions", "test", "scripts"]) walk(dir);
console.log("Syntax checks passed");
