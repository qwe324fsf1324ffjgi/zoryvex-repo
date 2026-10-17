import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { CandidateNav } from '@/components/candidate/CandidateNav';

/**
 * Default title for this area. A page with its own layout overrides it;
 * this is what the index page of the group uses.
 */
export const metadata: Metadata = { title: 'Your account — Zoryvex' };

export default function CandidateAppLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard requiredRole="candidate" signInHref="/candidate/sign-in">
      <CandidateNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </RoleGuard>
  );
}
