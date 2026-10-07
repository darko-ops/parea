import { Spinner } from '@/../app/components/Spinner';

/**
 * While this page is rendered on the server: the mark, after 400ms. See
 * `Spinner`. Not on a roll's own page, which shows its photographs with
 * nothing in front of them.
 */
export default function Loading() {
  return (
    <main className="page-loading">
      <Spinner />
    </main>
  );
}
