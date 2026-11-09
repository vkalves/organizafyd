> Histórico da versão anterior. A identidade atual passou a ser **DISPARA**, com novo login e tema cromado; veja [DISPARA cromado](dispara-chrome.md).

# Identidade DISPARO e apresentação de abertura

A interface pública passa a usar **DISPARO**. O domínio e o repositório permanecem os mesmos para preservar a hospedagem e as integrações.

## Recursos oficiais aplicados

Os arquivos em `public/branding` são cópias sem edição dos originais enviados em `DISPARA_Logos_Completas.zip`.

| Uso | Arquivo do kit |
| --- | --- |
| Login, navegação e abertura | `01_Logos/SVG/dispara-simbolo-cromo.svg` |
| Variante clara disponível | `01_Logos/SVG/dispara-simbolo-branco.svg` |
| Favicon vetorial | `02_Icones/favicon.svg` |
| Favicons PNG | `02_Icones/favicon-16.png`, `favicon-32.png` |
| Ícone Apple | `02_Icones/apple-touch-icon-180.png` |
| Ícones do aplicativo | `02_Icones/pwa-icon-192.png`, `pwa-icon-512.png`, `pwa-icon-maskable-512.png` |
| Imagem de compartilhamento | `02_Icones/pwa-icon-512.png` |

O kit traz a palavra **DISPARA** nos logotipos completos e não contém uma variante com a palavra **DISPARO**. Por isso, aplica-se o símbolo oficial sem letras, acompanhado de DISPARO em texto. Os SVGs não foram alterados. O ZIP não contém o manual PDF, CSS ou design-tokens mencionados no briefing; os tokens das páginas de trabalho usam os valores hexadecimais descritos no texto enviado.

## Interface

- Marca compartilhada do login, menus e páginas públicas atualizada com o símbolo oficial.
- Removidos a máscara antiga e o badge Agonia da navegação.
- Textos visíveis, rótulos acessíveis, perfil, títulos de páginas, metadados e ícones atualizados.
- Tokens DISPARO aplicados ao workspace e páginas públicas: fundo `#08090B`, superfície `#101216`, superfície secundária `#191D23`, bordas `#2C323B`, prata `#C7CDD6` e texto `#EEF1F5`, com Inter.
- O CSS, os formulários, a validação e a estrutura do login foram preservados. A apresentação é um componente global independente do layout do login.
- A abertura ocupa a tela, destaca o símbolo cromado, anima a entrada da marca e permite pular, entrar imediatamente ou aguardar 5,5 segundos. Usa diálogo acessível com foco contido, fechamento por Escape e suporte a movimento reduzido. Não se repete na navegação interna.
- O arquivo `site.webmanifest` declara os ícones oficiais do aplicativo.

## Compatibilidade

As rotas atuais são `/disparo` e `/disparo/:section`. Entradas em `/agonia/*` são redirecionadas preservando seção, query string e fragmento. Os links internos usam a nova rota.

Permanecem por compatibilidade: nomes de módulos e classes internas `Agonia`, `agonia-root` e arquivos de `features/agonia`; funções de perfil, evento `agonia-profile-updated`, chaves de armazenamento e valores de modo de workspace; identificadores de contas, tabelas, APIs, domínio `organizafy.site`, repositório, variáveis de ambiente e URLs de OAuth. Nenhum deles é usado como nome visível da marca. Não houve migração de banco, mudança de autorização ou edição de credenciais.

## Verificação

A validação cobre testes de fechamento e redirecionamento, métricas e funcionalidades existentes; compilação; navegação e verificação do texto visível nas 14 seções; páginas públicas; apresentação, login e módulo de visualizações em tamanhos móveis e desktop. Os testes de navegador usam conta e respostas de API simuladas; não validam permissões reais da Meta.

Resultado: 232 testes passaram em 44 arquivos (`npm test -- --testTimeout=15000`); build de produção passou; lint dos novos componentes e alterações de branding passou. As verificações de navegador passaram em 360, 768, 1280 e 1920 px. Os campos de login mantiveram exatamente as mesmas posições e dimensões da versão original em 360 e 1280 px. Os recursos oficiais foram comparados por SHA-256 e correspondem byte a byte ao kit enviado.
