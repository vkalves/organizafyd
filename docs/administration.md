# Administração de conexões

## Aprovação de novos cadastros

Em **Gestão → Administração**, a seção **Aprovação de novos cadastros** lista os usuários pendentes, com paginação e ações **Aprovar conta** e **Rejeitar conta**. Rejeitar exige confirmação. O status também aparece na busca geral de usuários; uma conta rejeitada pode ser aprovada posteriormente. Esta operação não revoga contas já aprovadas.

Depois da implantação, novos cadastros recebem `pending` por um trigger em `auth.users`, independentemente dos metadados enviados pelo usuário. Confirmar o e-mail não aprova o cadastro. Contas existentes no momento da migração mantêm o acesso; administradores cadastrados em `avanca_admins` permanecem aprovados. A decisão registra o administrador e o horário no servidor, e uma segunda decisão concorrente não sobrescreve uma aprovação já concluída.

O usuário pendente vê **Aguardando aprovação**, com opções para verificar novamente ou sair. Contas rejeitadas veem uma mensagem específica. O status é atualizado periodicamente e ao voltar à janela. Falhas na consulta não liberam acesso.

O bloqueio é aplicado pela interface, por políticas RLS restritivas nas tabelas existentes com RLS em `public` e em `storage.objects`, e pela validação de aprovação nos clientes de serviço das funções do Instagram, Google Agenda, X, TikTok e armazenamento. O endpoint administrativo continua permitindo a consulta do próprio status por um usuário pendente; listar cadastros e aprovar/rejeitar exige administrador. Novas tabelas ou funções devem adotar a mesma verificação. Links de mídias já públicos continuam públicos.

### Implantação

1. Aplicar `account_approval` antes da interface ou das funções que dependem dela. A migração bloqueia brevemente inserções em `auth.users` para preservar o acesso das contas anteriores sem deixar cadastros fora da fila.
2. Publicar `app-admin`, `google-calendar`, `instagram-accounts`, `instagram-login`, `instagram-monitor`, `instagram-publisher`, `s3-storage`, `tiktok-publisher` e `x-publisher`, incluindo o auxiliar compartilhado `account-approval.ts`.
3. Publicar a interface e confirmar o fluxo cadastro → confirmação de e-mail → espera → aprovação administrativa → acesso.

Os testes locais cobrem criação pendente, preservação de contas existentes, RLS, tentativa de autoaprovação, auditoria, decisões conflitantes, autenticação do servidor e estados da interface. A verificação no Chromium usa sessões e respostas simuladas, sem cadastrar ou aprovar contas reais.

**Publicação verificada:** a migração foi aplicada em produção como `20261113003551_account_approval.sql`; o nome local acompanha o histórico remoto. As oito funções já existentes foram atualizadas com a aprovação (Google Agenda ainda não estava publicado nesse projeto). A interface foi publicada pela integração Git da Vercel. As nove contas anteriores mantiveram acesso. O fluxo de criação pendente, rejeição, aprovação e auditoria foi validado em uma transação revertida, sem deixar conta de teste nem alterar usuários reais. O endpoint administrativo rejeitou acesso sem sessão; o navegador confirmou a nova interface de aprovação no pacote publicado e o redirecionamento de visitantes para o login.


A área `/avanca/admin` permite procurar usuários cadastrados por nome/e-mail, ver as contas vinculadas e salvar permissões individuais:

- **Permitir novas conexões** libera ou bloqueia novos vínculos.
- **Máximo de contas** aceita inteiros de 0 a 10.000.
- **Sem limite** salva `max_accounts = NULL`.

Usuários sem política individual têm conexões liberadas e limite padrão de 10 contas, inclusive novos cadastros. Exceções sem limite são salvas explicitamente com `max_accounts = NULL`. As contas são contadas em `ig_publisher_connections`, inclusive vínculos pausados ou que precisam de reconexão. Reduzir um limite não remove contas nem cancela publicações. Renovar a autorização de uma conta já vinculada continua permitido.

## Autorização

O endpoint `app-admin` valida o JWT com Supabase Auth em cada solicitação. A ação `access` retorna apenas os dados do próprio usuário. Listagem e alterações exigem presença em `avanca_admins`; o ator da alteração vem da sessão validada, nunca do corpo da requisição. Não há credenciais administrativas no navegador nem concessão de papel por metadados editáveis.

As tabelas têm RLS. As funções administrativas são executáveis somente pelo servidor, com `service_role`. O administrador inicial é cadastrado operacionalmente a partir de um login com e-mail confirmado, fora do código versionado. Não há edição de papéis pelo painel.

A listagem e a alteração de limites usam funções `SECURITY DEFINER` com caminho de busca fixo e execução exclusiva do servidor, pois o papel de serviço não tem leitura direta de `auth.users`. Os demais auxiliares usam `SECURITY INVOKER`.

