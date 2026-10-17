# TikTok Fotos — ativação do Organizafy

Implementação oficial para fotos e carrosséis em `/tiktok`. Cada cliente entra no Organizafy e conecta sua própria conta. Não utiliza senha de TikTok, bot Android, Metricool ou outro publicador intermediário. A configuração e a aprovação ainda precisam ser concluídas: código no GitHub não significa integração liberada.

## 1. Publicar e completar as páginas públicas

Publique o frontend na Vercel pelo processo já usado pelo projeto. Em **Vercel → Settings → Environment Variables**, adicione:

| Variável | Valor |
| --- | --- |
| `VITE_LEGAL_OPERATOR` | Nome real/razão social do responsável pelo serviço; inclua CPF/CNPJ e endereço comercial quando aplicável às suas condições |
| `VITE_SUPPORT_EMAIL` | Um email de suporte e privacidade que você realmente acompanha |

Esses dois valores são públicos, incluídos no frontend. Faça um novo deploy depois de alterá-los. Não coloque tokens neles. Revise os textos de privacidade e termos contra suas práticas reais, sua contratação e os demais módulos do produto. As páginas fornecem uma base operacional; os dados legais e comerciais do proprietário não foram inventados.

Abra em janela sem login:

| Campo do portal | URL proposta |
| --- | --- |
| Website URL | `https://www.organizafy.site/sobre` |
| Terms of Service URL | `https://www.organizafy.site/termos` |
| Privacy Policy URL | `https://www.organizafy.site/privacidade` |
| Instruções de exclusão | `https://www.organizafy.site/exclusao-de-dados` |
| Contato | `https://www.organizafy.site/contato` |

Use o domínio real da implantação se for diferente. Não envie a solicitação com o aviso de identificação/email ainda pendentes. A página Sobre apresenta o serviço, recursos, fluxo e acesso ao produto; o site não se limita a uma tela de login. As condições de compra/cancelamento e suporte precisam corresponder ao produto vendido. A apresentação informa honestamente que a integração está em preparação. Após aprovação e teste real, atualize esse estado para refletir a disponibilidade.

## 2. Criar o aplicativo Web no TikTok

1. Entre em https://developers.tiktok.com/ e abra **Manage apps**.
2. Crie o aplicativo com nome consistente com o site (Organizafy), ícone e descrição real do produto.
3. Selecione **Web** e informe os endereços acima.
4. Adicione **Login Kit** e **Content Posting API**.
5. Habilite **Direct Post** e solicite `video.publish`. Essa permissão também publica fotos; esta implementação não usa `video.upload` ou `user.info.basic`.
6. Cadastre o **Redirect URI** exato no Login Kit:

   `https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/tiktok-publisher`

7. Use o Sandbox para a primeira demonstração, com sua conta de teste autorizada. Credenciais e configurações de Sandbox e Production podem ser diferentes: use o conjunto correspondente ao ambiente que estiver testando.

Não descreva o sistema como “ilimitado” ou ferramenta exclusiva da agência. Ele deve realmente atender os clientes do serviço, com autorização individual de suas contas e conteúdo original. Não há garantia de aprovação.

## 3. Configurar os segredos no Supabase

Em **Supabase → Edge Functions → Secrets**:

| Nome | Valor |
| --- | --- |
| `TIKTOK_CLIENT_KEY` | Client key do aplicativo/ambiente TikTok |
| `TIKTOK_CLIENT_SECRET` | Client secret do mesmo aplicativo/ambiente |
| `TIKTOK_APP_URL` | `https://www.organizafy.site` — somente origem HTTPS, sem caminho e sem barra final |
| `TIKTOK_ENCRYPTION_KEY` | 32 bytes aleatórios, codificados em Base64 |
| `TIKTOK_WORKER_SECRET` | Outro segredo aleatório, com pelo menos 32 caracteres e sem espaços |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos pelo ambiente das Edge Functions. Nunca coloque segredos em variáveis com prefixo `VITE_`, no GitHub ou em mensagens. Gere e transfira os segredos por um gerenciador seguro. Preserve a chave de criptografia: trocar exige migrar as credenciais ou reconectar as contas.

A Vercel também precisa de **`VITE_SUPABASE_URL`**, já usado pelo frontend. A rota de entrega de imagens utiliza esse endereço no servidor; não precisa de service role na Vercel.

## 4. Aplicar o banco e publicar a função

Em um terminal autenticado no Supabase, a partir do repositório:

```bash
supabase link --project-ref csaplfphtvufxjhbpstl
supabase db push
supabase functions deploy tiktok-publisher --project-ref csaplfphtvufxjhbpstl
```

