import { mkdirSync, renameSync, existsSync, rmSync } from "fs"
import { join, basename } from "path"
import solidPlugin from "@opentui/solid/bun-plugin"

const outdir = join(import.meta.dir, "..", "dist")
mkdirSync(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "src", "tui-plugin.tsx")],
  outdir,
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/tui",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ],
})

if (!result.success) {
  console.error("TUI build failed:")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const emitted = result.outputs.map((o) => o.path)
const target = join(outdir, "tui.js")
const preferred =
  emitted.find((p) => basename(p) === "tui.js") ??
  emitted.find((p) => p.endsWith(".js"))

if (!preferred) {
  console.error("TUI build produced no JS output:", emitted)
  process.exit(1)
}

if (preferred !== target) {
  if (existsSync(target)) rmSync(target)
  renameSync(preferred, target)
}

console.log("Built", target)
