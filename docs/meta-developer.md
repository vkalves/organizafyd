# Meta Developer na Avança

A aba `/avanca/meta-developer` segue a organização da referência: conexão, gerenciamento de apps, callbacks, formulário de cadastro, três passos, status, permissões e próximos passos de publicação. Os estilos usam os painéis escuros e botões prateados da Avança.

## Apps privados

Cada usuário autenticado pode cadastrar vários apps com nome interno, App ID, App Secret e Config ID opcional. Nenhum papel de administrador é necessário para gerenciar seus próprios apps. As ações `apps`, `save_app`, `toggle_app` e `delete_app` validam o usuário pelo Supabase Auth. O backend sempre passa o ID verificado; IDs enviados no corpo não escolhem o proprietário.

O Secret é armazenado no Vault e nunca é devolvido à interface. A listagem contém somente metadados e contagens reais de conexões associadas ao app. Não são usados apps fictícios nem armazenamento local para credenciais. Desativar impede novas autorizações e não interrompe publicações existentes. Apps com contas vinculadas não podem ser excluídos; o usuário pode desativá-los. Trocar o App ID ou o tipo de login de um app com contas exige cadastrar outro app. Alterar somente nome, Config ID do mesmo tipo ou Secret preserva os vínculos.

## Dois caminhos oficiais

- Sem Config ID: Instagram Login. Use as credenciais do **produto Instagram**, em API setup with Instagram login. Autorização em `https://www.instagram.com/oauth/authorize`; código trocado no backend em `https://api.instagram.com/oauth/access_token`; token de longa duração obtido em `https://graph.instagram.com/access_token`. Permissões: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`. Não exige Página do Facebook.
- Com Config ID: Facebook Login for Business (Login Unificado), preservando a implementação já existente. Usa `instagram_basic`, `instagram_content_publish` e as permissões adicionais aprovadas para métricas. O Config ID deve configurar o fluxo de token System User esperado pela integração.

Os callbacks dos dois caminhos usam a mesma Edge Function, no endereço exibido pelo servidor. Cada app precisa registrar esse endereço exato na Meta. Não copie o domínio do site de referência. Contas devem ser profissionais; aprovação do app, acesso avançado e elegibilidade são definidos pela Meta.

## Preservação de conexões

O app escolhido fica vinculado ao convite, ao estado de autorização e à conta final. Estados têm prova de navegador, expiração e consumo único. A seleção de múltiplos perfis no Login Unificado mantém as credenciais cifradas no servidor. Conexões existentes e convites emitidos antes da mudança continuam com suas credenciais e provedor; não se atribuem automaticamente credenciais globais a usuários.

O publicador, monitor e carregador de fotos existentes já escolhem `graph.instagram.com` ou `graph.facebook.com` pelo provedor da conexão. A conexão pelo Instagram Login grava o provedor `instagram` e a expiração real do token. Se a autorização expirar ou for revogada, reconecte pelo app correspondente.

## Publicação

1. Aplicar `20261111211726_meta_apps_instagram_login.sql`.
2. Publicar a Edge Function `instagram-login`, incluindo `instagram.ts`, `unified.ts` e `account-selection.ts`, preservando `verify_jwt=false` porque callback/convites são públicos e as ações privadas validam Auth internamente.
3. Publicar o frontend.
4. Cadastrar um app privado pelo painel e completar a autorização real na Meta.

A migration preserva o Vault global antigo para compatibilidade. A antiga configuração global por administrador não é mais utilizada pelo novo painel.
