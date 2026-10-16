import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveHeartbeatRunResponse } from "../../services/heartbeat-run-summary.js";
import { execute } from "./execute.js";

const agent = {
  id: randomUUID(),
  companyId: randomUUID(),
  name: "Process adapter test agent",
  role: "engineer",
  adapterType: "process",
  adapterConfig: {},
};

function runProcess(script: string) {
  return execute({
    runId: randomUUID(),
    agent,
    config: { command: process.execPath, args: ["-e", script], cwd: process.cwd() },
    context: {},
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    onLog: async () => {},
  });
}

describe("process adapter execute", () => {
  it("maps a trailing PAPERCLIP_FINAL marker to resultJson.finalResponse on success", async () => {
    const result = await runProcess(`
      console.log("work log");
      console.log("PAPERCLIP_FINAL " + JSON.stringify({ text: "Shipped fix" }));
    `);

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.resultJson?.finalResponse).toEqual({
      disposition: "final",
      text: "Shipped fix",
    });
    expect(result.resultJson?.stdout).toContain("work log");
    expect(result.resultJson?.stdout).toContain("PAPERCLIP_FINAL");

    const resolved = resolveHeartbeatRunResponse({
      resultJson: result.resultJson ?? {},
      finalAgentMessage: {
        text: "compatible terminal response",
        sourceEventId: null,
        channel: "unknown",
      },
    });
    expect(resolved.text).toBe("Shipped fix");
    expect(resolved.decision.chosenSource).toBe("adapter_final_response");
  });

  it("accepts the marker when only blank lines follow it", async () => {
    const result = await runProcess(`
      console.log("PAPERCLIP_FINAL " + JSON.stringify({ text: "After blanks" }));
      console.log("");
      console.log("");
    `);

    expect(result.resultJson?.finalResponse).toEqual({
      disposition: "final",
      text: "After blanks",
    });
  });

  it("ignores the marker when a later non-empty stdout line follows", async () => {
    const result = await runProcess(`
      console.log("PAPERCLIP_FINAL " + JSON.stringify({ text: "ignored" }));
      console.log("still running");
    `);

    expect(result.resultJson?.finalResponse).toBeUndefined();
  });

  it("ignores malformed markers and empty text", async () => {
    for (const script of [
      `console.log("PAPERCLIP_FINAL {not-json}");`,
      `console.log("PAPERCLIP_FINAL " + JSON.stringify("array"));`,
      `console.log('PAPERCLIP_FINAL {"text":""}');`,
      `console.log('PAPERCLIP_FINAL {"text":"   "}');`,
      `console.log("PAPERCLIP_FINAL");`,
    ]) {
      const result = await runProcess(script);
      expect(result.exitCode).toBe(0);
      expect(result.resultJson?.finalResponse).toBeUndefined();
    }
  });

  it("does not set finalResponse when the process exits non-zero", async () => {
    const result = await runProcess(`
      console.log("PAPERCLIP_FINAL " + JSON.stringify({ text: "should not publish" }));
      process.exit(1);
    `);

    expect(result.exitCode).toBe(1);
    expect(result.resultJson?.finalResponse).toBeUndefined();
    expect(result.resultJson?.stdout).toContain("PAPERCLIP_FINAL");
  });
});
