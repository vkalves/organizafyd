# Google Agenda no Organizafy

A integração envia as tarefas do Organizafy para uma agenda escolhida por cada usuário. Criação, edição, conclusão e exclusão de tarefas entram em uma fila persistente no Supabase. O navegador tenta processar essa fila após salvar; o worker programado continua o trabalho quando o site está fechado.

O código sozinho não ativa a integração em produção. É necessário publicar a migração e a Edge Function, configurar um aplicativo OAuth no Google e guardar seus segredos no Supabase. Os segredos nunca devem aparecer no Git, nas variáveis `VITE_*` ou no chat.

## Comportamento

- Tarefas com prazo aparecem como eventos de dia inteiro. O fim é o dia seguinte, como exige a API do Google, sem conversão de fuso horário.
- Alterar título, descrição, prazo ou conclusão atualiza o mesmo evento. Tarefas concluídas recebem `✓` no título. O evento inclui um link para as tarefas no site.
- Excluir uma tarefa ou retirar seu prazo remove o evento criado pela integração. Outros eventos da agenda permanecem intactos.
- Tarefas sem prazo não recebem evento. Tarefas fixas diárias seguem o prazo salvo no site; esta integração não cria séries recorrentes no Google nem importa eventos Google para o site.
- Apenas agendas em que o usuário pode escrever aparecem na seleção. Trocar de agenda coloca a mudança na fila: os eventos vinculados são removidos na agenda anterior e recriados na nova em lotes, com novas tentativas se houver falhas.
- Desconectar revoga a autorização e interrompe a sincronização; os eventos já criados ficam no Google. Os mapeamentos ficam protegidos no servidor para evitar duplicatas em uma futura reconexão. Reconectar outra conta Google mantém os eventos da conta anterior e começa na agenda principal da nova conta.
- Falhas temporárias preservam as tarefas no site e mantêm a fila para novas tentativas. Autorizações revogadas exigem reconectar nas configurações.

## 1. Configurar o Google Cloud

1. No projeto Google Cloud da aplicação, habilite a **Google Calendar API**.
2. Configure a tela de consentimento OAuth com nome, suporte, contatos e domínio autorizado `organizafy.site`. Para contas pessoais, use audiência externa; durante os testes, adicione os usuários permitidos.
3. Adicione os escopos `https://www.googleapis.com/auth/calendar.events` e `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
4. Crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre exatamente esta URI de redirecionamento:

   ```text
   https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/google-calendar
   ```

5. Guarde o ID e o segredo do cliente nas configurações seguras do Supabase. Para disponibilidade aos usuários finais, publique a tela de consentimento e conclua a verificação exigida pelo Google para os escopos solicitados. Aplicativos externos em modo de teste podem ter refresh tokens que expiram em sete dias.

O redirecionamento do Google passa pela Edge Function e retorna somente para `https://www.organizafy.site/config`. O código OAuth e o estado passam por um fragmento temporário da URL e são retirados pelo frontend. A troca do código por tokens só acontece em um POST autenticado pelo usuário do site que iniciou a conexão.

## 2. Segredos da Edge Function

Configure em **Supabase → Edge Functions → Secrets**:

| Nome | Conteúdo |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | ID do cliente OAuth Web do projeto Google Cloud |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Segredo do mesmo cliente |
| `GOOGLE_CALENDAR_APP_URL` | `https://www.organizafy.site` |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Chave aleatória de exatamente 32 bytes, codificada em Base64 |
| `GOOGLE_CALENDAR_WORKER_SECRET` | Outro segredo aleatório, com pelo menos 32 caracteres e sem espaços, para autenticar o worker |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos automaticamente pelo runtime Supabase. Não os copie para o frontend. A chave de criptografia deve ser mantida enquanto houver contas conectadas: substituí-la sem migrar os tokens torna essas conexões ilegíveis.

Para gerar os dois valores aleatórios em arquivos locais protegidos, sem imprimi-los no terminal:

```bash
umask 077
openssl rand -base64 32 > /tmp/organizafyd-calendar-encryption-key
openssl rand -base64 32 > /tmp/organizafyd-calendar-worker-secret
```

Transfira cada valor ao campo apropriado nas configurações seguras e ao seu gerenciador de segredos. Não use os mesmos bytes para a criptografia e o worker. Remova os arquivos temporários após a configuração. Se usar `supabase secrets set --env-file`, mantenha esse arquivo fora do repositório, com permissão restrita, e não registre seu conteúdo em logs.

## 3. Publicar o banco e a função

Em uma sessão administrativa autorizada do Supabase, confira o projeto e os migrations pendentes antes de executar:

```bash
supabase link --project-ref csaplfphtvufxjhbpstl
supabase db push
supabase functions deploy google-calendar --project-ref csaplfphtvufxjhbpstl
```

O arquivo `supabase/config.toml` define `verify_jwt = false` somente para esta função, porque o GET de retorno OAuth vem do Google sem o token do site. Isso não torna suas ações públicas: todo POST do usuário valida explicitamente o bearer token com `supabase.auth.getUser`. O POST do worker exige seu segredo próprio. As tabelas de integração e suas RPCs são acessíveis apenas pelo serviço; OAuth state/PKCE são de uso único, expiram em dez minutos e os tokens são criptografados com AES-GCM vinculados ao usuário.