O trigger `avanca_connection_limit` aplica a política dentro da transação de conexão, inclusive nas diferentes formas de OAuth. Alterações de política e criação de vínculos compartilham um bloqueio transacional por usuário. A última alteração registra `updated_at` e `updated_by`.

## Publicação

1. Aplicar a migração `administration_and_instagram_account_limits`.
2. Cadastrar o administrador inicial confirmado por operação privilegiada.
3. Publicar `app-admin` (validação interna de JWT), `instagram-login` e `instagram-publisher`.
4. Publicar a interface.

## Verificação

Os testes em `src/features/administration` cobrem limites no Postgres, reconexão, redução de limites, isolamento por usuário, RLS, autenticação e autorização do endpoint, além da interface. A verificação de navegador usa contas simuladas; não cria conexões reais nem modifica permissões de usuários em produção.

## Cotas de armazenamento de mídias

O painel inclui **Armazenamento de mídias**, com uso atual (incluindo envios reservados) e um campo **Espaço permitido (GB)** para cada usuário comum. **Salvar armazenamento** altera apenas a cota de mídias; as permissões de conexão do Instagram são independentes.

- Usuários existentes e novos sem exceção individual recebem **1 GB** (1.073.741.824 bytes).
- Administradores cadastrados em `avanca_admins` têm **armazenamento ilimitado**, calculado no servidor. O painel não permite limitá-los. Alterações de papel passam a valer nas próximas solicitações.
- O administrador pode definir de 0 a 10.000 GB, inclusive frações de GB. Zero impede novos envios.
- A cota soma os arquivos dos buckets `media`, `instagram-publisher`, `x-media` e `tiktok-media`, incluindo subpastas. Uma cópia com o mesmo bucket/caminho no Supabase e na AWS conta uma vez, pelo maior tamanho observado. Versões antigas internas do S3 não fazem parte da cota lógica do usuário.
- Reduzir a cota não exclui mídias existentes. Leituras e publicações continuam disponíveis; novos envios que aumentem o uso ficam bloqueados até liberar espaço ou aumentar a cota. Limites individuais por arquivo e restrições de formato continuam valendo.
- O gateway reserva os bytes antes de assinar o envio ao S3. O banco serializa reservas, uploads pelo Supabase e alterações de cota por usuário para impedir que envios paralelos ultrapassem o limite. A resposta de cota excedida é exibida em português.
- Reservas de upload sem arquivo são liberadas depois de dez minutos, na próxima consulta completa ao inventário S3. A listagem precisa ter sucesso em todos os buckets e páginas. Exclusões de arquivos com uma autorização de upload ainda válida mantêm os bytes reservados temporariamente, pois a autorização poderia recriar o arquivo. Uma falha no inventário impede o novo envio em vez de presumir uso zero.

As cotas e o inventário S3 têm RLS e acesso exclusivo do servidor. Nenhuma chave da AWS ou de serviço vai para o navegador. A alteração valida o administrador pela sessão, verifica a conta de destino e grava o ator e o horário. O trigger em `storage.objects` somente valida a cota da operação da API; não grava nem exclui metadados de arquivos.

### Publicação da alteração

1. Em uma janela de implantação, publicar uma versão temporária do gateway que pause novos uploads. Aplicar `storage_quota_rollout_pause` **antes** de `user_media_storage_quotas` na instalação existente, para pausar também a API legada. Aguardar a expiração das autorizações S3 já emitidas (120 segundos). Leituras e exclusões continuam disponíveis; manter as mídias existentes.
2. Aplicar `user_media_storage_quotas`, que cria as cotas, os auxiliares exclusivos do servidor e a validação dos uploads do Supabase. A migração não exclui arquivos nem altera o conteúdo das tabelas do Storage.
3. Publicar `s3-storage`, com `quota.ts`, antes de `app-admin`. Preservar a configuração de acesso público do gateway e a validação interna de JWT. Publicar a interface.
4. Se a instalação usa S3, executar `node scripts/reconcile-storage-quotas.mjs` com a URL e a chave de serviço no ambiente do processo. O script pagina todas as contas e os objetos, registra apenas metadados no inventário e falha se houver erro. Em instalações exclusivamente Supabase, essa etapa não é necessária.
5. Republicar o gateway final e aplicar `storage_quota_rollout_resume` para remover a pausa temporária. Confirmar no painel uma conta comum com 1 GB, um administrador sem limite e uma alteração individual. Verificar o bloqueio de um upload com cota insuficiente e reabrir os uploads.

A listagem administrativa atualiza o inventário S3 antes de exibir o uso quando há configuração AWS. Os testes locais usam Postgres embarcado e serviços simulados; não alteram cotas nem criam arquivos em produção.
