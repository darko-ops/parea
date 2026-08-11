import { AccountView } from '@/../app/components/AccountView';

export const dynamic = 'force-dynamic';

/**
 * Belt and braces with the `X-Robots-Tag` header. Nothing here is private in
 * the way an event is, but a page that names someone's email address and
 * lists what they were at has no business in an index.
 */
export const metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountView />;
}
