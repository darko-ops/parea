import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Every photo from everyone who was there',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
