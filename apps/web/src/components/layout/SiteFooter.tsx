import Link from 'next/link';
import { PAYSTACK_DISCLOSURE } from '@/lib/pricing';
import { FOOTER_LEGAL_LINKS } from '@/lib/routes';

export function SiteFooter() {
  return (
    <footer className="border-t border-warm-200 bg-warm-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-500">{PAYSTACK_DISCLOSURE}</p>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-4">
              {FOOTER_LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    prefetch={false}
                    href={link.href}
                    className="inline-block py-2 text-sm text-ink-700 hover:text-ink-950"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="mt-6 text-xs text-ink-500">
          &copy; {new Date().getFullYear()} Zoryvex. Proof-first hiring for cloud engineering,
          DevOps/platform, cloud-security, and MLOps roles.
        </p>
      </div>
    </footer>
  );
}
