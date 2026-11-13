# Entrada de contas em fluxos ativos

Toda conta adicionada a um fluxo ativo ignora uma vez o próximo horário de
publicação do fluxo e começa no horário seguinte. Não há limite de minutos:
a regra é a mesma independentemente de quanto falta para a próxima postagem.
As contas que já participavam continuam com seus agendamentos originais.

A regra se aplica tanto a **Conectar conta ao fluxo** quanto a contas
compartilhadas por convite. Uma publicação que já está em processamento não
é copiada para a conta nova nem conta como a próxima postagem agendada.
Quando várias mídias estão programadas no mesmo primeiro horário, todas são
ignoradas naquele horário para as contas que acabaram de entrar.

O horário ignorado fica registrado como cancelado com motivo de entrada no
fluxo. Não conta como publicação, não reserva reutilização de mídia e não é
enviado ao Instagram. As demais publicações mantêm os horários do fluxo.
Repetir a sincronização da mesma conta não cria cópias nem pula outro horário.

Se só resta uma postagem, a conta nova a ignora. Se o fluxo é repetitivo, passa
a publicar no ciclo seguinte; se o fluxo não repete, não haverá postagem para
essa conta nessa execução. Quando não há nenhuma postagem na fila no momento
da entrada, a regra fica pendente até o primeiro horário gerado no próximo
ciclo. O horário pulado é considerado como âncora de tempo para que um ciclo
com apenas uma mídia não publique imediatamente após ignorá-la.

## Publicação

Aplicar a migração `20261113121349_skip_next_flow_post_on_account_entry.sql` e
publicar o frontend. A função Edge existente continua usando as mesmas RPCs.
A migração substitui a sincronização de contas, o avanço de ciclos e a leitura
de progresso, preservando a execução restrita ao serviço. Não modifica os
agendamentos já existentes nem adiciona a regra retroativamente.
