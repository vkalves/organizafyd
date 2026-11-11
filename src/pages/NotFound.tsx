import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="panel max-w-sm p-8 text-center">
        <p className="font-display text-4xl font-semibold tracking-tight text-foreground">404</p>
        <h1 className="mt-2 text-base font-medium text-foreground">Página não encontrada</h1>
        <p className="mt-1.5 text-xs text-muted-foreground">
          O endereço acessado não existe ou foi movido.
        </p>
        <Link
          to="/avanca"
          className="silver-button mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-medium"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao início
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
