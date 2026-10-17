import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { AdminNav } from '@/components/admin/AdminNav';

/**
 * Default title for this area. A page with its own layout overrides it;
 * this is what the index page of the group uses.
 */
export const metadata: Metadata = { title: 'Founder console — Zoryvex' };

export default function AdminAppLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard requiredRole="admin" signInHref="/admin/sign-in">
      <AdminNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </RoleGuard>
  );
}
