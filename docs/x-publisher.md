# Postagens automáticas no X

A área **X** (`/x`) permite conectar uma ou várias contas, enviar texto e mídia, escolher data/horário, pausar uma conta, cancelar agendamentos e acompanhar o resultado. O Supabase publica com o navegador fechado.

## Ativar uma vez

1. No [console de desenvolvedores do X](https://developer.x.com/), crie um aplicativo **Web App / Automated App** com OAuth 2.0 e permissão de escrita. Confira a cobrança e os créditos atuais antes de ativar publicações. Esta integração não compra créditos.
2. Cadastre o callback exato:

   `https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/x-publisher`

3. Use `https://www.organizafy.site` como Website URL. Se a implantação usar outro domínio, ajuste `X_APP_URL` para a origem real. Não inclua barra final.
4. Configure em **Supabase → Edge Functions → Secrets**:

| Nome | Valor |
| --- | --- |
| `X_CLIENT_ID` | Client ID OAuth 2.0 do aplicativo X |
| `X_CLIENT_SECRET` | Client Secret OAuth 2.0 |
| `X_APP_URL` | `https://www.organizafy.site` |
| `X_ENCRYPTION_KEY` | 32 bytes aleatórios codificados em Base64 |
| `X_WORKER_SECRET` | Outro segredo aleatório com pelo menos 32 caracteres, sem espaços |

Não use prefixo `VITE_` para esses segredos. Nunca coloque as chaves no GitHub ou na conversa. Para gerar chaves em arquivos temporários protegidos, sem exibir os valores:

```bash
umask 077
openssl rand -base64 32 > /tmp/organizafyd-x-encryption-key
openssl rand -base64 32 > /tmp/organizafyd-x-worker-secret
```

Transfira os valores diretamente aos campos seguros e ao seu gerenciador de senhas; apague os arquivos temporários após configurar. Mantenha a chave de criptografia: substituí-la exige migrar as credenciais existentes ou reconectar as contas.

5. Em uma sessão administrativa do Supabase, revise as migrações pendentes e publique:

```bash
supabase link --project-ref csaplfphtvufxjhbpstl
supabase db push
supabase functions deploy x-publisher --project-ref csaplfphtvufxjhbpstl
```

6. No **Supabase Vault**, crie o segredo `x_worker_secret` com o mesmo valor de `X_WORKER_SECRET`. No SQL Editor, execute:

```sql
SELECT public.configure_x_worker(
  'https://csaplfphtvufxjhbpstl.supabase.co',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'x_worker_secret')
);
```

O projeto usa `pg_cron`, `pg_net` e Vault. Confira essas extensões antes de configurar o job. A função cria ou atualiza um único job por minuto; os segredos não ficam no comando do cron. Se trocar o segredo do worker, atualize a Edge Function e o Vault.

7. Publique o frontend, abra **X → Conectar conta** e autorize a conta desejada. Os escopos usados são `tweet.read`, `tweet.write`, `users.read`, `offline.access` e `media.write`. Para adicionar outra conta, repita a conexão autenticando a conta correta no X. Não é necessário alterar o código.

## Como usar

- Selecione a conta e adicione texto, até 4 fotos JPG/PNG (5 MB cada) ou um vídeo MP4 (20 MB). Esse limite de vídeo é desta primeira implementação, para caber na execução da Edge Function. O X ainda valida duração, codec e demais limites do arquivo.
- Escolha o horário no fuso mostrado no formulário. O banco guarda UTC; a lista mostra o fuso do dispositivo.
- Clique em **Agendar postagem**. Cada clique confirma uma publicação única, sem recorrência automática.
- A verificação ocorre por minuto. Processamento de vídeo, limites da API e filas podem atrasar o horário. Cada ciclo processa no máximo um post por conta, respeitando um orçamento de execução de 90 segundos. O limite inicial da busca é 50 contas ativas.
- **Pausar** preserva os agendamentos. Ao retomar, os agendamentos atrasados também serão publicados. Cancele os que não quiser enviar antes de retomar.
- **Desconectar** apaga as credenciais locais e pausa a conta, preservando o histórico. Para revogar também a autorização no X, remova o aplicativo nas configurações do próprio X. Reconectar mantém a conta pausada até clicar em **Retomar**.
- Falhas confirmadas ficam em **Falhou**. Corrija a causa e crie outro agendamento. Não há repetição automática que possa gerar custos inesperados.
- Se o X não confirmar um envio, fica **Conferir no X**. Confira o perfil antes de recriar a postagem, pois ela pode ter sido publicada. Uma execução interrompida também recebe esse estado após cinco minutos. Não é reenviada automaticamente.
- A lista exibe as 200 postagens mais recentes. Os arquivos enviados são privados e ficam armazenados, inclusive após cancelar; esta versão não possui limpeza automática. Considere esse uso no custo do Storage.

## Proteções

Credenciais criptografadas com AES-GCM e vinculadas ao usuário. Tabelas e RPCs acessíveis apenas pelo serviço. Cada ação do navegador valida o login e o dono da conta. O retorno OAuth usa estado de uso único, PKCE e troca final autenticada pelo usuário que iniciou a conexão. CORS usa a origem configurada. Nenhum segredo é retornado ao navegador.

Uma trava por conta impede concorrência na renovação de tokens e no envio. Cancelamentos e início de publicação usam comparação atômica de estado. IDs gerados pelo cliente tornam reenvios da mesma solicitação de agendamento idempotentes. Como a API do X não fornece uma chave de idempotência de criação usada aqui, resultados incertos exigem conferência humana.

## Conferir antes de usar em produção

1. Conecte uma conta de teste e agende um texto para alguns minutos depois.
2. Feche o site e confira a publicação no perfil; reabra para confirmar **Publicado** e o link correto.
3. Teste uma foto e um vídeo MP4 curto compatível com o X.
4. Pause a conta e confira que não publica; cancele um agendamento e confira que não é enviado.
5. Reconecte a mesma conta e confirme que ela não é duplicada. Ao adicionar uma segunda conta no futuro, confirme que cada fila publica no perfil escolhido.
6. Confira o job `x-publisher` e os retornos HTTP no Supabase. Não compartilhe credenciais, respostas de tokens ou dados do Vault nos logs.

Os testes locais não publicam no X. A validação real depende da configuração e das credenciais acima.

Documentação oficial consultada: [OAuth 2.0](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [criação de posts](https://docs.x.com/x-api/posts/create-post), [inicialização de mídia](https://docs.x.com/x-api/media/initialize-media-upload), [envio de partes](https://docs.x.com/x-api/media/append-media-upload), [finalização](https://docs.x.com/x-api/media/finalize-media-upload) e [estado da mídia](https://docs.x.com/x-api/media/get-media-upload-status).

## Testes locais

```bash
npx vitest run src/pages/XPublisher.test.tsx
npx vitest run --config supabase/functions/x-publisher/vitest.config.ts
PGLITE_MODULE=/caminho/externo/pglite/dist/index.js node scripts/test-x-publisher-db.mjs
npm run build
deno check supabase/functions/x-publisher/index.ts
```

O script de banco usa PGlite instalado fora do repositório. Cron, Storage e Vault usam estruturas simuladas apenas nesse teste; a ativação real dessas extensões precisa ser conferida no Supabase.

## Agendamento em lote e limpeza de metadados

Na área **Em lote**, use **Adicionar postagem** para criar cartões independentes. As postagens ficam em uma lista lateral (horizontal no celular); selecione uma para editar. Apenas um editor aparece por vez, e trocar de post preserva os rascunhos. Importação de arquivos e adição ficam no topo; os preenchimentos gerais ficam recolhidos em **Opções do lote**. Cada cartão permite definir conta, data e horário exatos, legenda e mídias: até quatro fotos ou um vídeo, ou apenas texto. É possível trocar/remover arquivos, mudar a ordem das fotos, duplicar/remover cartões e reorganizá-los sem alterar seus horários. O limite é de 30 postagens e 200 MB no lote; cada foto tem limite de 5 MB e cada MP4, 20 MB, inclusive depois da limpeza.

Em **Importar arquivos**, escolha **Fotos juntas em um carrossel** para criar uma única postagem com até quatro fotos, ou **Um arquivo por postagem separada** para importar posts individuais. No editor, **Adicionar fotos ao carrossel** acrescenta fotos ao mesmo post e mostra o contador de 0 a 4, sem criar novas postagens. A importação de vários arquivos como posts separados é opcional. O preenchimento por primeiro horário/intervalo só modifica os cartões quando você clica em **Preencher horários dos cartões**. Depois disso, cada horário continua editável. A conta para novos posts e a legenda de preenchimento não alteram cartões existentes automaticamente. O envio utiliza os detalhes exatos de cada cartão e valida todos antes de iniciar; não recalcula horários pela posição no lote. Durante o processamento e novas tentativas, os detalhes ficam bloqueados para preservar os mesmos agendamentos e evitar duplicações.

A limpeza também é automática no compositor individual. Fotos são decodificadas respeitando a orientação e reconstruídas em um canvas sRGB, sem copiar EXIF, GPS, XMP, comentários ou outros dados do arquivo original. Vídeos são decodificados e recodificados por FFmpeg WebAssembly em um worker local: apenas o primeiro vídeo e áudio são mantidos, sem copiar metadados globais, de faixas, capítulos ou fluxos de dados. O arquivo recebe nome neutro. Resolução, duração, codecs e outros dados técnicos necessários continuam presentes; o conteúdo visível ou audível não é anonimizado. A recodificação pode alterar qualidade e tamanho. Arquivos já enviados/agendados antes desta atualização não são alterados.

O core de vídeo é servido pelo próprio site e carregado sob demanda. A mídia original permanece no dispositivo durante a limpeza; somente o resultado limpo é enviado ao Storage. Uma falha na limpeza impede o upload/agendamento daquele arquivo. Não há fallback para enviar o original. Vídeos têm limite de processamento de 3 minutos e limite total de 4 minutos (incluindo carregamento). Fotos são limitadas a 40 megapixels.

Mantenha a guia aberta até concluir. Cada item é confirmado individualmente; o lote não é uma transação única. A interface mostra falhas parciais e permite continuar os pendentes, preservando UUID e mídia enviada para evitar duplicação de uma resposta ambígua. Itens já confirmados são ignorados em novas tentativas. É possível parar após o arquivo atual. A composição do lote fica em memória: ao recarregar ou fechar, confira a fila antes de recriar itens pendentes. O botão de encerrar lote não cancela posts já agendados. A integração usa a ação `schedule` existente; esta atualização não exige nova migração nem novo deploy da Edge Function.

Também é possível arrastar arquivos do computador e soltá-los na área de mídia da postagem individual ou do post selecionado no lote. O destaque mostra onde soltar. As fotos são acrescentadas às existentes no mesmo post; permanecem os limites de quatro fotos ou um vídeo e a limpeza automática. Arquivos inválidos ou em excesso são recusados sem apagar os já selecionados. O recebimento fica bloqueado durante o processamento.


### Segunda etapa de limpeza
Depois da reconstrução, uma verificação binária remove todos os segmentos APP/COM do JPEG (incluindo EXIF, XMP, IPTC e perfis ICC) e conserva no PNG somente pixels, paleta, transparência e informações padrão de renderização sRGB. Dados após o fim das imagens também são descartados. O canvas converte a imagem para sRGB antes dessa etapa.

Nos vídeos H.264, o filtro `filter_units=remove_types=6` remove SEI, incluindo identificação do codificador e legendas embutidas nesse formato; `asidedata=delete` descarta dados auxiliares de áudio. Depois da recodificação, caixas MP4 de metadados (`udta`, `meta`, `uuid`) e preenchimento são zeradas, assim como datas de criação/modificação e nomes de faixas. As posições dos dados de áudio/vídeo permanecem intactas. A verificação é exclusiva da saída recodificada, não um limpador genérico de arquivos arbitrários.

Arquivos inválidos nessa verificação são bloqueados. Isso não promete anonimato nem remove marcas d'água, texto visível, rostos, vozes ou conteúdo oculto nos próprios pixels/áudio. Dados técnicos necessários à reprodução permanecem. Vale para novos envios; arquivos anteriormente agendados não são reprocessados.
