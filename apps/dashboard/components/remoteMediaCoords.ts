/** Converte clique do mouse em coordenadas normalizadas (0–1) sobre a midia exibida. */
export function remoteMediaCoords(
  e: React.MouseEvent,
  el: HTMLElement,
  mediaW: number,
  mediaH: number,
  fitMode: "contain" | "cover"
): { x: number; y: number } | null {
  const rect = el.getBoundingClientRect();
  const vw = mediaW || rect.width;
  const vh = mediaH || rect.height;
  const scale =
    fitMode === "cover"
      ? Math.max(rect.width / vw, rect.height / vh)
      : Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (rect.width - dispW) / 2;
  const offY = (rect.height - dispH) / 2;
  const x = (e.clientX - rect.left - offX) / dispW;
  const y = (e.clientY - rect.top - offY) / dispH;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export type RemoteMonitor = {
  index: number;
  name: string;
  width: number;
  height: number;
  primary: boolean;
};
