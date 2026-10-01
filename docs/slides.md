# Slides livres

A seção `/slides` permite criar várias apresentações em uma tela livre. Inclui texto
com tamanho/cor/alinhamento, upload e link direto de imagem/vídeo, arraste,
redimensionamento, lápis, remoção, duplicação, camadas e desfazer/refazer.

A roda do mouse aproxima/afasta; a mão ou Espaço + arraste move o painel. Em
Apresentar, somente o painel e a barra inferior direita ficam visíveis. Duplo
clique aproxima um conteúdo; Esc sai. Um clique no fundo esconde os controles e
outro clique mostra novamente, sem alternar ao arrastar ou usar um objeto.
Desfazer/refazer e seus atalhos também funcionam durante a apresentação.
Vídeos possuem uma barra “Arraste para mover” fora dos controles do player.
O player pré-carrega a imagem e informa falhas de rede ou de formato, com opção
de tentar novamente. Não converte arquivos; H.264/AAC em MP4 é indicado na
mensagem de incompatibilidade. Não há ordem, setas ou reprodução automática.

## Persistência

- Reutiliza `mind_maps.data` (JSONB), com `kind: "slides"` e `version: 1`.
  Os mapas antigos continuam sem discriminador e são excluídos da lista de slides.
  Mapas e a contagem do dashboard excluem documentos de slides.
- Preserva a RLS de proprietário de `mind_maps`; não exige nova migração.
- Usa o bucket `media` já existente, em `userId/slides/boardId/uuid-nome`.
  Esse bucket continua público como na funcionalidade Mídia existente; não é
  gerado um link público de apresentação nem criado um registro em `media_items`.
- Salva automaticamente após 900 ms sem alterações, serializando as gravações.
  Uma recuperação local de metadados por usuário/apresentação cobre falhas na
  gravação. Não armazena os arquivos de mídia no localStorage.
- Arquivos até 50 MB, sujeitos também aos limites configurados no Storage.
  Links precisam apontar diretamente a uma imagem ou vídeo compatível com o navegador.
- Mídias removidas de um painel são mantidas para permitir desfazer/refazer.
  Excluir a apresentação limpa seus uploads; a exclusão pede confirmação.

## Verificação

`npx vitest run src/features/slides` verifica persistência, fila de salvamento,
recuperação após falha, separação por usuário, upload, apresentação, histórico,
coordenadas do desenho e validação de URLs. `npm run build` compila a aplicação.
