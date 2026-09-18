# Organizafy

Organizafy é um painel pessoal para centralizar tarefas, funis, finanças, notas, links e rotinas de crescimento no Instagram. A interface é construída em React + TypeScript, com dados persistidos no Supabase.

## Desenvolvimento local

Requisitos: Node.js 20+ e npm.

```bash
git clone https://github.com/vkalves/organizafyd.git
cd organizafyd
npm ci
cp .env.example .env
npm run dev
```

Preencha `.env` com a URL e a chave pública do projeto Supabase. O arquivo `.env` é local e não deve ser versionado.

## Comandos úteis

```bash
npm run typecheck  # valida TypeScript
npm run lint       # executa ESLint
npm test           # executa os testes
npm run build      # gera a versão de produção
```

## Supabase

As migrações existentes criam as tabelas principais e suas políticas de segurança por usuário. A migração `supabase/migrations/20260918000000_add_instagram_management.sql` adiciona as tabelas de contas, progresso de aquecimento e vídeos do Instagram. Aplique as migrações no projeto conectado antes de usar o módulo Instagram em produção:

```bash
npx supabase db push
```

Nunca coloque uma `service_role key` no frontend. O app usa somente a chave pública do Supabase e as políticas RLS para limitar os dados ao usuário autenticado.

## Estrutura principal

- `src/pages`: telas da aplicação e rotas protegidas.
- `src/components`: layout, editor, funis e componentes reutilizáveis.
- `src/hooks/useSupabaseCrud.ts`: operações CRUD tipadas e isoladas por usuário.
- `src/integrations/supabase`: cliente e tipos do banco.
- `supabase/migrations`: histórico versionado do schema e das políticas RLS.
