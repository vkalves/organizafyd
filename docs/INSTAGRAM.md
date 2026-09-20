# Central Instagram — instalação e operação

## Análise do projeto e decisões

O projeto atual usa React 18, TypeScript, Vite, React Router, Tailwind e shadcn/Radix. O tema escuro e as barras lateral, superior e inferior estão em `AppLayout` e `index.css`. A sessão é gerenciada por `AuthContext`, com Supabase Auth e rotas protegidas. O banco PostgreSQL/Supabase usa `user_id` e RLS. As tabelas existentes incluem tarefas, notas, pastas, perfis, links, funis e finanças; apenas Dashboard, Tarefas, Notas e Configurações estão atualmente expostos nas rotas principais.

A central reutiliza layout, autenticação, componentes de formulário, diálogos, badges, botões, toasts, React Query, date-fns e Recharts. O módulo tem rota carregada sob demanda, modelos e acesso a dados próprios. As tarefas do Instagram têm relacionamento obrigatório com uma conta e histórico transacional, por isso ficam em tabela própria; a seção Tarefas anterior permanece intacta. Não foram acrescentadas dependências de produção.

## O que está disponível

- Menu Instagram no desktop e celular; cards agrupados por projeto, busca por conta/pessoa/projeto/etiqueta/observação e filtros combináveis.
- Projetos com nome/imagem por URL, edição e exclusão sem apagar contas; movimentação pela edição da conta.
- Contas com status, categoria, responsável, contatos e observações. Nenhum campo de senha ou token.
- Etiquetas personalizadas e sugestões; associação múltipla na aba Informações.
- Abas Visão geral, Conteúdos, Calendário, Tarefas, Métricas, Informações e Histórico.
- Conteúdos em seis etapas, quatro formatos, links para imagem/vídeo, miniatura, legenda, hashtags e datas. Marcar como publicado permite informar data real e URL.
- Calendário mensal/semanal/lista. Selecione um dia e Adicionar conteúdo; duplo clique também abre o cadastro.
- Tarefas por conta e central geral. Hoje reúne tarefas, conteúdos e atrasadas; conclusão por checkbox.
- Métricas manuais de nove indicadores, gráfico, histórico diário e comparação atual/7/30 dias usando a última medição disponível até cada data. Valores ausentes não viram zero.
- Histórico gerado no banco, sem copiar e-mail/telefone/observações privadas para os eventos.

## Aplicar o banco antes de publicar

1. No projeto Supabase já usado pelo site, abra SQL Editor.
2. Execute **uma vez** o arquivo `supabase/migrations/20260920000000_instagram.sql` inteiro. Alternativamente, use o fluxo normal de migrações do projeto com Supabase CLI.
3. A migração roda em transação. Se houver erro, não publique o frontend até resolvê-lo. Não execute novamente as migrações antigas em um banco já instalado.
4. São criadas oito tabelas: `instagram_projects`, `instagram_accounts`, `instagram_labels`, `instagram_account_labels`, `instagram_contents`, `instagram_tasks`, `instagram_metrics`, `instagram_history`.
5. RLS, índices, unicidade, foreign keys compostas por dono, timestamps e triggers são configurados pelo próprio SQL. Não desative RLS.

