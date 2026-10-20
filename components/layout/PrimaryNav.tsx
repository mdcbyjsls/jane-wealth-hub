'use client';

/**
 * Primary navigation across the three v1 views: the dashboard, the long-term
 * wealth projection, and the buy-vs-rent scenario tester.
 *
 * Without this, the projection and buy-vs-rent pages exist and build but are
 * unreachable from the UI — there is no link to them. This nav is the single
 * place those routes are surfaced.
 *
 * Accessibility:
 *  - Rendered as a labelled <nav> landmark with a real list of links.
 *  - The active route is marked with `aria-current="page"` AND a visible,
 *    non-color cue (bold weight + an underline bar), so the current page is
 *    never indicated by color alone (R9.6).
 *  - Each link is keyboard reachable with a visible focus-visible ring (R9.3).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  /** The primary word — the larger, bolder line that names the story. */
  label: string;
  /** A short, lighter descriptor shown beneath the primary word. */
  descriptor: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Today', descriptor: 'Net worth & allocation' },
  { href: '/projection', label: 'Future', descriptor: 'Long-term projection' },
  { href: '/buy-vs-rent', label: 'Decision', descriptor: 'Buy vs. rent' },
];

/**
 * True when `pathname` is the page for `href`. The dashboard ('/') matches only
 * an exact path; the others match the route or any nested path beneath it.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav aria-label="Primary" className="border-b border-gray-200 bg-white">
      <ul className="mx-auto flex w-full max-w-5xl gap-1 px-4 sm:gap-2 sm:px-6 lg:px-8">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex flex-col border-b-2 px-3 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2',
                  active
                    ? 'border-sky-700'
                    : 'border-transparent hover:border-gray-300',
                ].join(' ')}
              >
                <span
                  className={[
                    'text-sm leading-tight',
                    active
                      ? 'font-semibold text-sky-800'
                      : 'font-medium text-gray-700',
                  ].join(' ')}
                >
                  {item.label}
                </span>
                <span
                  className={[
                    'text-xs leading-tight',
                    active ? 'text-sky-700' : 'text-gray-500',
                  ].join(' ')}
                >
                  {item.descriptor}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default PrimaryNav;
