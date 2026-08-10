/**
 * Local-development object store endpoint.
 *
 * THIS IS THE ONE ROUTE THAT MOVES PHOTO BYTES THROUGH NEXT.JS, and it exists
 * so the upload path can be built without a Cloudflare account. It refuses to
 * load in production — see the throw below — so the arrangement cannot survive
 * a deploy by accident. The egress-invariant test knows about this file by name
 * and checks the guard is still here.
 *
 * In production the equivalent URLs are presigned R2 URLs and this process is
 * not on the path at all.
 */

import { NextResponse } from 'next/server';

import { getStorage } from '@/storage';
import { LocalStorage } from '@/storage/local';

export const runtime = 'nodejs';

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'The dev blob route must never be reachable in production. Configure R2.',
  );
}

function localStore(): LocalStorage | null {
  const storage = getStorage();
  return storage instanceof LocalStorage ? storage : null;
}

function parse(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const verb = url.searchParams.get('verb');
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig');
  return { key, verb, exp, sig };
}

export async function PUT(request: Request) {
  const store = localStore();
  if (!store) return NextResponse.json({ error: 'not_local' }, { status: 404 });

  const { key, verb, exp, sig } = parse(request);
  if (!key || verb !== 'put' || !sig || !store.verify(key, 'put', exp, sig)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 403 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  await store.writeBytes(key, bytes);
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request) {
  const store = localStore();
  if (!store) return NextResponse.json({ error: 'not_local' }, { status: 404 });

  const { key, verb, exp, sig } = parse(request);
  if (!key || verb !== 'get' || !sig || !store.verify(key, 'get', exp, sig)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 403 });
  }

  const bytes = await store.readBytes(key);
  if (!bytes) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    },
  });
}
