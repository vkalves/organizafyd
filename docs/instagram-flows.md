# Fluxos do Instagram

A dashboard principal (`/`) contém os indicadores, ranking e próxima publicação. `/instagram` abre em Fluxos; as abas de contas, postagem individual, fila e alertas permanecem disponíveis.

## Comportamento

- Biblioteca privada por usuário: pastas, Reels/posts e Stories, seleção em lote, prévia e legendas individuais.
- Legenda padrão, coleção de legendas salvas e variações editáveis (reorganização do texto, sem serviço de IA externo).
- Todas as contas recebem tudo, ou as mídias são divididas sem repetição. Embaralhamento independente por conta no primeiro modo.
- Espaçamento por conta: no modo GAP, o intervalo configurado continua valendo; no modo de horários fixos, cada publicação usa o próximo horário diário da lista no fuso IANA gravado no fluxo. Os horários precisam ter pelo menos três minutos entre si, inclusive na virada do dia. A fila também mantém um piso de três minutos entre confirmações reais. Atrasos do worker ou da Meta podem fazer uma publicação sair depois do horário previsto. Fluxos separados podem coincidir.
- Formato automático: foto vira Feed, vídeo vira Reel. Capa opcional somente em Reels; Stories não recebem legenda/capa.
- Publicar agora entra na fila para o próximo ciclo; agendamento usa o fuso do navegador. A cron existente verifica a fila a cada minuto. Até 500 publicações por fluxo.
- A transação `ig_create_flow` cria fluxo e jobs juntos, verifica contas e biblioteca e permite repetir o mesmo ID sem duplicar o lote.
- Cancelar pendentes não interrompe um envio que já começou. Falhas e resultados incertos continuam visíveis na fila.

## Importar Reel por link

O botão **Importar Reel por link** abre um campo para uma URL pública de Reel do Instagram. Ao adicionar, o link entra na mesma fila de arquivos. O servidor baixa o vídeo, o navegador aplica a limpeza de metadados existente e somente o arquivo limpo é enviado ao armazenamento e registrado na biblioteca, na pasta selecionada. Importar não publica o vídeo no Instagram nem cria uma campanha.

A importação aceita Reels públicos de perfis não conectados ao site. Não usa senha, cookies de conta ou credenciais da Meta do cliente. Conteúdo privado, restrito, removido, indisponível ou acima de 100 MB gera erro por item, sem interromper os próximos. A consulta usa a resposta pública do site do Instagram e pode parar de funcionar se o Instagram mudar seus endpoints ou limitar o acesso; o envio de arquivo continua disponível. Links copiados com parâmetros de rastreamento são normalizados.

O endpoint `instagram-reel-import` exige JWT válido e conta aprovada. URLs de entrada ficam restritas ao formato de Reel nos domínios do Instagram; arquivos e redirecionamentos só podem vir por HTTPS dos CDNs da Meta. O download tem limite de tamanho e tempo, não retorna URLs de CDN ou dados de sessão ao navegador e não salva o original. Publicar a função antes da interface, mantendo a validação interna de autenticação e `verify_jwt = false`.

## Limpeza e armazenamento

A biblioteca recebe arquivos por seleção múltipla ou arrastar e soltar. É possível adicionar outras mídias enquanto a fila está trabalhando, sem esperar terminar a seleção anterior. Cada mídia conserva a pasta e o tipo escolhidos ao entrar na fila. A limpeza e o envio avançam um arquivo por vez, em ordem de entrada; uma falha fica visível e não impede os próximos arquivos. A lista mostra os arquivos aguardando, em processamento e concluídos. Mantenha a tela aberta para acompanhar a fila; ela não é persistida após recarregar a página.

`uploadMedia` sempre chama a limpeza antes de Storage, inclusive para capas e para o compositor individual. Fotos são decodificadas, orientadas e reconstruídas em JPEG; vídeos são recodificados com FFmpeg, sem tags, capítulos e faixas auxiliares, seguidos de uma segunda limpeza estrutural. O arquivo recebe nome neutro e data zero. Se o processamento falhar, o original não é enviado. Formato, codec e dimensões necessários à reprodução continuam presentes.

O limite do Instagram é de 100 MB por arquivo; os limites anteriores do X continuam iguais. O processamento acontece no dispositivo e pode falhar por memória/tempo em arquivos grandes. Links externos no compositor individual não passam por upload e, portanto, não recebem essa limpeza.

Após publicação confirmada, a rotina retira da biblioteca os arquivos sem referências pendentes, falhas, envios incertos ou rascunhos ativos. A marcação usa o mesmo bloqueio por usuário da criação de fluxos para evitar reutilização durante a exclusão. A exclusão física é repetida a cada ciclo se Storage falhar.

## Sons

O controle de volume no cabeçalho funciona em toda a aplicação. Há sons diferentes para confirmação de agendamento e publicação confirmada pela Meta. Não se toca som para histórico antigo, falhas ou resultado incerto. O navegador precisa estar aberto e ter recebido uma interação para liberar áudio. A preferência de silêncio é local ao dispositivo.

## Verificação e implantação

- Testes de modelo, formulário, limpeza, upload e transições sonoras ficam em `src/features/instagram-publisher` e `src/features/x`.
- `supabase/tests/instagram_flows.sql` verifica transação, idempotência, retenção e RLS com fixtures revertidas por rollback; não chama a Meta nem remove objetos reais de Storage.
- A migração `20261104114149_instagram_flows.sql` foi aplicada ao projeto Organizafy e a função `instagram-publisher` foi publicada com os mesmos controles JWT/secret do worker existentes.
- A prévia de interface usa somente dados fictícios; nenhum post foi enviado como teste.
