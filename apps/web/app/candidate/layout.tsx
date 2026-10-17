import type { ReactNode } from 'react';
import { TestHooksMount } from '@/components/TestHooksMount';

/**
 * Scoped to /candidate/* only — mounting this in the root layout instead
 * pulled the entire @zoryvex/local-adapters package into every marketing
 * page's bundle (caught by scripts/assert-bundle-budget.mjs jumping from
 * 174 KB to 243 KB gzipped after adding this app). Marketing pages have no
 * need for local-adapter code at all.
 */
export default function CandidateRootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TestHooksMount />
      {children}
    </>
  );
}
