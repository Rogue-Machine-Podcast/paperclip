import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const processAdapter: ServerAdapterModule = {
  type: "process",
  runtimeToolDelivery: "environment",
  execute,
  testEnvironment,
  models: [],
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: `# process agent configuration

Adapter: process

Core fields:
- command (string, required): command to execute
- args (string[] | string, optional): command arguments
- cwd (string, optional): absolute working directory
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Final user-facing response (successful exit only):
- Print a single stdout line \`PAPERCLIP_FINAL {"text":"..."}\` as the last non-empty line when the process should supply durable run prose. Paperclip maps it to \`resultJson.finalResponse\` with \`disposition: "final"\`. Malformed markers are ignored; stdout and stderr are stored unchanged.
`,
};
