import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Preserve the scaffold's documented local .env configuration before preflight.
if (existsSync(".env")) loadEnvFile(".env");

// Scaffold 0.8.2 otherwise downloads Zotero and installs Linux GUI packages
// automatically in CI. Host validation must use an explicitly prepared host.
const zoteroBinary = process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH;
try {
  if (!zoteroBinary || !statSync(zoteroBinary).isFile()) {
    throw new Error(
      "Set ZOTERO_PLUGIN_ZOTERO_BIN_PATH to an existing executable",
    );
  }
  accessSync(zoteroBinary, constants.X_OK);
  if (process.platform === "linux" && !process.env.DISPLAY) {
    throw new Error("Linux host tests require an existing desktop DISPLAY");
  }
} catch (error) {
  console.error(`BLOCKED: ZOTERO HOST NOT CONFIGURED. ${error.message}`);
  console.error(
    "See docs/citebloom-host-validation-plan.md; no host was installed.",
  );
  process.exit(2);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["zotero-plugin", "test", "--no-watch", "--abort-on-fail"];
const webChatLive = process.argv.includes("--webchat-live");
const agentLive = process.argv.includes("--agent-live");

const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    CITEBLOOM_EXISTING_DESKTOP: "1",
    LLM_FOR_ZOTERO_WORKFLOW_TESTS: "1",
    ...(webChatLive ? { LLM_FOR_ZOTERO_WEBCHAT_LIVE: "1" } : {}),
    ...(agentLive ? { LLM_FOR_ZOTERO_AGENT_LIVE: "1" } : {}),
  },
});

// Wait for the child process and its inherited stdio streams to close before
// allowing this wrapper to finish. Exiting on the earlier "exit" event can
// tear down the scaffold's esbuild service pipe while it is still draining,
// which intermittently prints a post-test Go deadlock despite a successful run.
child.on("close", (code, signal) => {
  if (signal) {
    console.error(`Workflow tests terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
