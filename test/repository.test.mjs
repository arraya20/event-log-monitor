import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("Git ignores local secrets, state, backups, and generated output", () => {
  const paths = [
    ".env.service",
    ".env.local",
    ".env.service.bak",
    ".dev.vars.production",
    "secrets/token.txt",
    "credentials.production.json",
    "cert.key",
    "cert.pem",
    "data/state.json",
    "artifacts/run.json",
    "node_modules/pkg/index.js",
    ".wrangler/state/file",
    "coverage/index.html",
    "state.sqlite-wal",
    "config.yml.bak",
  ];
  const ignored = execFileSync(
    "git",
    ["check-ignore", "--no-index", "--stdin"],
    { input: paths.join("\n") + "\n", encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.deepEqual(ignored, paths);
});
test("Source, tests, package lock, CI and deployment configuration remain tracked", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split("\n");
  for (const path of [
    "src/monitor.mjs",
    "test/core.test.mjs",
    "package-lock.json",
    ".github/workflows/ci.yml",
    "wrangler.toml",
    "functions/api/[[path]].js",
  ])
    assert.ok(tracked.includes(path), path);
  assert.equal(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--ignored", "--exclude-standard"],
      { encoding: "utf8" },
    ).trim(),
    "",
  );
});
test("Pages static headers use indented route-block syntax", () => {
  const lines = readFileSync(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  )
    .trimEnd()
    .split("\n");
  assert.equal(lines.shift(), "/*");
  for (const line of lines) assert.match(line, /^ {2}[A-Za-z-]+: .+$/);
  assert.ok(
    lines.some((line) => line.startsWith("  Content-Security-Policy:")),
  );
  assert.ok(lines.some((line) => line === "  X-Content-Type-Options: nosniff"));
});
