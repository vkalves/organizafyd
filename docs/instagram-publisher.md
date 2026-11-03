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

## Instagram Login e links para clientes

A conexão direta usa a função `instagram-login` e a página pública `/instagram/conectar`. O responsável autenticado gera um convite aleatório, válido por 24 horas, substituindo o convite anterior ainda não usado. O destinatário vê o email do responsável e confirma a autorização no Instagram. O convite inicia uma única autorização. O estado dura dez minutos, é armazenado com hash e vinculado a um verificador aleatório do navegador, guardado em sessionStorage. A troca consome o estado atomicamente. Código e estado são removidos da URL antes da troca. Tokens são trocados e armazenados exclusivamente no servidor.

### Ativação pelo administrador

1. No Vault do Supabase, criar `instagram_app_id` e `instagram_app_secret` com o **ID e segredo do aplicativo Instagram**, obtidos na configuração Instagram Login da Meta (não o token de um perfil). Também são aceitas as variáveis de ambiente `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`.
2. Cadastrar exatamente esta URL de redirecionamento OAuth no aplicativo Meta:
   `https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/instagram-login`
3. Autorizar `instagram_business_basic` e `instagram_business_content_publish`. Durante desenvolvimento, usar contas de teste autorizadas. Para atender clientes externos sem função no app, concluir o processo de análise/acesso avançado exigido pela Meta.
4. Testar Conectar meu Instagram com uma conta profissional; confirmar o @ retornado e depois um agendamento autorizado.

Sem ID e segredo, o botão fica desativado e a API retorna `not_configured`. A implantação não equivale à ativação ou aprovação da Meta. O fluxo real não foi validado enquanto essas credenciais estiverem ausentes.

Novas conexões OAuth usam graph.instagram.com; as anteriores continuam em graph.facebook.com. Uma coincidência de Graph ID entre os dois provedores exige migração explícita, sem trocar o token de uma fila ativa silenciosamente. A validade do token longo é registrada. Esta versão não implementa renovação periódica: reconectar pela autorização quando necessário. Links compartilhados dão acesso de publicação ao responsável exibido; não enviar tokens nem senha ao responsável.
