# Visualizações e boas-vindas no DISPARA

## Uso

- Acesse **Conta → Visualizações**, em `/dispara/visualizacoes`, pelo menu lateral ou pelo menu **Mais** no celular.
- Selecione uma conta ou todas e filtre os vídeos pela data de publicação (7 dias, 30 dias ou todo o histórico consultado).
- Consulte total acumulado, média por vídeo, cobertura das métricas, ranking dos vídeos e comparação entre contas.
- Use **Carregar mais vídeos** para incluir páginas adicionais e **Atualizar métricas** para iniciar uma nova consulta.
- Sem contas conectadas, o módulo oferece um atalho para a conexão do Instagram.

As métricas usam a ação `analytics` já existente na função `instagram-publisher`. Não há alteração de banco, autenticação ou implantação de funções. A API continua limitando a consulta às contas do usuário autenticado. É necessário que essa função já esteja implantada e que a conexão tenha as permissões de insights da Meta.

Os números representam visualizações acumuladas dos vídeos consultados, incluindo repetições. O período filtra a **data de publicação**, não os dias em que as visualizações ocorreram. Não são visitas ao perfil nem visitantes únicos. Valores ausentes aparecem como indisponíveis, preservando a diferença entre falta de métricas e zero real. Contas indisponíveis e consultas parciais são identificadas.

## Boas-vindas

A apresentação de boas-vindas ocupa a tela e usa o símbolo cromado oficial, com a marca DISPARA. Fecha após 5,5 segundos, pelo botão de pular ou por Escape. Não reaparece durante a navegação interna e respeita `prefers-reduced-motion`. O login segue a nova composição cromada inspirada nos estilos do site enviado. Veja os detalhes em [Identidade DISPARA](dispara-chrome.md).

## Arquivos

- `src/App.tsx`: monta as boas-vindas acima das rotas.
- `src/components/common/WelcomeAnimation.tsx` e `welcome-animation.css`: mensagem, temporizador e animação acessível.
- `src/components/common/WelcomeAnimation.test.tsx`: fechamento automático, manual e ausência de repetição ao renderizar novamente.
- `src/components/layout/AppLayout.tsx`: entrada Visualizações no menu.
- `src/pages/Agonia.tsx`: reconhece a seção e carrega o módulo sob demanda.
- `src/features/instagram-publisher/AccountViews.tsx`: página do módulo com o estilo atual do DISPARA.
- `src/features/instagram-publisher/InstagramAnalytics.tsx`: comparação por conta, estados vazios e de erro, status da consulta e ajustes de responsividade.
- `src/features/instagram-publisher/InstagramAnalytics.test.tsx`: filtros, recuperação de erro, ausência de conexão e métricas indisponíveis, além da cobertura existente de paginação e ranking.

## Validação

- Build de produção com Vite.
- Suíte Vitest após o rebranding: 233 testes passaram em 44 arquivos, com timeout de 15 segundos para acomodar o ambiente de execução.
- Chromium/Playwright em 360, 768, 1280 e 1920 px, usando respostas simuladas da API e sessão de teste: carregamento direto, navegação, ausência de overflow horizontal e de erros JavaScript, fechamento manual e automático e preferência por movimento reduzido.
- Lint do código novo e do componente de analytics sem erros.
- A comparação com o commit de origem `8ccc3a9` confirmou os mesmos seis diagnósticos TypeScript em `MediaPreview.tsx`, `flows-api.ts` e `useSupabaseCrud.ts`. Os cinco erros de `any` e dois avisos de hooks nos componentes existentes `Agonia.tsx` e `AppLayout.tsx` também já estavam presentes.

Não houve teste autenticado contra uma conta real da Meta. O comportamento visual foi validado com dados simulados, e a consulta mantém a integração existente. O rebranding e os recursos oficiais foram aplicados conforme documentado em `dispara-chrome.md`.
