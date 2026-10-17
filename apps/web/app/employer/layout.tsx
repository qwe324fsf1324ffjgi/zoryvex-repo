import type { ReactNode } from 'react';
import { TestHooksMount } from '@/components/TestHooksMount';

/** Scoped to /employer/* only — see apps/web/app/candidate/layout.tsx for why. */
export default function EmployerRootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TestHooksMount />
      {children}
    </>
  );
}
