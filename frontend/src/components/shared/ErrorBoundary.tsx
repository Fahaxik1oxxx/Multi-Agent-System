import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-6">
          <span className="text-3xl">⚠️</span>
          <h2 className="text-base font-semibold text-[#1d1d1f]">页面加载出错</h2>
          <p className="text-xs text-[#9ca3af] max-w-md">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            className="btn btn-sm"
            style={{ borderRadius: '10px' }}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
