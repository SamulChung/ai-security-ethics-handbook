import { env } from 'cloudflare:workers';
import { downloadMaterial } from '@/lib/materials.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return downloadMaterial(request, env, id);
}
