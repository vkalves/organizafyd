import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error("Erro inesperado na interface", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="surface-card max-w-md p-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold">Algo não carregou corretamente</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Seus dados continuam seguros. Recarregue a página para tentar novamente.</p>
          <button type="button" onClick={() => window.location.reload()} className="action-primary mx-auto mt-5">
            <RefreshCw className="h-4 w-4" /> Recarregar
          </button>
        </div>
      </div>
    );
  }
}