Para um teste local, use um cliente Google de desenvolvimento com o callback local apropriado e a URL local em `GOOGLE_CALENDAR_APP_URL`. CORS permite somente a origem configurada. Não configure simultaneamente vários domínios ou a URL de preview no cliente de produção.

## 4. Ativar o worker independente do navegador

O worker utiliza `pg_cron`, `pg_net` e Supabase Vault. As migrações anteriores do projeto já habilitam `pg_cron` e `pg_net`; confirme que as extensões e o Vault estão disponíveis no projeto antes de configurar o agendamento.

No **Supabase Vault**, crie o segredo chamado `google_calendar_worker_secret`, usando exatamente o valor de `GOOGLE_CALENDAR_WORKER_SECRET` das Edge Functions. Não use o segredo OAuth do Google nesse campo. Em seguida, um administrador pode executar no SQL Editor:

```sql
SELECT public.configure_google_calendar_worker(
  'https://csaplfphtvufxjhbpstl.supabase.co',
  (SELECT decrypted_secret
   FROM vault.decrypted_secrets
   WHERE name = 'google_calendar_worker_secret')
);
```

A RPC configura um único job `google-calendar-task-sync` por minuto e guarda a URL no Vault. O texto do job contém referências aos segredos, sem seus valores. Ela também atualiza um agendamento anterior com o mesmo nome. Depois de trocar o segredo do worker, atualize tanto a Edge Function quanto o Vault.

Os lotes usam uma trava por usuário, renovada antes dos pedidos ao Google, e limite de execução. A confirmação de cada tarefa confere a revisão da fila, preservando edições ocorridas durante uma sincronização. Um usuário que precisa reconectar não bloqueia os demais. Uma fila grande pode levar vários ciclos até ser concluída.

## 5. Validar a integração real

1. Publique o frontend e abra **Configurações → Google Agenda** no site. O estado deve indicar que a integração está disponível.
2. Conecte uma conta Google de teste e escolha uma agenda de teste em que a conta possa escrever.
3. Crie uma tarefa com prazo, confirme o evento de dia inteiro e confira seu título, descrição e link.
4. Edite o prazo e o título, conclua a tarefa, retire o prazo e finalmente exclua outra tarefa. Confirme cada alteração na agenda e que um evento criado manualmente permaneceu intacto.
5. Feche o site e faça uma alteração de teste no banco por uma sessão administrativa autorizada. Confirme que o worker processa a fila e a alteração chega ao Google.
6. Desconecte a conta: os eventos existentes devem permanecer. Reconecte a mesma conta e confira que não há duplicatas. Revogue a permissão no Google e confira que o site pede reconexão.

Os testes automatizados rodam sem contas ou rede externa:

```bash
npx vitest run --config supabase/functions/google-calendar/vitest.config.ts
npm test
npm run build
deno check supabase/functions/google-calendar/index.ts
```

O teste de banco `scripts/test-google-calendar-db.mjs` aceita o módulo PGlite
instalado fora do checkout via `PGLITE_MODULE`. Ele executa a migração em um banco
temporário e confere isolamento, gatilhos, revisões, locks e desconexão. A parte
de agendamento usa extensões simuladas; não valida uma instalação real de
`pg_cron`, `pg_net` ou Vault no projeto remoto.

Esses testes verificam autenticação, vinculação OAuth, PKCE, criptografia, idempotência, recuperação de eventos, fila e remoção de eventos. O teste real com Google depende das credenciais e da publicação acima; passar nos testes locais não confirma a ativação em produção.

## Diagnóstico

| Estado/código público | Ação |
| --- | --- |
| `google_calendar_not_configured` | Conferir a publicação da função e os quatro segredos Google/URL/criptografia. |
| `oauth_state_invalid` | Iniciar uma nova conexão estando autenticado na mesma conta do site. O estado expirou, foi usado ou pertence a outro usuário. |
| `google_refresh_token_missing` | Iniciar novamente a conexão e aceitar o consentimento. Se necessário, remover a autorização antiga no Google e reconectar. |
| `google_calendar_permission_required` | Conectar aceitando os dois escopos e conferir a configuração do consentimento. |
| `google_reconnect_required` | Reconectar a conta. Conferir também se o aplicativo Google está em modo de teste. |
| `calendar_not_writable` | Escolher uma agenda com permissão de edição. |
| `calendar_busy` | Aguardar a sincronização em andamento e tentar novamente. |
| `google_calendar_unavailable` / `sync_failed` | Conferir disponibilidade da API, API habilitada, limites e conectividade do servidor; a fila será preservada. |

Confira as execuções do cron e os resultados HTTP pelo painel Supabase. Os erros públicos da integração usam códigos fixos; não copie respostas de tokens, valores de Vault, logs sensíveis ou credenciais para o navegador ou para conversas de suporte.
