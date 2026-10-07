import type { VercelRequest } from "./_types.js";

export async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 1024 * 1024) throw new Error("Request body too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
