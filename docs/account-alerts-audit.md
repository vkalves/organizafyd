# Auditoria dos alertas de contas

Revisão em 17/11/2026. Escopo: navegação, central de alertas, sino,
Edge Function `instagram-monitor`, classificação das respostas da Meta,
rotina agendada, armazenamento e isolamento entre usuários.

## Funcionamento observado em produção

A rotina cron está ativa e dispara o worker a cada minuto. O banco reserva até
20 contas por execução, com uma próxima checagem em cinco minutos e uma lease
por conta. O worker consulta os perfis em grupos de cinco, com timeout de oito
segundos por chamada à Meta. Tokens são lidos do Vault e enviados somente no
cabeçalho Authorization.

Na consulta inicial, as 89 conexões tinham registro de monitoramento:
87 com resposta positiva e duas com erro `meta_100` repetido. Nenhuma estava
atrasada por mais de dez minutos ou sem primeira verificação. Os alertas ativos
correspondiam aos estados armazenados. Isso descreve aquela consulta, não uma
garantia permanente de disponibilidade.

O worker usa uma chave própria; ações do usuário validam o JWT e a aprovação da
conta. Tabelas possuem RLS e leitura por proprietário. O serviço faz gravações
filtradas pelo usuário autenticado; o navegador não pode criar estados de saúde
ou alertas diretamente. O diagnóstico não retorna tokens, IDs de segredos ou
chaves do worker.

## Problemas encontrados e correções

| Problema anterior | Consequência | Correção |
| --- | --- | --- |
| Rota de alertas ausente no menu | Módulo acessível apenas pelo sino ou links indiretos | Destino **Alertas de contas** no menu expandido, recolhido e móvel |
| Contagem de contas saudáveis por subtração | Contas desconhecidas, sem checagem ou com consulta falhando pareciam operacionais | Contagem exige resposta positiva recente, sem falha em confirmação e sem reconexão pendente |
| Erros de consulta sem estado de erro visível | Tela vazia afirmava que tudo estava funcionando | Aviso explícito, indicadores indisponíveis e preservação do diagnóstico anterior |
| `Promise.allSettled` ignorava rejeições na leitura em lote | Anunciava leitura bem-sucedida mesmo quando falhava | Uma atualização atômica no servidor, apenas dos alertas ativos e não lidos do proprietário, com contagem real |
| Refetch não lançava erro por padrão | Atualização anunciava sucesso após falha | Refetch com `throwOnError` e mensagens separadas de sucesso e falha |
| Atualizar status não consultava a Meta | Usuário acreditava ter executado um diagnóstico novo | **Atualizar lista** recarrega os registros; **Verificar conta** executa uma consulta autenticada daquele perfil |
| Histórico limitado aos 100 alertas mais recentes | Muitos eventos resolvidos podiam esconder problemas ativos antigos | Alertas ativos e estados de saúde paginados separadamente; limite de 100 apenas para o histórico encerrado |
| Reconexão exigida podia perder para um estado saudável anterior | Etiqueta positiva apesar da credencial já recusada | Flag de reconexão tem precedência sobre a checagem anterior |
| Todo problema era apresentado como token expirado | Falhas transitórias e perfis inacessíveis recebiam orientação incorreta | Motivos e ações específicos por diagnóstico |
| Erros desconhecidos da API eram tratados como perfil inacessível | Possíveis falsos positivos de conta indisponível | Erros não reconhecidos, falhas HTTP 5xx/429 e respostas transitórias são falhas temporárias |
| Resposta positiva de outro ID era tratada como perfil inacessível | Diagnóstico incorreto de identidade divergente | Divergência de ID é falha técnica temporária e não confirma perda do perfil |
| Deduplicação persistia apenas 200 notificações | Mais de 200 problemas simultâneos voltavam a tocar ao reabrir o site | Persistência dos IDs ativos não lidos da consulta |
| Alterar o tipo de falha encerrava o alerta anterior com rótulo “Resolvido” | Podia sugerir recuperação apesar de haver um novo problema | Histórico indica **Encerrado** e orienta consultar a situação atual |
| Contas ausentes recebiam link para um perfil inventado | Abria um Instagram sem relação com a conta | Sem link de perfil quando o username não está disponível |

## Comportamento esperado

- **Lido** significa que o aviso foi visto. O alerta permanece pendente enquanto
  seu diagnóstico estiver ativo. Ler não recupera credenciais nem retoma publicação.
- Uma mudança de diagnóstico encerra o evento anterior; se ainda houver um
  problema, o trigger cria outro evento. Resposta saudável encerra o evento ativo.
- Acesso expirado e permissões recusadas geram alerta imediatamente. Perfil
  inacessível exige duas respostas consecutivas iguais; falha temporária exige
  três. Uma resposta saudável zera a sequência.
- Uma primeira falha ainda em confirmação não conta como conexão verificada.
- Checagem com mais de 15 minutos é sinalizada como desatualizada e deixa de
  contar como resposta positiva recente.
- A verificação manual respeita intervalo mínimo de um minuto por conta. Uma
  lease ativa impede concorrer com outro pedido ou com o worker. A gravação
  só é aceita para a lease adquirida, e pedidos concorrentes usam comparação
  do estado anterior antes de reservar a conta.
- Falhas de banco ou Vault interrompem aquela checagem, sem inventar uma
  indisponibilidade da conta. A reserva expira e o cron tenta novamente.
- Busca pelo @ funciona tanto nos alertas quanto na tabela de saúde.

## Limites do diagnóstico

O endpoint consulta `id,username` do perfil. Uma resposta positiva prova que a
Meta respondeu àquele acesso naquele instante; **não prova** que o perfil pode
publicar todo formato, que possui todos os escopos ou que não tem restrições no
aplicativo Instagram. Erro 100 também pode representar mudança de acesso ou de
identificador; não comprova que uma conta foi desativada. A tela não deve prometer
“100% operacional”, “sem bloqueios” ou recuperação em um clique.

A capacidade nominal atual é de 20 contas por minuto, aproximadamente 100 contas
por ciclo de cinco minutos. Crescimento além disso aumenta o intervalo real;
a coluna de checagem e o aviso de desatualização tornam isso visível. Não se
alterou a capacidade, o cron, as regras de publicação nem o esquema do banco.

## Validação

- Testes de transições, classificação de erros, identidade Meta e recuperação.
- Testes de autenticação, escopo por usuário, leitura em lote e falhas de banco.
- Testes do repositório com o cliente Supabase real e HTTP simulado: paginação,
  filtros de propriedade, contagem afetada, cooldown e concorrência das leases.
- Testes React: estado indisponível, saúde desconhecida/desatualizada, leitura de
  alertas ativos, busca, precedência de reconexão e mensagens de falha.
- Regressão de navegação em todos os modos e dos controles existentes do painel.
- `scripts/test-account-alerts.cjs`: navegador com API simulada, sem operações
  em contas reais; menu, leitura, busca, checagem manual, falha do monitor e
  telas de 1440, 390 e 320 pixels.

A verificação global de TypeScript do repositório já apresenta erros em
`flows-api.ts`, `legacy-selection-db.test.ts` e `useSupabaseCrud.ts`, fora deste
módulo. O build Vite e a checagem Deno do monitor são verificados separadamente.
