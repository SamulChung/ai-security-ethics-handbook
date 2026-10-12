import { env } from 'cloudflare:workers';
import { listMaterials, uploadMaterial } from '@/lib/materials.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return listMaterials(request, env); }
export async function POST(request: Request) { return uploadMaterial(request, env); }
