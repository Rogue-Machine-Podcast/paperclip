const MARKER_PREFIX = "PAPERCLIP_FINAL ";

export type ProcessAdapterMarkedFinalResponse = {
  disposition: "final";
  text: string;
};

function lastNonEmptyLine(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0) return line;
  }
  return null;
}

/** Opt-in stdout marker for durable user-facing run prose on successful exits. */
export function readStdoutMarkedFinalResponse(
  stdout: string,
): ProcessAdapterMarkedFinalResponse | undefined {
  const line = lastNonEmptyLine(stdout);
  if (!line?.startsWith(MARKER_PREFIX)) return undefined;

  const jsonText = line.slice(MARKER_PREFIX.length).trim();
  if (!jsonText) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  const text = (parsed as Record<string, unknown>).text;
  if (typeof text !== "string" || text.trim().length === 0) return undefined;

  return { disposition: "final", text };
}
