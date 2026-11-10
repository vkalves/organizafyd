# Avança — redesign e validação

## Implementação

Redesign da camada de apresentação sobre o commit `41135f7b2ad1df6a2bab5d55662152faeb4110b5`. O mapa anterior à implementação está em `avanca-interface-map.md`.

| Área | Antes | Implementação Avança |
| --- | --- | --- |
| Identidade | DISPARA, logo cromada | Logo Avança branca original, símbolo compacto, favicon, ícones de instalação e metadados |
| Tema | Cinzas azulados, gradientes cromados e brilho | Preto #0B0B0B, superfícies neutras, bordas discretas, ações principais claras |
| Acesso | Painel cromado, emblema flutuante e órbitas | Composição editorial, marca original, formulário simples, CTA arredondado |
| Workspace | Navegação e superfícies cromadas | Menu lateral discreto, seleção clara, hierarquia de títulos, métricas legíveis |
| Publicação | Estilos distintos entre os módulos | Tratamento comum para biblioteca, upload, campos, resumo, destinos, fila e histórico |
| Celular | Barra rápida por índices no array de navegação | Dashboard, Fluxos, Novo Reel e Agendamentos na barra; todos os destinos no menu Mais |
| Interações | Efeitos decorativos e transições variadas | Transições curtas, foco visível, feedback de seleção/clique e suporte global a movimento reduzido |

As logos SVG e os ícones foram copiados do kit fornecido, sem redesenho, recorte ou alteração de proporções. Cores de erro, sucesso e aviso continuam disponíveis para indicar estado.

## Evidências de preservação

- Auditoria sintática dos 15 componentes alterados: **650 atributos de controle preservados**, incluindo eventos, valores, limites, obrigatoriedade, IDs de campos e destinos. A única normalização aplicada na comparação foi o nome da marca em mensagens.
- Nenhuma alteração em `api/`, `supabase/`, contextos de autenticação, hooks, cliente de dados, regras de agendamento, APIs de publicação, definições de rotas, dependências ou lockfile.
- Os 14 destinos do menu lateral permanecem presentes, inclusive no estado recolhido e no menu móvel. A composição da barra rápida móvel foi reorganizada; as rotas continuam as mesmas.
- Comparação binária de 11 arquivos principais da marca/ícones: iguais aos originais do kit.

## Testes executados

| Verificação | Resultado e limite |
| --- | --- |
| `npm run build` | Passou na versão final |
| `npm test -- --maxWorkers=2 --testTimeout=15000 --reporter=dot` | **56 arquivos e 294 testes passaram** |
| Testes finais direcionados de Auth, Agonia, AppLayout e WelcomeAnimation | **4 arquivos e 15 testes passaram**, incluindo um novo caso da barra móvel adicionado depois da suíte geral |
| `tsc --noEmit -p tsconfig.app.json` | Seis erros existentes; saída comparada com checkout original, idêntica. Nenhum erro de tipos novo |
| Auditoria de atributos, caminhos protegidos e assets | Passou |

O teste existente de Slides excedeu o limite padrão de 5 segundos. Passou com 15 segundos; o arquivo de teste e o módulo de Slides não foram alterados. Os erros de tipos preexistentes estão em `flows-api.ts`, `MediaPreview.tsx` e `useSupabaseCrud.ts` e foram mantidos fora do escopo visual.

### Fluxos conferidos em testes de componentes

- Login: campos e validações, exibição da senha, sucesso com navegação para `/dispara`, erro e nova tentativa.
- Cadastro e recuperação: parâmetros enviados ao contrato existente, mensagens e retorno ao login.
- Navegação: 14 destinos, menu expandido/recolhido, menu móvel, fechamento ao navegar, Escape e restauração de foco.
- Novo Reel: quatro modos, campos condicionais, conta selecionada, bloqueio sem mídia, legenda e limites preservados.
- Agendamento de Reel: upload simulado, mídia/legenda/conta/horário enviados ao contrato de persistência, conversão do fuso e retorno à fila.
- Fila: filtros, links de criação e ação desabilitada sem registros.
- Configurações: salvamento e leitura pela persistência local existente.
- Boas-vindas: fechamento automático, pular, Escape e exclusão da rota de autorização.
- A suíte existente também cobre biblioteca/fluxos, integrações, mídias, contas, agendamento, notificações e outros módulos.

## Limites e revisão pendente

**Não foi realizada comparação visual em navegador, em desktop ou celular.** A abertura de `http://127.0.0.1:8080` foi recusada pelo controle de acesso do navegador, com registro de permissão negada pelo usuário. Não foi tentado outro caminho para contornar a recusa. Os breakpoints e estilos responsivos foram implementados e revisados no código, mas isso não substitui a inspeção visual.

Os testes de login e envio usam contratos/API simulados. Não comprovam autenticação real, OAuth, upload remoto, gravação no banco ou publicação efetiva em redes sociais. Nenhuma publicação real foi criada. Os testes de configurações verificam a persistência local real, em ambiente de testes.

Antes de colocar em produção: revisar login, páginas públicas, dashboard, formulários de Reel/Story, Fluxos, fila, histórico e configurações em 1440×900 e 390×844; conferir menus, modais, foco, rolagem de tabelas, zoom e movimento reduzido. Com uma conta de testes autorizada, percorrer a autenticação e uma publicação agendada ponta a ponta. A entrega fica em PR em rascunho para essa revisão, sem merge ou implantação em produção.
