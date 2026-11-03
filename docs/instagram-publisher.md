# Instagram Studio — publicação automática

Entrada: `/instagram` ou `/instagram/publicar`. O módulo exibe somente a automação; os endereços dos painéis antigos redirecionam para ela.

## Funcionamento

A interface permite salvar rascunhos, enviar JPG/MP4 para Storage privado, agendar Feed (foto JPG), Reel (MP4), Story (JPG/MP4, sujeito ao tipo de conta Meta), ou carrossel de 2 a 10 fotos JPG. O limite local de upload é 100 MB. Links HTTPS diretos também são aceitos. Dimensões, duração, codec e elegibilidade final são verificados pela Meta. Um token com leitura e escopo de publicação não garante elegibilidade de toda mídia ou de Stories.

O horário é convertido do fuso local para UTC. Um cron chama a Edge Function a cada minuto; cada chamada tenta uma postagem. O horário pode atrasar por processamento de vídeo, pausa, fila ou limites externos. Rascunhos e planejamentos antigos NÃO são convertidos automaticamente em envios: precisam ser revisados e agendados pela interface.

Uma conta pode ser pausada. Ao retomar, posts vencidos também serão enviados; cancele antes os que não deseja enviar. Cancelamento é permitido somente enquanto o trabalho está agendado; depois do início do processamento não é garantido. Trabalhos agendados são imutáveis: para alterar, cancele e crie outro.

## Segurança e confiabilidade

A credencial é cifrada pelo Supabase Vault e associada à conta de acesso correta no servidor. Ela não aparece no bundle, no GitHub, em respostas do servidor ou na tabela de jobs. O Storage é privado, com caminhos por usuário; URLs assinadas de uma hora são geradas no momento do envio. Os arquivos ficam armazenados após cancelamento/publicação; esta versão não oferece limpeza automática.

As chamadas da interface validam JWT via `auth.getUser`; o cron valida um segredo próprio. RLS limita leitura de jobs ao dono; somente o serviço pode escrever. O serviço também valida propriedade da conexão e dos caminhos do Storage. A criação do job tem UUID estável para evitar duplicações após reenvio de uma requisição.

A fila usa claim atômico com lock. Após criar o contêiner, seu ID é persistido e o processamento é consultado em chamadas posteriores. Antes de `media_publish`, o servidor registra a fronteira de publicação. Uma falha após esse ponto vira **Conferir no Instagram** e nunca gera reenvio automático. Um trabalho interrompido por mais de dez minutos recebe o mesmo status conservador. Falhas anteriores à publicação ficam como Falhou, sem retry automático. Limite: 30 verificações de processamento antes de falhar.

## Instalação e manutenção

Aplicar as migrações `instagram_publisher_foundation`, `instagram_publisher_live` e `instagram_token_rotation`, e implantar `supabase/functions/instagram-publisher`. O cron depende de pg_cron, pg_net e Vault. O backend usa Graph API v24.0 pelo fluxo Facebook Login.

O provisionamento inicial da conexão é administrativo, por SQL transacional: localizar o usuário por e-mail, criar/reutilizar `instagram_accounts`, criar o segredo no Vault e associar seu UUID a `ig_publisher_connections`. Nunca incluir o token em migrações ou código. Depois, o usuário pode trocar o token em **Atualizar token da conta**: o servidor confere que o novo token acessa o mesmo ID antes de substituir o segredo. A reconexão preserva a pausa.

Esta entrega conecta a conta já autorizada; não implementa onboarding OAuth para terceiros. Para atender clientes, implementar OAuth e cumprir a análise/requisitos da Meta antes de disponibilizar conexão de outras contas. A duração do token depende de como ele foi emitido: não há renovação automática sem as credenciais de aplicativo necessárias. Ao receber erro 190, o serviço marca reconexão necessária e bloqueia novos envios até a troca do token.

## Verificação

