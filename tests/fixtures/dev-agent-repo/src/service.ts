import { runApp } from "./app";
import { formatRepeatedB } from "./repeated-b";
import { unusedFlag } from "./shared";

export async function runService(input: string): Promise<string> {
  if (unusedFlag) {
    return formatRepeatedB(input);
  }

  return runApp(input);
}
