import { Home, SearchX } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="max-w-md text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><SearchX className="h-7 w-7" aria-hidden="true" /></span>
        <p className="eyebrow justify-center">Página não encontrada</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground">Ops, esse caminho não existe.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Não encontramos <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{location.pathname}</code>. Volte ao painel para continuar.</p>
        <Link to="/" className="action-primary mx-auto mt-7 inline-flex"><Home className="h-4 w-4" aria-hidden="true" /> Ir para o dashboard</Link>
      </section>
    </main>
  );
};

export default NotFound;
