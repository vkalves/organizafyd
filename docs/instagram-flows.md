# Fluxos do Instagram

A dashboard principal (`/`) contém os indicadores, ranking e próxima publicação. `/instagram` abre em Fluxos; as abas de contas, postagem individual, fila e alertas permanecem disponíveis.

## Comportamento

- Biblioteca privada por usuário: pastas, Reels/posts e Stories, seleção em lote, prévia e legendas individuais.
- Legenda padrão, coleção de legendas salvas e variações editáveis (reorganização do texto, sem serviço de IA externo).
- Todas as contas recebem tudo, ou as mídias são divididas sem repetição. Embaralhamento independente por conta no primeiro modo.
- Espaçamento por conta: no modo GAP, o intervalo configurado continua valendo; no modo de horários fixos, cada publicação usa o próximo horário diário da lista no fuso IANA gravado no fluxo. Os horários precisam ter pelo menos três minutos entre si, inclusive na virada do dia. A fila usa a confirmação real, mantém um piso de três minutos por conta e volta ao próximo slot válido se uma confirmação atrasar o ciclo. Horários inexistentes no avanço do relógio são pulados; horários repetidos usam a primeira ocorrência, ou a segunda se o cursor já tiver passado pela primeira. Fluxos separados podem coincidir.
- Formato automático: foto vira Feed, vídeo vira Reel. Capa opcional somente em Reels; Stories não recebem legenda/capa.
- Publicar agora entra na fila para o próximo ciclo; agendamento usa o fuso do navegador. A cron existente verifica a fila a cada minuto. Até 500 publicações por fluxo.
- A transação `ig_create_flow` cria fluxo e jobs juntos, verifica contas e biblioteca e permite repetir o mesmo ID sem duplicar o lote.
- Cancelar pendentes não interrompe um envio que já começou. Falhas e resultados incertos continuam visíveis na fila.

## Privacidade

`uploadMedia` sempre chama a limpeza antes de Storage, inclusive para capas e para o compositor individual. Fotos são decodificadas, orientadas e reconstruídas em JPEG; vídeos são recodificados com FFmpeg, sem tags, capítulos e faixas auxiliares, seguidos de uma segunda limpeza estrutural. O arquivo recebe nome neutro e data zero. Se o processamento falhar, o original não é enviado. Formato, codec e dimensões necessários à reprodução continuam presentes.

O limite do Instagram é de 100 MB por arquivo; os limites anteriores do X continuam iguais. O processamento acontece no dispositivo e pode falhar por memória/tempo em arquivos grandes. Links externos no compositor individual não passam por upload e, portanto, não recebem essa limpeza.

Após publicação confirmada, a rotina retira da biblioteca os arquivos sem referências pendentes, falhas, envios incertos ou rascunhos ativos. A marcação usa o mesmo bloqueio por usuário da criação de fluxos para evitar reutilização durante a exclusão. A exclusão física é repetida a cada ciclo se Storage falhar.

## Sons

O controle de volume no cabeçalho funciona em toda a aplicação. Há sons diferentes para confirmação de agendamento e publicação confirmada pela Meta. Não se toca som para histórico antigo, falhas ou resultado incerto. O navegador precisa estar aberto e ter recebido uma interação para liberar áudio. A preferência de silêncio é local ao dispositivo.

## Verificação e implantação

- Testes de modelo, formulário, limpeza, upload e transições sonoras ficam em `src/features/instagram-publisher` e `src/features/x`.
- `supabase/tests/instagram_flows.sql` verifica transação, idempotência, retenção e RLS com fixtures revertidas por rollback; não chama a Meta nem remove objetos reais de Storage.
- A publicação desta implementação exige aplicar `20261106000000_instagram_campaigns.sql`, `20261107000000_instagram_slot_claim.sql` e `20261107050821_instagram_slot_queue_pacing.sql`, em ordem, e depois publicar a Edge Function e o frontend. Esta tarefa não aplica migrações nem publica funções em um banco de produção.
- Os testes isolados e a prévia de interface usam somente dados fictícios; nenhum post foi enviado como teste.
