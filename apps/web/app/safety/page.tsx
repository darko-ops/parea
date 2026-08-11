/**
 * Published safety information and contact route.
 *
 * App Store Guideline 1.2 requires apps carrying user-generated content to
 * publish a way to reach the developer, alongside filtering, reporting and
 * blocking. This is that page, and it is also the honest place to say what the
 * product does with people's photos without burying it in a policy document.
 */

export const metadata = {
  title: 'Safety, reporting and contact',
};

const CONTACT = process.env.SAFETY_CONTACT_EMAIL ?? 'safety@example.com';

export default function SafetyPage() {
  return (
    <main className="wrap">
      <h1>Safety and reporting</h1>

      <section className="panel">
        <h2>Your photos</h2>
        <p className="muted">
          You can remove anything you uploaded, at any time, without asking
          anyone. Precise location data is stripped from every photo before it
          is shown to anyone else — the image itself is untouched, only the
          metadata saying where it was taken.
        </p>
      </section>

      <section className="panel">
        <h2>A photo of you that you did not upload</h2>
        <p className="muted">
          Ask for it to be taken down. You do not need an account, and you do
          not need to have uploaded anything. The request goes to whoever
          created the event. If they have not answered within 48 hours the
          photo is hidden automatically while they decide.
        </p>
      </section>

      <section className="panel">
        <h2>Something that should not be here</h2>
        <p className="muted">
          Report it. Reports come to us rather than to the event&rsquo;s host,
          because sometimes the host is the problem. You can also block someone,
          which hides everything they upload from your view and stops them
          joining events you created. Blocking is private — they are not told.
        </p>
      </section>

      <section className="panel">
        <h2>Contact</h2>
        <p className="muted">
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </section>

      <p className="muted footer">
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> ·{' '}
        <a href="/account">Your account</a>
      </p>
    </main>
  );
}
