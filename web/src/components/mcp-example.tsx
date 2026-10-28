import { CmdBlock } from "@/components/doc";
import examples from "@/data/examples.json";

export function McpExample({ example }: { example: keyof typeof examples }) {
  const { name, arguments: args } = examples[example];
  return <CmdBlock title={`${name} · MCP input`} command={JSON.stringify(args, null, 2)} copyLabel={`Copy ${name} input`} />;
}
