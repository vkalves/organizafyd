# DISPARA — login e tema cromado

Esta atualização atende à instrução atual de usar **DISPARA** em toda a interface, substituindo o nome DISPARO da versão anterior. O domínio continua sendo `www.organizafy.site`.

## Referência visual

O ZIP `agoniapro.xyz.zip` contém páginas do painel e o CSS compartilhado do site. Não contém um HTML separado do login, mas inclui os estilos completos `.auth-page`, `.auth-shell`, `.auth-showcase`, `.auth-mask-stage`, órbitas, formulário e regras responsivas. Esses estilos orientaram a composição: moldura arredondada com duas colunas, símbolo em destaque com órbitas, texto na área visual e formulário ao lado. A adaptação usa tons metálicos prateados em lugar do ciano e o símbolo oficial DISPARA em lugar da máscara antiga. As páginas, os dados de perfis e os scripts do site de referência não foram incorporados à aplicação.

## Marca e tema

- Nome público DISPARA em login, menus, títulos, boas-vindas, páginas públicas, metadados e manifesto.
- Logotipo horizontal cromado oficial (`dispara-horizontal-cromo.svg`) aplicado ao login e navegação; símbolo oficial na versão compacta e na abertura.
- Imagem oficial horizontal com fundo preto usada no compartilhamento social.
- Arquivos oficiais copiados sem edição do kit `DISPARA_Logos_Completas.zip`.
- Tema cromado compartilhado em `src/dispara-theme.css`: gradientes metálicos em botões principais, títulos, menus, superfícies e detalhes, preservando as cores de erro, sucesso e alerta.
- Login em `AuthLayout.tsx` e `AuthLayout.css` com duas colunas no desktop e formulário focado no celular; órbitas e símbolo flutuante respeitam movimento reduzido.
- Abertura em tela cheia mantida com a marca DISPARA e opção de pular.

## Navegação e compatibilidade

O endereço atual do workspace é `/dispara`, com seções em `/dispara/:section`. `/agonia/*` e `/disparo/*` redirecionam para a nova rota, preservando query e fragmento.

Módulos internos, classes legadas, banco, endpoints, credenciais, eventos, chaves persistidas, domínio e callbacks existentes são mantidos para preservar as integrações e dados. Os formulários continuam usando os mesmos serviços de autenticação. Não houve migração de banco ou troca de permissões.

## Verificação

- 233 testes passaram em 44 arquivos (`npm test -- --testTimeout=15000`).
- Build de produção e lint dos componentes alterados de layout/branding passaram.
- Navegador em 360, 768, 1280 e 1920 px: apresentação, marca, métricas, navegação, ausência de overflow horizontal e movimento reduzido.
- As 14 seções do workspace e as cinco páginas públicas verificadas não exibem os nomes antigos.
- Fluxos de cadastro, recuperação, mostrar/ocultar senha e redirecionamento após entrada verificados no navegador. A autenticação foi simulada; não houve acesso a uma conta real de usuário ou da Meta.
- Comparação visual do login e do workspace, incluindo verificação de que a barra lateral não cobre o conteúdo depois da transição.
