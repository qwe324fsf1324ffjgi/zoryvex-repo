import type { ReactNode } from 'react';
import { TestHooksMount } from '@/components/TestHooksMount';

/** Scoped to /admin/* only — see apps/web/app/candidate/layout.tsx for why. */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TestHooksMount />
      {children}
    </>
  );
}
