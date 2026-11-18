export interface SunburstNode {
  name: string;
  value?: number | undefined;
  color?: string | undefined;
  /** Optional fill override for patterns/gradients (e.g., "url(#patternId)") */
  fill?: string | undefined;
  children?: SunburstNode[] | undefined;
}
