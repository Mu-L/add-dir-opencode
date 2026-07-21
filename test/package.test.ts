import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { pathToFileURL } from "url"

import { beforeAll, describe, expect, test } from "bun:test"

const ROOT = join(import.meta.dir, "..")
const DIST = join(ROOT, "dist")

interface Command {
  value: string
}

type CommandFactory = () => Command[]

interface TuiApi {
  command: {
    register: (factory: CommandFactory) => void
  }
}

interface TuiModule {
  default: {
    id: string
    tui: (api: TuiApi) => Promise<void>
  }
}

interface CommandResult {
  stdout: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseTuiExport(content: string): string {
  const manifest: unknown = JSON.parse(content)
  if (!isRecord(manifest) || !isRecord(manifest.exports)) {
    throw new Error("package manifest has no exports")
  }

  const tui = manifest.exports["./tui"]
  if (!isRecord(tui) || typeof tui.import !== "string") {
    throw new Error("package manifest has no TUI import")
  }
  return tui.import
}

function parsePackFiles(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.match(/^packed \S+ (.+)$/)?.[1])
    .filter((file): file is string => Boolean(file))
}

function isTuiModule(value: unknown): value is TuiModule {
  if (!isRecord(value) || !isRecord(value.default)) return false
  return typeof value.default.id === "string" && typeof value.default.tui === "function"
}

async function runCommand(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    cwd: ROOT,
    stderr: "pipe",
    stdout: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const [exitCode, output, errorOutput] = await Promise.all([child.exited, stdout, stderr])

  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed (${exitCode}): ${errorOutput}`)
  }
  return { stdout: output }
}

beforeAll(async () => {
  await runCommand(["bun", "run", "build"])
})

describe("publishable package", () => {
  test("exports a compiled TUI entry", () => {
    const manifest = readFileSync(join(ROOT, "package.json"), "utf-8")
    const tuiExport = parseTuiExport(manifest)

    expect(tuiExport).toBe("./dist/tui.js")
    expect(existsSync(join(ROOT, tuiExport))).toBe(true)
    expect(existsSync(join(DIST, "tui.tsx"))).toBe(false)

    const tui = readFileSync(join(DIST, "tui.js"), "utf-8")
    expect(tui).not.toContain("react/jsx")
    expect(tui).not.toContain("jsx-dev-runtime")
  })

  test("includes both runtime entries without source files", async () => {
    const result = await runCommand(["bun", "pm", "pack", "--dry-run", "--ignore-scripts"])
    const files = parsePackFiles(result.stdout)

    expect(files).toContain("dist/index.js")
    expect(files).toContain("dist/tui.js")
    expect(files.some((file) => file.endsWith(".tsx"))).toBe(false)
    expect(files.some((file) => file.startsWith("src/"))).toBe(false)
    expect(files.some((file) => file.startsWith("scripts/"))).toBe(false)
  })

  test("loads the TUI module and registers every command", async () => {
    const moduleUrl = `${pathToFileURL(join(DIST, "tui.js")).href}?test=${Date.now()}`
    const loaded: unknown = await import(moduleUrl)
    if (!isTuiModule(loaded)) throw new Error("built TUI module has an invalid export")

    let commandFactory: CommandFactory | undefined
    await loaded.default.tui({
      command: {
        register(factory): void {
          commandFactory = factory
        },
      },
    })

    expect(loaded.default.id).toBe("opencode-add-dir")
    expect(commandFactory?.().map((command) => command.value)).toEqual([
      "add-dir",
      "list-dir",
      "remove-dir",
    ])
  })
})
