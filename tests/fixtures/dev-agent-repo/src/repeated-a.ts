export function formatRepeatedA(input: string): string {
  const value = input.trim();
  const normalized = value.toLowerCase();
  const pieces = normalized.split(":");
  return pieces.join("-");
}
