# Avança — mapa da interface e preservação de fluxos

Base examinada antes das alterações: `41135f7b2ad1df6a2bab5d55662152faeb4110b5`.

## Rotas públicas

| Entrada | Estados e controles preservados |
| --- | --- |
| `/auth` | Login, cadastro, recuperação, mostrar/ocultar senha, validação nativa, envio, notificações, continuar sessão, links institucionais |
| `/reset-password` | Nova senha, mostrar/ocultar, validações, envio e retorno |
| `/instagram/conectar` | Autorização, seleção de perfil, confirmação, erro e retorno ao workspace |
| `/sobre` | Apresentação, acesso à conta, cards e links públicos |
| `/privacidade`, `/termos`, `/exclusao-de-dados`, `/contato` | Conteúdo legal, orientações e contatos existentes |
| Rota desconhecida | 404 e retorno ao início |

## Workspace autenticado

Todas as telas estão em `/avanca`; a autenticação e os redirecionamentos permanecem intactos.

| Seção | Fluxos e estados existentes |
| --- | --- |
| Dashboard | Saudação, períodos, métricas, ranking, filtros, atalhos de criação e conexão |
| `fluxos` | Biblioteca, pastas, upload, seleção de mídias, legendas, contas, intervalos, horários, loop, campanhas, cancelar/excluir |
| `alertas` | Saúde das contas, leitura/resolução, atualização, conexão |
| `conectar` | Conectar conta, convite e guia de autorização |
| `meta-developer` | Abas, passos, requisitos, copiar dados, conexão e erros |
| `instagram` | Busca, filtros, seleção em lote, pastas, metadados, notas, fotos, saúde e remoção |
| `reels-new` | Vídeos/capa, legendas/variações, imediato/agendado/repetição/sequência, intervalo, fuso, contas, resumo, progresso, publicar/agendar/cancelar |
| `stories` | Imagens/vídeos, seleção, contas, programação, feedback e envio |
| `stories-link` | Configuração e fluxo da extensão existente |
| `scheduled` | Filtros por app/conta, fila persistente, detalhes e cancelamento |
| `reels` | Publicados, filtros, histórico, estados, ações e diagnóstico |
| `reels-test` | Diagnóstico e resultados da integração |
| `visualizacoes` | Ranking, períodos, detalhes e carregamento de métricas |
| `settings` | Intervalos, fuso, preferências e apps Meta; salvar e respectivos retornos |
| `profile` | Nome, foto, validações e salvamento |

## Componentes compartilhados

Menu recolhível, menu móvel com foco contido e Escape, barra inferior, atalhos, alertas, áudio, feedback de publicação, apresentação inicial, botões, campos, abas, tabelas, dropdowns, modais, estados vazios, carregamento e notificações.

Na barra inferior, a composição visual passa a priorizar Dashboard, Modo Fluxo, Novo Reel e Agendamentos. Instagram e Stories c/ Link continuam no menu completo, acessível pelo botão Mais, com seus destinos originais.

As rotas legadas `/agonia/*`, `/dispara/*`, `/disparo/*`, `/tarefas`, `/notas`, `/slides`, `/mapas`, `/config`, `/instagram/*`, `/tiktok` e `/x` mantêm seus redirecionamentos atuais. Os módulos antigos não foram reativados.

## Limites da alteração

Estilos, marca, elementos decorativos, texto de identificação da marca e atributos de apresentação/acessibilidade. Sem alterações em APIs, autenticação, hooks de dados, permissões, banco, integrações, URLs, storage keys, cálculos, eventos ou regras de publicação. As logos e ícones são cópias dos originais fornecidos.
