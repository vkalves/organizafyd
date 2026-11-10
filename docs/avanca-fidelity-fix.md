# Correção de fidelidade visual — 10/11/2026

Base: `5f245693a6cfff76cebf0ac1eb1035aea74a1de9`, a versão exibida no deploy de produção informado pelo usuário.

A publicação anterior não comprovava fidelidade visual. A comparação em Chromium identificou excesso de altura do ranking, quebra da composição abaixo de 1400px, rótulos pequenos demais, luzes excessivas nas métricas e arte de xadrez cortada pelo cabeçalho/sobreposta ao banner.

## Alterações de apresentação

- Corrigidos alinhamentos, alturas e espaçamentos da composição desktop, também em 1366px.
- Reduzida a iluminação das superfícies; curvas suaves substituem os reflexos duros nas métricas.
- Arte original da referência reposicionada para terminar junto ao banner, com a parte superior visível no cabeçalho. Nenhuma logo foi redesenhada.
- Ranking com posições numéricas neutras, ícone do Instagram e valores na mesma linha. Ordenação, dados e fonte das métricas não mudaram.
- Gráfico ocupa a largura disponível sem deformar os dados; todos os valores continuam disponíveis nos títulos dos pontos e na descrição acessível.
- Informações de diagnóstico do ranking movidas para o disclosure existente de filtros e métricas. Controles e dados continuam acessíveis.
- Estado vazio ocupa a mesma estrutura do ranking, sem registros ou tendências inventados.
- Sidebar mantém sua lógica original: expandida inicialmente, recolhimento manual e todos os destinos preservados.

## Conferência visual

Referência: `public/branding/dashboard-reference.png` (1672 × 941).

| Elemento | Referência | Implementação validada (dados de teste) |
| --- | --- | --- |
| Largura da sidebar expandida | 308px | 308px |
| Altura do cabeçalho | 57px | 57px |
| Início do banner | y=202px | y=202px |
| Altura do banner | 84px | 84px |
| Início dos cards de métricas | y=354px | y=354px |
| Início de ranking/agendamentos | y=500px | y=501px |
| Início dos três módulos inferiores | y=794px | aproximadamente y=800px com três contas/agendamentos |

As diferenças de dados, estados vazios, saudação de horário e módulos de resumo são intencionais: continuam refletindo as regras e métricas reais disponíveis. Esses números de geometria não constituem promessa de identidade pixel a pixel em outros tamanhos ou conteúdos.

Chromium/Playwright: 1672, 1366, 1024, 768 e 390px, nos estados vazio e preenchido. Sem overflow horizontal ou erros de execução. Conferidos filtros de período, disclosure de métricas, recolhimento/expansão da sidebar, menu móvel e fechamento com Escape. Respostas simuladas existem somente no navegador de teste; não foram adicionadas à aplicação.

Build de produção aprovado. Suíte completa: 56 arquivos, 296 testes aprovados na versão final. Não houve publicação real no Instagram, alteração de backend, migração, contrato de API, autenticação, consultas, cálculos ou permissões.
