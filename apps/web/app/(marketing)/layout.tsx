import type { ReactNode } from 'react';
import { SiteNav } from '@/components/layout/SiteNav';
import { SiteFooter } from '@/components/layout/SiteFooter';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
