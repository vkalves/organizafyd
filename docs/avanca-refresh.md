# Atualização AVANÇA: publicação, biblioteca e interface

A atualização mantém as credenciais, permissões e destinos existentes. Não exige migração de banco nem novos secrets.

## Comportamento

- Entrada com peça de xadrez em geometria 3D real, iluminação e reflexos, rotação e texto AVANÇA. Somente peça e texto recebem fade; sem painel cinza e barra de carregamento. A animação aguarda o primeiro quadro e permite pular com Escape. Movimento reduzido é respeitado.
- Renderizadores carregados sob demanda, resolução limitada para celular e sem loop em repouso. Os recursos WebGL são liberados ao desmontar.
- Música e configuração de música de fundo removidas, incluindo o arquivo de áudio. Cursor prateado e som curto de clique sintetizado durante interação do usuário.
- Até oito prévias locais por lote, com URLs estáveis e liberação por arquivo concluído. Ambos os provedores de armazenamento têm prazo para abortar uploads travados; o erro não impede os próximos arquivos.
- Nas grades, os vídeos usam imagens JPEG extraídas com um decodificador por vez. Extração fora da tela é cancelada; abrir os detalhes mantém a reprodução do vídeo.
- Capas personalizadas têm prioridade no histórico. Títulos mostram legenda ou pasta/tipo com identificador curto estável, sem depender da posição na grade ou exibir o nome técnico do arquivo.
- A fila explica pausa de fluxo/conta, reconexão, intervalo da conta, processamento, quota e resultado incerto. Nenhum fluxo pausado é retomado automaticamente.
- Embaralhamento independente por conta e ciclo em fluxos divididos, preservando a distribuição e a proteção contra repetição.
- Compartilhamento separado em Compartilhar e Recebidas, com progresso de importação. As cópias permanecem disponíveis para seleção em qualquer fluxo, sem alterar os originais.

## Validação

- Build de produção e testes dos módulos alterados.
- Chromium em 1440 px e 390 px: entrada WebGL, histórico, capas, biblioteca e diálogo de compartilhamento; sem erros de JavaScript ou overflow horizontal.
- Lote no navegador com FFmpeg e limpeza real: 16 arquivos, sendo 15 válidos e um inválido. Seleção adicional durante o processamento, interface interativa e 15 registros concluídos. Backend de armazenamento simulado, sem gravações na conta real.
- 30 pedidos de capa do mesmo vídeo: uma requisição, uma imagem JPEG de 203 × 360, decodificador liberado e cancelamento confirmado.
- Postgres descartável: recuperação de leases, preservação de pausas, reconexão, quota, isolamento por App ID e proteção contra reenvio incerto.
- Consulta de produção antes do lançamento confirmou publicações ativas. Jobs atrasados há mais de cinco minutos estavam em fluxos pausados; nenhum foi reativado.

A suíte geral contém duas falhas anteriores em MetaAppConfig, reproduzidas no commit 2fd27d7 em checkout separado. A verificação TypeScript geral também tem erros anteriores, sem novos erros nos componentes adicionados.

## Implantação

Publicar o frontend e `instagram-publisher`, incluindo as dependências relativas. A função conserva autenticação interna de usuário e de worker, com `verify_jwt=false` já usado em produção. O embaralhamento novo vale para planos preparados após a atualização; agendamentos já gravados mantêm seus horários e conteúdo.

## Refinamento do Glass e limpeza da navegação

O tema Glass é carregado depois do tema legado e tem escopo explícito para impedir que estilos de páginas carregadas sob demanda reponham fundos opacos. Sidebar, barra superior, dock móvel, painéis e compartilhamento têm transparência real e desfoque, com tratamento mais leve no celular e suporte a transparência reduzida.

A navegação remove as entradas Stories com Link, Novo Reel e Alertas. A criação manual permanece dentro de Publicações; URLs antigas de Stories com Link redirecionam para Stories. O sino mantém a caixa de notificações, com um único toast e som por aviso novo, sem repetir em recargas. As ações secundárias ficam em menus e os selos técnicos MP4/TXT saem das miniaturas. O botão da apresentação mostra apenas Pular, com tamanho visual menor e área de toque preservada.

A orientação de primeiro acesso é exibida uma vez, somente sem conta e sem histórico de publicações. A preferência é lembrada localmente e no perfil do usuário; falhas na sincronização não interrompem o uso do site.

As miniaturas usam até dois decodificadores, deduplicam solicitações e compartilham o cache por mídia e usuário entre Biblioteca, Publicações e Agendamentos. A renovação da URL assinada não obriga a refazer a miniatura.
