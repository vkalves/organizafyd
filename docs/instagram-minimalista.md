# Instagram minimalista e boas-vindas mais rápidas

## Contas do Instagram

A aba `/avanca/instagram` usa uma lista compacta em lugar dos cards extensos. A tela principal mostra a conta, seu status, itens na fila e as ações Publicar/Gerenciar. O cabeçalho reúne Conectar conta, Atualizar e um menu com verificação de saúde e reativação de contas pausadas.

A busca aceita usuário e nome personalizado. Os filtros de pasta e status ficam próximos da busca. Contadores globais redundantes e a explicação permanente sobre etiquetas foram retirados da tela; os dias de operação e demais métricas continuam disponíveis nos detalhes.

Gerenciar abre os campos de nome e pasta, métricas, última publicação, verificação de saúde e pausa/retomada. Só uma conta fica expandida por vez. Criar/excluir pastas e mover contas continuam disponíveis. As ações em lote aparecem quando há uma seleção. Selecionar todas atua somente nas contas visíveis, preservando seleções anteriores em outros filtros.

Há estados distintos para carregamento, ausência de contas, busca sem resultados e erro com nova tentativa. Nenhum endpoint, regra de publicação, autorização, identificador ou chave persistida foi alterado.

## Boas-vindas

A apresentação fica aberta por 1,8 segundo e fecha com uma animação de 420 ms de opacidade, leve escala e desfoque, totalizando aproximadamente 2,2 segundos. O Radix mantém o diálogo montado até a animação de saída terminar. Pular e Escape usam a mesma saída. Pessoas que preferem movimento reduzido recebem o fechamento sem animação.

## Verificação

- 232 testes passaram em 44 arquivos; build de produção passou.
- Chromium/Playwright em 360, 768, 1280 e 1920 px com APIs e sessão simuladas: busca, seleção limitada às contas visíveis, expansão, edição de nome, filtro de status, criação/movimentação/exclusão de pasta, pausa e verificação de saúde.
- Verificados ausência de overflow horizontal, estado vazio, erro e recuperação. Inputs móveis usam 16 px para evitar zoom automático durante a edição.
- No navegador, o estado de fechamento começou em 1,8 segundo, a opacidade passou por valores intermediários e o diálogo saiu do DOM ao final da animação.
- Os diagnósticos TypeScript são idênticos aos da versão original: seis erros preexistentes em MediaPreview, flows-api e useSupabaseCrud. O lint continua apontando os cinco usos de `any` e o aviso de MODEL_OPTIONS já existentes em Agonia; não houve novo diagnóstico.

A validação de contas foi feita com dados simulados, sem publicar conteúdos ou acessar contas reais do Instagram.
