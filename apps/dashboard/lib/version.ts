export function cmpVersion(a: string, b: string): number {
  const pa = (a || "0").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pb = (b || "0").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isOutdated(current: string | null | undefined, latest: string): boolean {
  if (!current) return false;
  return cmpVersion(current, latest) < 0;
}
