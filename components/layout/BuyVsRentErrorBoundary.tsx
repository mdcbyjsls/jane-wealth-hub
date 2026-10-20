'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import BuyVsRentErrorState from '@/components/ui/BuyVsRentErrorState';
import { BUY_VS_RENT_MESSAGES } from '@/lib/buyVsRentMessages';

/**
 * React error boundary wrapping the buy-vs-rent island (R12.2, R12.5).
 *
 * Mirrors Spec 1's `DashboardErrorBoundary` and Spec 2's
 * `ProjectionErrorBoundary`. Error boundaries must be class components (React
 * only supports the `getDerivedStateFromError` / `componentDidCatch` lifecycle
 * on classes), and they run on the client, hence the `'use client'` directive.
 *
 * On a genuinely unexpected fault — a thrown exception in the comparison
 * calculation or a child component — this catches it and renders the same
 * plain-language route-error copy the view already uses for a failed
 * market-data request (via `BuyVsRentErrorState` with
 * `BUY_VS_RENT_MESSAGES.routeError`). The user never sees a stack trace or a
 * blank/misleading screen, only the vetted plain-language message (R12.2,
 * R12.5). When no error has occurred, children render normally.
 */
export interface BuyVsRentErrorBoundaryProps {
  /** The buy-vs-rent subtree to protect. Rendered as-is when there is no error. */
  children: ReactNode;
}

interface BuyVsRentErrorBoundaryState {
  /** True once a descendant has thrown; flips the UI to the fallback. */
  hasError: boolean;
}

export class BuyVsRentErrorBoundary extends Component<
  BuyVsRentErrorBoundaryProps,
  BuyVsRentErrorBoundaryState
> {
  constructor(props: BuyVsRentErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * React calls this during rendering when a child throws, letting us swap to
   * the fallback UI without touching the caught error's details.
   */
  static getDerivedStateFromError(): BuyVsRentErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * Side-effect hook for the caught error. We log for debugging only — the
   * raw error is never surfaced to the user (R12.5).
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Buy-vs-rent error boundary caught an unexpected fault:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Same plain-language copy as a recoverable market-data failure (R12.2).
      return <BuyVsRentErrorState message={BUY_VS_RENT_MESSAGES.routeError} />;
    }
    return this.props.children;
  }
}

export default BuyVsRentErrorBoundary;
