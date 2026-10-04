import type { APIRoute } from 'astro'
import { repoFile } from '@/lib/sources'

export const GET: APIRoute = () => new Response(repoFile('sdk/llms.txt'))
