import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
          <div className="glass-card max-w-md p-8 border border-red-500/20">
            <div className="bg-red-500/10 size-16 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="material-symbols-outlined notranslate text-red-500 text-3xl">error</span>
            </div>
            <h1 className="text-xl font-bold text-text-primary mb-2">Oops! Qualcosa è andato storto.</h1>
            <p className="text-text-muted text-sm mb-8 leading-relaxed">
              L'applicazione ha riscontrato un errore inaspettato durante la sincronizzazione dei dati. 
              Non preoccuparti, i tuoi dati sono al sicuro.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="btn-primary w-full justify-center"
              >
                Ricarica Pagina (F5)
              </button>
              <button 
                onClick={async () => {
                  localStorage.clear();
                  window.location.href = '/login';
                }}
                className="btn-secondary w-full justify-center border-red-500/20 text-red-400 hover:bg-red-500/10"
              >
                Disconnetti e Ripristina
              </button>
              <button 
                onClick={() => this.setState({ hasError: false })}
                className="text-xs text-text-muted hover:text-primary font-medium uppercase tracking-widest pt-2 transition-colors"
              >
                Tenta ripristino automatico
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && (
              <pre className="mt-8 p-4 bg-black/40 rounded text-left text-[10px] text-red-400 overflow-auto max-h-40 font-mono">
                {this.state.error?.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
