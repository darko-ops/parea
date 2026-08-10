/**
 * Android App Links — the same job as the AASA file next door.
 *
 * Android verifies the intent filter's `autoVerify` by fetching this and
 * matching the *signing certificate* of the installed app, not just the
 * package name. That is the part that catches people out: the fingerprint has
 * to be the one the released artifact is signed with, which for EAS is the
 * upload key Google manages rather than anything on a developer's machine.
 * `eas credentials` prints it.
 *
 * Verification also only happens at install time. A fingerprint fixed after
 * release does not repair already-installed apps until they are reinstalled,
 * which is why this is worth getting right before the first release rather
 * than after the first bug report.
 */

import { NextResponse } from 'next/server';

import { ANDROID_PACKAGE, androidFingerprints } from '@/deeplinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const fingerprints = androidFingerprints();
  if (fingerprints.length === 0) {
    return new NextResponse('not configured', { status: 404 });
  }

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=3600',
      },
    },
  );
}
