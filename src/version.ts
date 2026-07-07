/**
 * Single source of truth for the CLI/MCP version. Side-effect-free so the MCP
 * server can import it without pulling in `src/index.ts` (which self-executes
 * `main()` and fires a network update-check at module scope).
 */
export const VERSION = "0.1.23";
