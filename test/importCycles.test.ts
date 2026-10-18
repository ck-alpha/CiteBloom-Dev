import { assert } from "chai";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("import cycles", function () {
  it("does not introduce cycles outside the current allowlist", async function () {
    // This scans/parses every source file twice. It exceeded Mocha's default
    // 2s on Actions run 39092227825 even though the standalone check passed.
    // Isolate synchronous parsing so a deadline can actually stop the work;
    // leave the rest of the unit suite's timeout unchanged.
    this.timeout(20000);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/check-import-cycles.cjs", import.meta.url),
        ),
      ],
      {
        cwd: process.cwd(),
        timeout: 15000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      },
    );
    // The unchanged CLI exits nonzero for all four original conditions:
    // unexpected/stale-allowlisted cycles in both runtime and static graphs.
    assert.include(stdout, "Import-cycle check passed");
  });
});
