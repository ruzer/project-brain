export function formatRepeatedB(input: string): string {
  const value = input.trim();
  const normalized = value.toLowerCase();
  const pieces = normalized.split(":");
  return pieces.join("-");
}
