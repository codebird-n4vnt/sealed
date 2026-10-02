'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/company', label: 'Company' },
  { href: '/me', label: 'My pay' },
  { href: '/audit', label: 'Accountant' },
];

/** The app's sections; the current one is darker and marked with a dot. */
export function NavLinks({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className={`items-center gap-1 text-sm ${className}`}>
      {NAV.map(item => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
              current ? 'font-medium text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {item.label}
            {current && (
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
                <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="6" cy="6" r="2" fill="currentColor" />
              </svg>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
