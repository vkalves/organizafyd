# Administração de conexões

A área `/avanca/admin` permite procurar usuários cadastrados por nome/e-mail, ver as contas vinculadas e salvar permissões individuais:

- **Permitir novas conexões** libera ou bloqueia novos vínculos.
- **Máximo de contas** aceita inteiros de 0 a 10.000.
- **Sem limite** salva `max_accounts = NULL`.

Usuários sem política individual continuam com conexões liberadas e sem limite. As contas são contadas em `ig_publisher_connections`, inclusive vínculos pausados ou que precisam de reconexão. Reduzir um limite não remove contas nem cancela publicações. Renovar a autorização de uma conta já vinculada continua permitido.

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