Testes locais cobrem validação de agendamento, formatos, contagem de mídia e isolamento de caminhos de upload. No banco, verificar grants, RLS e claim/lease em transações com rollback. Verificar a conexão no servidor com chamada de leitura autenticada; não usar conteúdo de teste arbitrário em uma conta real. Um teste completo de publicação exige mídia e legenda escolhidas pelo usuário.

## Conectar contas pelo site

O botão **Conectar conta** abre o assistente: token de usuário da Meta (Facebook Login), descoberta de perfis via `me/accounts`, confirmação do @ e gravação segura. O ID numérico é uma alternativa à descoberta. O servidor revalida perfil, permissões `instagram_basic`/`instagram_content_publish` e acesso ao endpoint de limite de publicação antes de salvar.

`ig_connect_account` é uma operação atômica, exclusiva do service_role. Ela vincula o perfil ao usuário autenticado, cria o segredo no Vault e evita duplicação por Graph ID. A reconexão do mesmo proprietário preserva a pausa e a fila; outro proprietário recebe conflito. Nenhuma credencial é retornada pela API. O formulário mantém o token apenas em memória e o limpa ao concluir ou fechar.

Este assistente não implementa OAuth: ainda exige um token e sua renovação quando expirar. A descoberta depende das permissões de Páginas e do vínculo profissional. Login direto pela Meta exige configuração do aplicativo, segredo no servidor e callback OAuth; acesso a clientes externos depende da aprovação da Meta.

## Login unificado da Meta e links para clientes

O app HOTfy usa a configuração de **login unificado**, não o antigo Instagram Login. A função `instagram-login` abre Facebook Login for Business com `config_id`, `response_type=code`, `override_default_response_type=true` e `prompt=login`, sem lista `scope`. A tela da Meta pode oferecer Instagram e Facebook. O usuário deve escolher o portfólio empresarial correto e compartilhar um único perfil profissional.

A troca de código ocorre somente no servidor, em graph.facebook.com. A resposta é validada em debug_token: app correto, token válido do tipo SYSTEM_USER e permissões instagram_basic/instagram_content_publish. O servidor consulta client_business_id e me/assigned_instagram_accounts; nunca trata o /me do usuário do sistema como um Instagram. Zero ou vários perfis resultam em mensagem específica sem cadastro arbitrário. Uma leitura de content_publishing_limit verifica o acesso antes da gravação. O token é salvo criptografado no Vault com o business ID e a expiração retornada pela Meta (zero significa sem vencimento programado, mas ainda pode ser revogado).

### Configuração

No Vault, cadastrar `meta_app_id`, `meta_app_secret` e `meta_config_id`, vindos do aplicativo Meta e da configuração de login unificado. Nenhuma credencial deve estar no código ou no frontend. A URL de redirecionamento deve ser exatamente:

`https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/instagram-login`

O responsável autenticado gera um convite válido por 24 horas; gerar outro invalida o anterior ainda não usado. O destinatário vê o email do responsável e confirma que ele poderá publicar. A autorização usa estado de dez minutos com hash e verificador aleatório no navegador; o callback remove código/estado da URL e exige o verificador do navegador original. Estado e convite têm consumo único. O token nunca é enviado ao frontend.

Conexões unificadas usam o provedor facebook e graph.facebook.com, preservando fila e pausa para o mesmo Graph ID e proprietário. O cadastro bloqueia outro proprietário e uma troca silenciosa de provedor Instagram antigo. A API pública config informa apenas readiness e callback. O endpoint invite exige sessão válida no site.

### Verificação e limites

Testes cobrem parâmetros do login, seleção de ativos, app/tipo/validade do token, ausência de permissão e resposta vazia ou ambígua. Testes do callback cobrem consentimento e verificador do navegador. A aprovação de credenciais do app não comprova autorização de um Instagram: o cliente precisa concluir o diálogo real, e o fluxo completo só é confirmado após seu retorno. Para clientes sem função de teste no app, concluir as exigências de análise/acesso avançado da Meta. Tokens revogados exigem reconexão; não há renovação periódica nesta versão.
