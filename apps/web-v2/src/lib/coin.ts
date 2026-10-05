import { hash32 } from "./utils";

/** Stable hue (0-359) per mint. Lightness and chroma come from --coin-l and --coin-c. */
export function coinHue(mint: string): number {
  return hash32(mint) % 360;
}
export function coinColor(mint: string): string {
  return `oklch(var(--coin-l) var(--coin-c) ${coinHue(mint)})`;
}