Confira as migrações pendentes antes de executar `db push`. A nova migração é `20261017000000_tiktok_publisher.sql`. Ela cria tabelas isoladas por proprietário, funções de trava, fila e bucket `tiktok-media`. As tabelas não são acessíveis diretamente pelo navegador; as ações autenticadas da Edge Function verificam o usuário e o dono da conta.

Fotos neste bucket têm URLs públicas de nomes aleatórios. Isso é informado antes da autorização e na Política de Privacidade. Não envie arquivos confidenciais. Downloads públicos não exigem login. Cada imagem preparada tem até 4 MB para caber na rota de entrega da Vercel. Uploads são imutáveis; clientes não podem sobrescrever nem apagar fotos de uma fila em execução.

## 5. Verificar os domínios e URLs

No portal TikTok, abra **URL properties** e verifique as URLs exigidas na configuração e o domínio usado para buscar as fotos.

- As fotos são entregues por `https://www.organizafy.site/api/tiktok-media?path=...`.
- Verifique o domínio exato `www.organizafy.site` (não apenas um domínio diferente ou o domínio sem `www` se ele não cobrir esse host).
- Se o portal pedir verificação DNS, adicione o registro fornecido no painel DNS do domínio e confirme.
- Se pedir um arquivo de assinatura, copie o arquivo original, sem alterar nome/conteúdo, para o caminho em `public/` correspondente à URL solicitada e publique novamente. Abra a URL e confira que retorna o texto original, e não o HTML da aplicação.
- A configuração Vercel prioriza arquivos e funções existentes antes do fallback da SPA, inclusive o arquivo de verificação.
- Se mudar o domínio do frontend, atualize `TIKTOK_APP_URL`, os endereços do portal e a verificação de propriedade.

A rota só aceita caminhos de fotos no bucket fixo. Não é um proxy de URLs arbitrárias. Antes do pedido de revisão, teste uma URL real retornada para suas fotos e confirme `200`, conteúdo JPEG e ausência de redirecionamento/login.

## 6. Ativar a execução com o site fechado

No Supabase, habilite **pg_cron**, **pg_net** e **Vault**. No Vault, crie `tiktok_worker_secret` com o mesmo valor de `TIKTOK_WORKER_SECRET`.

No SQL Editor administrativo:

```sql
SELECT public.configure_tiktok_worker(
  'https://csaplfphtvufxjhbpstl.supabase.co',
  (SELECT decrypted_secret
   FROM vault.decrypted_secrets
   WHERE name = 'tiktok_worker_secret')
);
```

Isso configura um único job `tiktok-publisher`, a cada minuto. O job usa o Vault para não guardar o segredo no texto do cron. Se trocar o segredo, atualize a Edge Function e o Vault.

A verificação por minuto não garante publicação no segundo exato. O TikTok também processa e modera o conteúdo. Cada ciclo tem orçamento de 90 segundos, busca até 50 contas elegíveis, acompanha até duas publicações em processamento e inicia no máximo uma postagem nova por conta. Ciclos seguintes continuam a fila. Esses são limites desta implementação, além dos limites do TikTok e da hospedagem.

## 7. Testar o fluxo completo

1. Faça login no Organizafy e abra **TikTok**, em nova guia.
2. Clique **Conectar conta**, entre no TikTok e autorize `video.publish`.
3. Selecione a conta: o painel busca suas opções atuais no TikTok.
4. Adicione fotos. O sistema prepara JPG, com até 2160 px no lado maior, sem recortar; transparência recebe fundo branco. Veja as prévias, ajuste ordem, capa, título e descrição.
5. Selecione privacidade manualmente. Durante teste sem auditoria, use conta privada e “Somente eu”; não há troca automática para público.
6. Configure comentários, música recomendada, conteúdo comercial e identificação de IA quando aplicável. Por padrão, essas opções ficam desmarcadas.
7. Escolha o horário no fuso exibido, revise e marque a autorização. Clique **Autorizar e agendar**.
8. Mantenha a guia aberta até confirmar o agendamento. Depois pode fechá-la: o worker executa no servidor.
9. Confira **Agendado → Enviando → Processando no TikTok → Publicado** e confirme a postagem no perfil.
10. Teste cancelamento antes do envio, pausa, reconexão, uma segunda conta e isolamento entre dois usuários Organizafy. Teste também excluir os dados com uma conta de teste.

Se o envio não for confirmado, consulte a fila e use **Continuar o mesmo envio**: o UUID impede criar outro agendamento igual. Não abra outro rascunho antes de conferir se o anterior entrou na fila. Falhas no preparo das fotos impedem enviar os originais como fallback.

## 8. Gravar e enviar a revisão

