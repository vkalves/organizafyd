# Instagram: foto de perfil e remoção de conexões

## Interface

- A lista usa a foto oficial do Instagram salva em `instagram_accounts.avatar_url`. A função `instagram-accounts` consulta a Meta com a credencial da conexão e atualiza o campo existente.
- URLs aceitas usam HTTPS. Fotos ausentes, bloqueadas ou expiradas recebem as iniciais como alternativa; um erro de foto nunca remove a conta nem confirma que o perfil caiu.
- Mais ações → Atualizar fotos de perfil força uma nova consulta. As consultas usam lotes de dez contas e cache para evitar chamadas repetidas.
- O filtro Com problemas de acesso reúne reconexão necessária e alertas de acesso. Token expirado e perfil removido não são tratados como equivalentes.
- Gerenciar → Remover conta abre uma confirmação com o usuário exato. O botão só remove após confirmação do servidor. A lista e as seleções dos compositores são atualizadas no sucesso.

## Remoção no servidor

A nova função valida o JWT com `auth.getUser` e usa o ID desse usuário, ignorando proprietários enviados pelo navegador. Fotos e conexões são consultadas com filtro de proprietário. A chave de serviço e os tokens da Meta não são enviados ao cliente.

A migração `20261109143036_instagram_account_profiles_and_disconnect.sql` prepara uma remoção atômica, restrita à função no servidor:

1. Confere propriedade e obtém os locks de grafo e proprietário.
2. Bloqueia a remoção se houver publicação em processamento.
3. Cancela agendamentos da conta e a retira das configurações dos fluxos. Fluxos sem contas são encerrados; outras contas e seus agendamentos permanecem.
4. Remove a conexão e a credencial do Vault, preservando a linha da conta e os históricos publicados.
5. Guarda a associação privada entre conta e grafo para permitir reconexão com o mesmo ID e histórico.

Um trigger valida novas inserções na fila sob o mesmo lock do proprietário, para impedir agendamentos durante a remoção. A função existente de conexão mantém suas verificações de propriedade e escrita no Vault, passando a recuperar a identidade de uma conta anteriormente removida. A tabela de controle tem RLS e acesso exclusivo de serviço; a remoção usa SECURITY INVOKER e não pode ser chamada por anon/authenticated.

## Testes e estado da publicação

- 245 testes passaram em 47 arquivos, incluindo autorização por proprietário, ausência de sessão, cache de fotos, falha da Meta, URL insegura, identidade da Meta divergente, confirmação/cancelamento e erro de remoção.
- Build e lint dos novos módulos passaram. TypeScript tem os mesmos seis diagnósticos anteriores, sem novos erros.
- Navegador em 360 e 1280 px com APIs e autenticação simuladas: foto carregada, imagem quebrada com iniciais, filtro de acesso, cancelamento, bloqueio por publicação em andamento, remoção confirmada, limpeza da seleção e atualização manual de fotos.
- O teste SQL `supabase/tests/instagram_account_disconnect.sql` passou em PostgreSQL 17 isolado, com as interfaces do Vault simuladas e privilégios de serviço. Verificou proprietário errado, processamento em andamento, cancelamento da fila, preservação do histórico, isolamento de outra conta, limpeza da credencial, fluxos e reconexão. As fixtures foram revertidas por rollback.
- Uma tentativa de validar a migração com fixtures em uma transação de produção foi rejeitada pela revisão automática. A consulta posterior confirmou que a tabela e a função de remoção **não foram aplicadas** em produção. Não foram removidas contas reais.
- A ativação em produção depende de aprovação explícita para aplicar a migração e publicar a nova Edge Function. O teste de produção não deve recriar fixtures em Auth/Vault; depois da aprovação, valide metadados, permissões e rejeição de chamadas não autenticadas antes de liberar a interface.
