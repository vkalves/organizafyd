import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in component tree:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoHome = () => {
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            width: "100%",
            backgroundColor: "#050508",
            color: "#f4f3f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              backgroundColor: "rgba(18, 18, 26, 0.85)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "16px",
              padding: "32px",
              textAlign: "center",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "50%",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#f87171",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "20px",
              }}
            >
              <AlertTriangle size={26} />
            </div>

            <h1
              style={{
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: "0 0 10px",
              }}
            >
              Algo não carregou corretamente
            </h1>

            <p
              style={{
                fontSize: "14px",
                color: "#a1a1aa",
                lineHeight: "1.5",
                margin: "0 0 24px",
              }}
            >
              Ocorreu uma falha inesperada durante a exibição da tela. Você pode recarregar a página ou voltar ao início.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#e4e4e7",
                  fontFamily: "monospace",
                  textAlign: "left",
                  marginBottom: "24px",
                  wordBreak: "break-word",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}
              >
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "11px 18px",
                  fontSize: "14px",
                  fontWeight: 500,
                  backgroundColor: "#ffffff",
                  color: "#050508",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  transition: "opacity 0.15s ease",
                }}
              >
                <RefreshCw size={15} /> Recarregar página
              </button>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={this.handleReset}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 14px",
                    fontSize: "13px",
                    fontWeight: 500,
                    backgroundColor: "rgba(255, 255, 255, 0.06)",
                    color: "#f4f3f0",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "10px",
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={14} /> Tentar novamente
                </button>

                <button
                  type="button"
                  onClick={this.handleGoHome}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 14px",
                    fontSize: "13px",
                    fontWeight: 500,
                    backgroundColor: "rgba(255, 255, 255, 0.06)",
                    color: "#f4f3f0",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "10px",
                    cursor: "pointer",
                  }}
                >
                  <Home size={14} /> Início
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