Não há nova variável de ambiente. Continuam necessárias `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, que o site já utiliza. Nunca use chave service-role no frontend. Não é necessário configurar bucket de Storage nesta versão: fotos e mídias são referenciadas por URL http/https acessível ao usuário. Não há upload de arquivos, conexão oficial Meta, publicação automática ou armazenamento de credenciais.

Acesso à produção Supabase não foi utilizado: a migração precisa ser aplicada por quem administra esse projeto. Tipos das novas tabelas estão definidos em `features/instagram`; os tipos gerais gerados podem ser regenerados após aplicar o SQL.

## Testar a instalação

1. Entre com a conta normal do site. Abra Instagram → Projetos e etiquetas e crie um projeto e uma etiqueta.
2. Crie uma conta, selecione o projeto e confirme que aparece no card. Edite e mova para outro projeto. Teste busca e filtros.
3. Na aba Informações, associe etiquetas e edite os contatos. Confira que outra conta de usuário não consegue consultar estes dados.
4. Cadastre uma ideia, mude para Agendado com data e horário de hoje. Confira Calendário e Hoje. Marque Publicado com a data real e link.
5. Crie uma tarefa para hoje e outra atrasada. Veja Hoje, conclua e recarregue para confirmar persistência.
6. Registre métricas em dias diferentes, confira gráfico e comparação, edite uma medição. Tentar criar outra para o mesmo dia deve informar duplicidade.
7. Confira o Histórico. Exclua um projeto de teste: suas contas devem ficar sem projeto. Cancele uma exclusão de conta; depois teste exclusão definitiva apenas com dados de teste.
8. Confira Tarefas, Notas, Configurações e login existentes.

Datas usam o fuso local do dispositivo. O fuso escolhido nas Configurações antigas ainda não é aplicado nesta nova seção. O backup geral antigo também não inclui as tabelas Instagram; use o backup do Supabase para esses registros.

## Arquivos

- `src/App.tsx`: quatro rotas protegidas.
- `src/components/layout/AppLayout.tsx`: item Instagram em todas as navegações.
- `src/pages/Instagram.tsx`: central, contas, Hoje, tarefas, métricas, histórico.
- `src/features/instagram/model.ts`: modelos, estados, URLs e datas.
- `src/features/instagram/data.ts`: acesso autenticado, paginação dos resultados Supabase, mutações e invalidação de cache por usuário.
- `src/features/instagram/Editor.tsx`: formulários compartilhados com validação e preservação em caso de erro.
- `src/features/instagram/Calendar.tsx`: calendário adaptado ao celular.
- `src/features/instagram/*.test.*`: testes de comportamento.
- `supabase/migrations/20260920000000_instagram.sql`: banco e segurança.
- `scripts/test-instagram-db.mjs`: validação isolada do SQL em PostgreSQL/PGlite.
- `scripts/test-instagram-mobile.cjs`: cenários de navegador com respostas simuladas do Supabase, sem acessar produção.
- `package-lock.json`: corrigida inconsistência prévia de dependências/peers que impedia `npm ci`.

## Validação e limites

`npm test`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build` e ESLint dos arquivos de aplicação alterados. O lint global tem erros e avisos preexistentes em outros módulos, sem alteração nesta entrega. O build também informa Browserslist antigo e bundle principal acima de 500 kB.

O teste isolado SQL verifica migração, RLS, bloqueio de referências entre usuários, unicidade, datas obrigatórias, números negativos, histórico, preservação de contas ao excluir projetos e exclusão de dependentes ao apagar contas. Ele não substitui a validação no Supabase real.

Os testes de navegador foram executados com fixtures locais em 320, 360, 375, 390, 412, 430, 768 e 1440 px: dashboard, formulário de conta, sete abas e Hoje sem overflow horizontal. Também passaram criação de projeto, conclusão de tarefa, preenchimento de data pelo calendário e cancelamento de exclusão. Nenhuma exceção de JavaScript no navegador. Os 10 testes Vitest passaram, incluindo os testes existentes.

Para executar os testes adicionais, instale temporariamente `@electric-sql/pglite` e `playwright` sem salvar no package.json, instale o Chromium e execute os scripts. O teste de navegador precisa do servidor Vite em `127.0.0.1:8080`.

A consulta atual pagina a API para não truncar registros no limite de 1.000 do Supabase, mas carrega o conjunto do usuário em memória. Para volumes muito grandes, a próxima evolução deve usar filtros e agregações no servidor e paginação visual de histórico/métricas. Responsável é texto, não convite ou permissão de equipe.

## Publicar

Aplique o SQL, valide em ambiente de teste, revise e faça merge do PR. Depois execute o deploy normal do projeto (Lovable/Vercel ou hospedagem atual). Esta entrega não muda a configuração de hospedagem nem aplica automaticamente o SQL. Para voltar à versão anterior do frontend, reverta o commit/PR; as novas tabelas podem permanecer sem interferir nas telas antigas.
