'use client';

/**
 * The front page for somebody signed out: the sign-in card and nothing else.
 *
 * Everything on parea.photos needs an account now (see `@/gate`), so the root
 * layout draws this in place of whatever page was asked for at `/`. After
 * signing in it reloads, so the layout draws the page for the account — or
 * goes to `next`, the page somebody was on their way to.
 */

import { useCallback } from 'react';

import { sameOriginPath } from '@/redirect';

import { LoginScreen } from './LoginScreen';
import { SignIn } from './SignIn';

export function SignInPage() {
  const signedIn = useCallback(() => {
    const next = sameOriginPath(
      new URLSearchParams(globalThis.location.search).get('next'),
      globalThis.location.origin,
    );
    globalThis.location.href = next ?? '/';
  }, []);
  return (
    <LoginScreen>
      <SignIn
        title="Welcome to Parea"
        why="Every photo from everyone who was there — sign in or make an account to see your rolls."
        onSignedIn={signedIn}
      />
    </LoginScreen>
  );
}
