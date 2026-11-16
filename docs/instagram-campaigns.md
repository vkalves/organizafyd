# Campanhas automáticas do Instagram

Em **Instagram → Fluxos**, escolha as mídias e contas e configure:

- **Repetir campanha em loop**: um novo ciclo começa depois de todas as contas
  terminarem a lista. A distribuição entre contas permanece estável nos ciclos.
  Cada vídeo aparece uma vez na lista de cada conta por ciclo. No modo dividido,
  cada conta recebe somente sua parcela da seleção.
- **Evitar mídias já usadas ou reservadas**: consulta o histórico por conta,
  incluindo publicações de outros fluxos e postagens avulsas. Uma mídia fica
  disponível para outras contas que ainda não a utilizaram. Em loop, a própria
  campanha pode reutilizá-la no ciclo seguinte, depois de concluir o anterior.
- **Descansar entre lotes**: após N publicações confirmadas por conta, soma um
  descanso ao espaçamento normal. O contador continua entre ciclos. No modo GAP,
  o descanso é somado ao intervalo configurado. Em horários fixos, o descanso é
  contado a partir da confirmação real e a próxima publicação usa o primeiro
  horário da lista que venha depois do fim do descanso. A fila também mantém o
  piso mínimo de três minutos entre confirmações reais.
- **Legendas sorteadas por pasta**: separe as opções por uma linha `---`.
  A legenda individual da mídia tem prioridade, seguida do sorteio da pasta,
  das variações alternadas e da legenda padrão. A campanha guarda uma cópia das
  opções da criação; editar preferências depois não muda campanhas existentes.
- **Pausar / Retomar / Encerrar campanha**: a pausa conserva a fila. Encerrar
  cancela os envios ainda agendados e impede novos ciclos. Uma chamada de
  publicação que já foi enviada à Meta pode terminar antes da pausa efetivar.

Falhas e resultados incertos pausam o avanço da campanha para revisão; não há
reenvio automático de uma publicação com resultado incerto. A biblioteca não é
mais apagada automaticamente. Publicações anteriores ao registro do site ou
mídias enviadas como arquivos diferentes não são identificadas por conteúdo:
a proteção usa o endereço da mídia e a conta no histórico armazenado.

## Instalação e validação

### Limpeza em cada publicação

Cada nova publicação de um fluxo entrega a mídia à Meta por `instagram-media`,
com endereço assinado exclusivo do job e validade de uma hora. Cada download
executa novamente a remoção de metadados: EXIF/comentários em fotos e capas;
tags, datas e nomes do contêiner MP4 em vídeos. Os vídeos já passaram pela remoção
de SEI do codec no upload; esta segunda passagem preserva áudio, quadros e offsets,
sem nova recodificação. Não altera os arquivos da biblioteca nem cria cópias.

Vale também para campanhas ativas já existentes, próximas horas e novos ciclos.
Não muda o intervalo configurado: uma campanha de hora em hora faz a nova limpeza
em cada envio. Contêineres que a Meta já recebeu antes da atualização continuam
seu processamento; a consulta de status não recria uma postagem.

Publique **primeiro** a nova Edge Function `instagram-media` com `verify_jwt=false`
conforme `supabase/config.toml`, e depois `instagram-publisher`. O endpoint público
valida HMAC e expiração antes de acessar Storage; não aceita URLs externas. Reutiliza
os secrets existentes, sem migração SQL, novo cron ou alteração do frontend.
Falhas nunca redirecionam para o arquivo original. A entrega suporta HEAD e ranges,
aplicados após a limpeza, e impede cache. O processamento de MP4 é em streaming,
com limite de 100 MB por arquivo e 8 MB para o índice `moov`.

Testes locais: `npx vitest run src/features/instagram-publisher/media-delivery.test.ts src/features/x/strip-metadata.test.ts`.
Antes de ativar em produção, valide a criação e o processamento de um contêiner
com mídia autorizada na Meta; os testes locais simulam o download da Meta e não
publicam em contas reais.

1. Faça um backup do banco e Storage de produção pelo painel Supabase antes de
   aplicar migrações. O backup criado nesta tarefa é do código/checkout local;
   ele não contém uma cópia do banco nem dos arquivos remotos de produção.
2. Aplique `20261106000000_instagram_campaigns.sql` pelo fluxo de migrações do
   projeto, depois das migrações existentes.
3. Publique a Edge Function `instagram-publisher` com os novos arquivos. O cron
   existente continua usando `worker`; não precisa criar outro agendamento.
4. Publique o frontend. Se o serviço de campanhas ainda não estiver disponível,
   a interface conserva os fluxos simples e bloqueia as opções avançadas.

Validar sem publicar em contas reais:

```sh
npm run build
npx vitest run src/features/instagram-publisher --maxWorkers=2
# Instale @electric-sql/pglite em uma pasta temporária fora do checkout.
PGLITE_MODULE=/caminho/absoluto/pglite/dist/index.js node scripts/test-instagram-campaigns-db.mjs
```

O teste de banco usa uma base descartável: valida migração, isolamento por
usuário, reserva sem duplicação, pausa, retomada, parada, idempotência de ciclos,
descanso baseado em confirmações reais e preservação de mídias. Nenhum teste
acessa o Instagram, o banco remoto ou seus tokens.

## Backup e volta à versão anterior

Versão anterior: `66902ecf0d1714b4bf611ad3ac3c078326e38cd2`.
Branch local de recuperação: `backup/before-instagram-campaigns-66902ec`.

Nesta máquina, o histórico completo está em
`/workspace/backups/organizafy-before-campaigns/repository.bundle`, verificado
por `git bundle verify`. O arquivo `checkout.tar.gz` na mesma pasta conserva o
checkout anterior, incluindo os arquivos locais, exceto dependências e build.
Esses arquivos têm acesso restrito e não devem ser publicados como assets.

Para recuperar o código em outra pasta:

```sh
git clone /workspace/backups/organizafy-before-campaigns/repository.bundle /workspace/organizafy-restaurado
git -C /workspace/organizafy-restaurado checkout backup/before-instagram-campaigns-66902ec
```

Para voltar o site depois da instalação, pause/encerre as campanhas antes de
republicar o frontend e a Edge Function da branch de recuperação. Não apague
colunas ou histórico: a migração é aditiva. Para desativar todos os loops sem
apagar dados, um administrador pode executar numa transação:

```sql
begin;
update public.ig_flows set state='stopped', settings=jsonb_set(settings,'{repeat}','"once"'::jsonb)
where settings->>'repeat'='loop';
update public.ig_publication_jobs j set status='cancelled'
where j.status='scheduled' and exists(select 1 from public.ig_flows f where f.id=j.flow_id and f.state='stopped');
commit;
```

Isso não desfaz posts já publicados no Instagram. O código anterior pode voltar
a remover mídias concluídas automaticamente; mantenha o backup remoto de Storage
ou preserve a função `ig_retire_flow_media` atual, que não apaga a biblioteca.
