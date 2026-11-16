# Recuperação segura das postagens de Fluxo

A manutenção preserva os jobs enquanto uma conta está pausada, com token vencido,
aguardando reconexão ou com saúde temporariamente indisponível. A autorização do
destino é validada separadamente: remover uma conexão ou revogar uma conta
compartilhada continua cancelando os envios não publicados.

A função `ig_recover_publication_leases` também roda na manutenção a cada minuto.
Ela recupera até 250 leases expirados por chamada, mesmo quando não há jobs
agendados para iniciar workers. Se `publish_started=true`, o resultado permanece
incerto, sem reenvio automático. Campanhas encerradas não são retomadas.

O publicador consulta `content_publishing_limit` e usa a cota devolvida pela Meta,
sem presumir uma quantidade fixa por dia. Quando esgotada, o job é adiado por 15
minutos. Conexões antigas sem acesso a essa consulta mantêm a publicação normal;
a checagem final de pausa da conta/campanha acontece depois da consulta de cota.

Erros transitórios anteriores a `media_publish` continuam pendentes mesmo após
30 tentativas. O orçamento de 30 consultas de processamento de vídeo usa um
contador separado (`container_checks`). Código 4 adia todas as conexões do mesmo
App ID; conexões antigas sem App ID são agrupadas pelo provedor. Apps diferentes
mantêm suas filas independentes. Em resultados incertos, o bloqueio de reenvio
continua valendo. Erros novos registram código, subcódigo, etapa, trace ID e
mensagem sanitizada em `last_error_details`, sem token ou URL assinada completa.

Horários fixos usam o intervalo mínimo de três minutos, independentemente de
um GAP residual no cadastro. A política de espaçamento entre fluxos diferentes
não é alterada por esta atualização; a coordenação adicional é pela cota e App ID.

## Implantação

1. Aplicar a migração `flow_queue_recovery`.
2. Publicar `instagram-publisher`, incluindo `publication-policy.ts`.
3. Conferir manutenção, estados de jobs e respostas da Meta.

As alterações de banco são aditivas; a migração não restaura automaticamente
nenhum job cancelado ou com falha. Os novos RPCs são exclusivos de service_role.
Não exige alteração da interface nem novos secrets.

## Restaurar filas antigas

`ig_restore_flow_jobs` exige dono, fluxo ativo, contas específicas e simulação
inicial. Não pode ser chamada por anon/authenticated. O modo `account_unavailable`
aceita apenas cancelamentos automáticos sem tentativa, contêiner ou publicação.
O modo `transient_before_publish` aceita apenas falhas transitórias anteriores à
publicação e sem contêiner. Ambos recusam mídias ausentes, contas indisponíveis,
contas fora do fluxo e arquivos com publicação pendente/incerta ou já concluída
no histórico pertinente. Campanhas pausadas/encerradas e horários fixos exigem
outro planejamento e não são retomados por esse RPC.

Antes de executar: salvar cópia restrita dos registros originais, conferir a
simulação e enviar exatamente o total esperado em `p_expected`. Uma mudança de
contagem aborta a transação. Os horários são deslocados para o futuro, mantendo
as diferenças originais entre arquivos e respeitando filas já existentes. O
primeiro envio fica a pelo menos cinco minutos da recuperação. Reexecutar a
mesma operação não recupera novamente os jobs já agendados.

As publicações incertas não são restauradas: conferir o contêiner e o Instagram
antes de qualquer decisão. Não reativar genericamente todos os cancelados.

## Verificação local

```sh
npx vitest run src/features/instagram-publisher/flow-recovery-db.test.ts src/features/instagram-publisher/publication-policy.test.ts src/features/instagram-publisher/publication.test.ts --testTimeout=20000
npm run test:capacity
```

Os testes verificam preservação em pausas, expiração e reconexão; revogação real;
recuperação sem worker; proteção contra reenvios; quota e App ID; restauração com
simulação, contagem, espaçamento e deduplicação; grants; e concorrência em um
Postgres descartável. Não publicam conteúdo em contas reais.
