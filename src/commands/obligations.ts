import { api } from "../api";
import { parseFlags } from "../flags";

export async function obligationsCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const projectId = positional[0] || flags.project || flags.p;
  const out = flags.out || flags.o;

  if (!projectId) {
    console.error("Usage: dillion obligations <project-id> [--out file.csv]");
    process.exit(1);
  }

  const res = await api(`/obligations/${projectId}`, { raw: true });
  const csv = await (res as Response).text();

  if (out) {
    await Bun.write(out, csv);
    const lines = csv.split("\n").length - 1;
    console.log(`Wrote ${lines} documents to ${out}`);
  } else {
    console.log(csv);
  }
}
