/**
 * Vercel serverless function shared request/response types.
 * (Avoids depending on @vercel/node; matches its minimal shape.)
 */
export interface VercelRequest extends AsyncIterable<Uint8Array> {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: any;
}

export interface VercelResponse {
  status(code: number): { send(body: unknown): void; json(body: unknown): void };
}
