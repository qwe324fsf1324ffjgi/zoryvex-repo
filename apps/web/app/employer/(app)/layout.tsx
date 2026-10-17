import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { EmployerNav } from '@/components/employer/EmployerNav';

/**
 * Default title for this area. A page with its own layout overrides it;
 * this is what the index page of the group uses.
 */
export const metadata: Metadata = { title: 'Your roles — Zoryvex' };

export default function EmployerAppLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard requiredRole="employer" signInHref="/employer/sign-in">
      <EmployerNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </RoleGuard>
  );
}
