'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/company', label: 'Company' },
  { href: '/me', label: 'My pay' },
  { href: '/audit', label: 'Accountant' },
];

/** The app's sections, with the current one marked. */
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
            className={`shrink-0 rounded-full px-3.5 py-1.5 transition-colors ${
              current ? 'bg-ink text-white' : 'text-muted hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
