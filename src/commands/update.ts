export async function updateCommand() {
  console.log("Updating dillion...");

  const proc = Bun.spawn(["bash", "-c", 'curl -fsSL https://raw.githubusercontent.com/dutchess-kuiper/dillion-cli/main/install.sh | bash'], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const code = await proc.exited;
  process.exit(code);
}
