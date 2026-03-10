import { runService } from "./service";
import { formatRepeatedA } from "./repeated-a";

export async function runApp(input: string): Promise<string> {
  const result = await runService(input);
  return formatRepeatedA(result);
}
