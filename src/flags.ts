interface ParsedArgs {
  flags: Record<string, string>;
  positional: string[];
}

export function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = "";
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[arg.slice(1)] = next;
        i++;
      } else {
        flags[arg.slice(1)] = "";
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}
