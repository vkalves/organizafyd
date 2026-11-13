# Atraso aleatório por postagem no GAP

No configurador **Intervalo (GAP)**, a opção **Atraso aleatório de 1 a 5 minutos
por postagem** vem ativada para novos fluxos. Cada publicação recebe um novo
sorteio independente de 60 a 300 segundos após seu horário base. A mesma conta
pode receber um minuto na primeira postagem, quatro na segunda e dois na terceira.
O sorteio independe da opção de embaralhar as mídias.

O horário base do GAP e os descansos entre lotes ficam salvos separadamente.
As próximas execuções usam esses horários para evitar acúmulo dos atrasos. A
fila respeita a ordem dos horários base mesmo quando dois alvos se sobrepõem.
O intervalo mínimo de segurança de três minutos por conta permanece; atrasos
operacionais, indisponibilidade ou intervalos curtos podem adiar o envio efetivo.
O atraso de 1 a 5 minutos define o alvo de agendamento, não uma garantia de
horário de publicação pelo Instagram.

Contas adicionadas depois recebem novos sorteios por publicação, sem herdar o
atraso das contas existentes. A regra de pular a próxima postagem continua
usando o horário base. Fluxos existentes sem essa opção não são alterados, os
agendamentos já criados não são reescritos e os horários fixos mantêm seu
comportamento atual. Reutilizar um fluxo preserva o valor salvo da opção.

## Publicação

Aplicar `20261113123501_gap_account_delay.sql`, publicar `instagram-publisher`
com o `flow.ts` atualizado e publicar o frontend. A migração adiciona a coluna
opcional `ig_publication_jobs.flow_base_at` e atualiza criação, sincronização,
avanço de ciclos, progresso e seleção de publicações. As permissões existentes
das funções são preservadas. A opção fica em `settings.gapPostDelay`.
