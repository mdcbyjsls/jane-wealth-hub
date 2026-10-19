# Project Structure

The goal is clear separation between calculation logic, API access, mock data, and UI components. Nothing should be a grab-bag folder.

```
jane-wealth-hub/
├── app/                        # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                # Dashboard (net worth + allocation)
│   ├── projection/
│   │   └── page.tsx            # Long-term wealth projection view
│   ├── buy-vs-rent/
│   │   └── page.tsx            # Buy-vs-rent scenario tester
│   └── api/
│       └── market-data/
│           └── route.ts        # Server-only FRED API route + cache logic
│
├── components/                 # Reusable UI components
│   ├── charts/                 # Recharts wrappers (ProjectionChart, AllocationPie, etc.)
│   ├── layout/                 # Shell, nav, page containers
│   └── ui/                     # Buttons, inputs, sliders, tooltips, banners
│
├── lib/
│   ├── calculations/           # Pure financial math — no UI, no fetch
│   │   ├── allocation.ts       # Net worth aggregation, allocation breakdown
│   │   ├── projection.ts       # Long-term growth projection (base/optimistic/pessimistic)
│   │   ├── buyVsRent.ts        # Buy-vs-rent 10-year comparison
│   │   └── __tests__/          # Vitest unit tests for all of the above
│   │       ├── allocation.test.ts
│   │       ├── projection.test.ts
│   │       └── buyVsRent.test.ts
│   └── fred/
│       ├── client.ts           # FRED fetch logic (server-side only)
│       ├── cache.ts            # 24-hour cache wrapper
│       └── types.ts            # TypeScript types for FRED responses
│
├── data/
│   ├── accounts.json           # Simulated account data (brokerage, IRA, 401k, HYSA, checking)
│   └── fred-snapshot.json      # Static fallback market data with a timestamp
│
├── types/                      # Shared TypeScript interfaces
│   ├── accounts.ts
│   └── market.ts
│
├── .env.example                # Placeholder env vars (FRED_API_KEY, etc.)
├── .env                        # Real secrets — gitignored
└── .kiro/
    └── steering/               # These steering files
```

## Key Separation Rules

- `lib/calculations/` imports nothing from `app/`, `components/`, or `lib/fred/`. Pure in, pure out.
- `lib/fred/` is imported only by `app/api/` routes, never by components or pages directly.
- `components/` can import from `lib/calculations/` for formatting helpers, but not for data fetching.
- `data/` files are static JSON — no logic lives there.