Grave a integração real no domínio cadastrado, usando Sandbox na primeira solicitação. Mostre:

- Página pública, entrada no produto e conexão da conta.
- Nome da conta conectado e opções de privacidade carregadas do TikTok.
- Seleção, prévia, ordem, capa, título e descrição das fotos.
- Configurações de comentários, música, IA e divulgação de conteúdo comercial.
- Declarações de música e de parceria paga, quando aplicável.
- Autorização expressa, agendamento, fila e resultado real no TikTok.
- Desconexão e opção de exclusão de dados.

No **App review**, descreva produtos, permissão `video.publish`, armazenamento e fluxo de agendamento. Informe que o cliente aprova cada postagem e que o servidor a envia no horário selecionado. Forneça acesso de demonstração gratuito aos revisores se solicitado. Não esconda que é um serviço comercial para clientes. O agendamento também será avaliado no fluxo completo; não presuma aprovação antecipada.

Envie a revisão do aplicativo e conclua a auditoria exigida pelo Direct Post para remover a restrição a posts privados. A documentação indica alguns dias a duas semanas para a análise do aplicativo, sem garantir prazo de auditoria. Se houver recusa, siga os comentários do portal. Depois de aprovado, configure credenciais Production, confira URLs/permissões, reconecte a conta e faça teste público controlado antes de liberar aos clientes.

## Operação e limitações

- Fotos: 1–35 por postagem; título até 90 e descrição até 4000 unidades UTF-16. Limites conferidos contra a documentação oficial consultada em 17/10/2026.
- Música: opção de música recomendada pelo TikTok; não há busca por qualquer música da biblioteca nesta implementação.
- Contas: pausa preserva a fila; retomar também envia posts atrasados. Cancele os indesejados antes.
- Desconectar tenta revogar no TikTok, remove credenciais locais e pausa. Você também pode revogar manualmente no TikTok. Histórico e imagens só são removidos em **Excluir meus dados do TikTok**.
- Cancelar não apaga imagens. Fotos e histórico acumulam uso de armazenamento até exclusão do módulo. Não existe limpeza periódica automática nesta versão.
- Excluir dados remove o módulo TikTok do usuário. Posts recebidos pelo TikTok, outros módulos e a conta Organizafy não são apagados. Uma publicação em andamento pode terminar; consulte o próprio TikTok.
- A fila mostra até 200 registros. Nenhum resultado incerto é reenviado automaticamente. Se o servidor parar após enviar e antes de guardar `publish_id`, a postagem fica **Conferir no TikTok** após cinco minutos.
- Conteúdo com `publish_id` fica em acompanhamento, sem ser reenviado. Pode levar tempo para o TikTok terminar a moderação. Pausar/desconectar também suspende o acompanhamento até retomar/reconectar.
- Testes locais não comprovam publicação real, aprovação ou configuração do Supabase/Vercel. Nenhuma chave real foi usada para publicar durante a implementação.
- Sem assinatura de intermediário não significa infraestrutura gratuita ou TikTok ilimitado. As cotas do TikTok e dos provedores continuam aplicáveis.

## Verificações locais

```bash
npm ci
npm run build
npx vitest run src/pages/TikTokPublisher.test.tsx
npx vitest run --config supabase/functions/tiktok-publisher/vitest.config.ts
PGLITE_MODULE=/caminho/externo/pglite/dist/index.js node scripts/test-tiktok-publisher-db.mjs
```

Fontes oficiais: [cadastro do aplicativo](https://developers.tiktok.com/docs/en/getting-started-create-an-app), [revisão](https://developers.tiktok.com/docs/en/app-review-guidelines), [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web), [fotos](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post), [regras de publicação](https://developers.tiktok.com/docs/en/content-sharing-guidelines), [tokens](https://developers.tiktok.com/docs/en/oauth-user-access-token-management) e [status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status).

## Resultado das verificações desta alteração

- Build de produção concluído.
- 21 testes do módulo passaram: interface, consentimento, isolamento de contas, OAuth, envio/polling, prevenção de duplicação e proxy de imagens.
- Verificações do banco passaram em PGlite: propriedade, permissões, mídia, travas, cancelamento e configuração de cron. Extensões reais e publicação remota ainda precisam ser testadas no Supabase.
- A suíte geral apresentou duas falhas já reproduzidas no código original: checklist de notas e progresso de subtarefas. A checagem TypeScript geral também encontra tipos antigos de `mind_maps` não incluídos no schema gerado. Esses pontos não foram modificados nesta tarefa; a checagem isolada do backend TikTok passou.
- Não houve teste com conta TikTok real nem confirmação de implantação na Vercel.
