/**
 * Redirect `console.log` → stderr. The MCP entry imports this FIRST (before any other
 * import runs) so that no reused CLI code path can write to stdout and corrupt the
 * JSON-RPC stream on the stdio transport. The transport writes protocol frames straight
 * to `process.stdout`, bypassing `console`, so this redirect is safe.
 */
console.log = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error(...args);
};
