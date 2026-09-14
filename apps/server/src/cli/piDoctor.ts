import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { expandHomePath } from "../pathExpansion.ts";

export interface PiDoctorReport {
  readonly status: "ready" | "warning" | "error";
  readonly sdkVersion: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly isolatedState: true;
  readonly models: ReadonlyArray<{
    readonly provider: string;
    readonly id: string;
    readonly name: string;
  }>;
  readonly resources: {
    readonly skills: number;
    readonly prompts: number;
    readonly extensions: number;
    readonly commands: number;
  };
  readonly diagnostics: ReadonlyArray<string>;
  readonly live:
    | { readonly attempted: false }
    | {
        readonly attempted: true;
        readonly passed: boolean;
        readonly streamed: boolean;
        readonly error?: string;
      };
}

export function buildPiDoctorReport(input: Omit<PiDoctorReport, "status">): PiDoctorReport {
  const liveFailed = input.live.attempted && !input.live.passed;
  return {
    ...input,
    status: liveFailed
      ? "error"
      : input.models.length === 0 || input.diagnostics.length > 0
        ? "warning"
        : "ready",
  };
}

export function formatPiDoctorReport(report: PiDoctorReport): string {
  const lines = [
    "Waypoint Pi doctor",
    `  Status: ${report.status}`,
    `  SDK: ${report.sdkVersion}`,
    `  Workspace: ${report.cwd}`,
    `  Pi agent directory: ${report.agentDir}`,
    "  State: isolated temporary files",
    `  Models: ${report.models.length}`,
    `  Resources: ${report.resources.skills} skills, ${report.resources.prompts} prompts, ${report.resources.extensions} extensions, ${report.resources.commands} commands`,
  ];
  if (report.live.attempted) {
    lines.push(
      `  Live request: ${report.live.passed ? `passed${report.live.streamed ? " (streamed)" : ""}` : `failed (${report.live.error ?? "unknown error"})`}`,
    );
  } else {
    lines.push("  Live request: skipped (pass --prompt to run one)");
  }
  for (const diagnostic of report.diagnostics) lines.push(`  Diagnostic: ${diagnostic}`);
  return lines.join("\n");
}

export class PiDoctorError extends Schema.TaggedError<PiDoctorError>()("PiDoctorError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
const isPiDoctorError = Schema.is(PiDoctorError);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const runPiDoctor = Effect.fn("runPiDoctor")(function* (input: {
  readonly cwd: string;
  readonly agentDir: string;
  readonly prompt?: string;
}): Effect.fn.Return<
  PiDoctorReport,
  PiDoctorError | PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "waypoint-pi-doctor-" });
  const isolatedAgentDir = path.join(scratch, "agent");
  yield* fs.makeDirectory(isolatedAgentDir, { recursive: true });
  for (const name of ["auth.json", "models.json"] as const) {
    const source = path.join(input.agentDir, name);
    if (yield* fs.exists(source)) yield* fs.copyFile(source, path.join(isolatedAgentDir, name));
  }

  const inspect = async () => {
    const modelRuntime = await ModelRuntime.create({
      authPath: path.join(isolatedAgentDir, "auth.json"),
      modelsPath: path.join(isolatedAgentDir, "models.json"),
      modelsStorePath: path.join(scratch, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const services = await createAgentSessionServices({
      cwd: input.cwd,
      agentDir: input.agentDir,
      modelRuntime,
      resourceLoaderOptions: { noThemes: true, noContextFiles: true },
    });
    const models = await modelRuntime.getAvailable();
    const skills = services.resourceLoader.getSkills();
    const prompts = services.resourceLoader.getPrompts();
    const extensions = services.resourceLoader.getExtensions();
    const diagnostics = [
      ...services.diagnostics.map((item) => `${item.type}: ${item.message}`),
      ...skills.diagnostics.map((item) => `${item.type}: ${item.message}`),
      ...prompts.diagnostics.map((item) => `${item.type}: ${item.message}`),
      ...extensions.errors.map((item) => `error: ${item.path}: ${item.error}`),
      ...(modelRuntime.getError() ? [`error: ${modelRuntime.getError()}`] : []),
    ];
    let live: PiDoctorReport["live"] = { attempted: false };
    if (input.prompt !== undefined) {
      const model = models[0];
      if (!model) {
        live = {
          attempted: true,
          passed: false,
          streamed: false,
          error: "No authenticated model is available.",
        };
      } else {
        const { session } = await createAgentSessionFromServices({
          services,
          model,
          sessionManager: SessionManager.inMemory(input.cwd),
          noTools: "all",
        });
        let streamed = false;
        session.subscribe((event) => {
          if (event.type === "message_update") streamed = true;
        });
        try {
          await session.prompt(input.prompt);
          live = { attempted: true, passed: true, streamed };
        } catch (cause) {
          live = {
            attempted: true,
            passed: false,
            streamed,
            error: cause instanceof Error ? cause.message : String(cause),
          };
        } finally {
          session.dispose();
        }
      }
    }
    return buildPiDoctorReport({
      sdkVersion: VERSION,
      cwd: input.cwd,
      agentDir: input.agentDir,
      isolatedState: true,
      models: models.map(({ provider, id, name }) => ({ provider, id, name })),
      resources: {
        skills: skills.skills.length,
        prompts: prompts.prompts.length,
        extensions: extensions.extensions.length,
        commands: extensions.extensions.reduce(
          (total, extension) => total + extension.commands.size,
          0,
        ),
      },
      diagnostics,
      live,
    });
  };

  return yield* Effect.tryPromise({
    try: inspect,
    catch: (cause) =>
      new PiDoctorError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(
    Effect.timeout("2 minutes"),
    Effect.mapError((cause) =>
      isPiDoctorError(cause)
        ? cause
        : new PiDoctorError({ message: "Pi doctor timed out after 2 minutes.", cause }),
    ),
  );
});

const agentDirFlag = Flag.string("agent-dir").pipe(
  Flag.withDescription("Pi configuration directory (defaults to Pi's configured agent directory)."),
  Flag.optional,
);
const promptFlag = Flag.string("prompt").pipe(
  Flag.withDescription("Run one tool-disabled, in-memory live request with this prompt."),
  Flag.optional,
);
const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const piDoctorCommand = Command.make("pi", {
  cwd: Argument.string("cwd").pipe(Argument.optional),
  agentDir: agentDirFlag,
  prompt: promptFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Check Pi without using Waypoint's persistent state."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const report = yield* runPiDoctor({
        cwd: path.resolve(Option.getOrElse(flags.cwd, () => process.cwd())),
        agentDir: path.resolve(expandHomePath(Option.getOrElse(flags.agentDir, getAgentDir))),
        ...(Option.isSome(flags.prompt) ? { prompt: flags.prompt.value } : {}),
      });
      yield* Console.log(flags.json ? encodeJson(report) : formatPiDoctorReport(report));
    }),
  ),
);

export const doctorCommand = Command.make("doctor").pipe(
  Command.withDescription("Run isolated provider diagnostics."),
  Command.withSubcommands([piDoctorCommand]),
);
