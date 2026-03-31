interface ParsedArgs {
  flags: Record<string, string>;
  /** Flags that appeared more than once, collected as arrays. */
  arrayFlags: Record<string, string[]>;
  positional: string[];
}

export function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const arrayFlags: Record<string, string[]> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }

    let key: string | undefined;
    let value: string | undefined;

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        value = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          value = next;
          i++;
        } else {
          value = "";
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        value = next;
        i++;
      } else {
        value = "";
      }
    } else {
      positional.push(arg);
    }

    if (key !== undefined && value !== undefined) {
      if (!arrayFlags[key]) {
        arrayFlags[key] = [];
      }
      arrayFlags[key].push(value);
      flags[key] = value;
    }
  }

  return { flags, arrayFlags, positional };
}
