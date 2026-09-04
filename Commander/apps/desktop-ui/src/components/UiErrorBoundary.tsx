import { Component, type ErrorInfo, type ReactNode } from 'react';

interface UiErrorBoundaryProps {
  children: ReactNode;
}

interface UiErrorBoundaryState {
  message: string | null;
}

export class UiErrorBoundary extends Component<UiErrorBoundaryProps, UiErrorBoundaryState> {
  state: UiErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): UiErrorBoundaryState {
    return { message: error instanceof Error ? error.message : 'Unknown renderer error' };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Commander renderer error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.message) return this.props.children;
    return (
      <main className="loading-shell launcher-loading-shell" role="alert">
        <section className="loading-card">
          <span className="commander-mark" aria-hidden="true">
            ›_
          </span>
          <span>Commander could not display this view.</span>
          <small>{this.state.message}</small>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Commander
          </button>
        </section>
      </main>
    );
  }
}
