const CHUNK = 192 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;

export function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)) as any);
  }
  return btoa(bin);
}

type Sender = { send: (m: any) => void };

/** Envia um arquivo em pedacos pelo hub. paste=true marca para colar via clipboard no cliente. */
export async function sendFileChunks(
  hub: Sender,
  agentId: string,
  file: File,
  opts: { paste?: boolean; onProgress?: (p: number) => void } = {}
) {
  const id = crypto.randomUUID();
  const total = Math.ceil(file.size / CHUNK) || 1;
  for (let seq = 0; seq < total; seq++) {
    const slice = file.slice(seq * CHUNK, (seq + 1) * CHUNK);
    const buf = await slice.arrayBuffer();
    hub.send({
      type: "file:chunk",
      agentId,
      id,
      name: file.name,
      seq,
      last: seq === total - 1,
      data: abToB64(buf),
      paste: !!opts.paste,
    });
    opts.onProgress?.(Math.round(((seq + 1) / total) * 100));
    await new Promise((r) => setTimeout(r, 8));
  }
}
