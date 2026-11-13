# Remover arquivos repetidos do Modo Fluxo

Em **Fluxos → Biblioteca de mídias → Remover repetidos**, clique em
**Analisar biblioteca**. A ferramenta carrega todas as páginas da biblioteca
própria, incluindo pastas, posts, stories e capas, e calcula SHA-256 dos bytes
de cada arquivo. Nomes, pastas, legendas e URLs não determinam duplicidade.
Arquivos visualmente semelhantes, recomprimidos ou com metadados binários
diferentes não são considerados idênticos.

A análise baixa um arquivo por vez e não exclui nada. Pode ser cancelada entre
arquivos; uma transferência em andamento precisa terminar antes do cancelamento.
Após a análise, o diálogo informa os grupos encontrados e lista as cópias
elegíveis para exclusão permanente.

Quando existe uma cópia em uso, ela é mantida. Quando nenhuma está em uso,
mantém-se a mais antiga (data de criação e ID como desempate). Cópias com
referências em fluxos ativos/pausados, publicações pendentes, com falha ou
resultado incerto, e rascunhos não cancelados são preservadas. Isso inclui
capas de fluxos e publicações. Se mais de uma cópia estiver em uso, todas essas
cópias permanecem. Arquivos ilegíveis e grupos cujo uso não possa ser
verificado também são preservados.

O botão de exclusão solicita a ação explicitamente após mostrar o resultado.
Cada exclusão verifica novamente as referências usando a proteção de exclusão
manual. A biblioteca e a seleção são atualizadas apenas para os IDs removidos.
Falhas não interrompem os demais arquivos e são apresentadas no resultado.
Pastas e legendas das cópias excluídas não são mescladas na cópia mantida.

Não requer migração ou publicação de funções. A operação é executada na sessão
autenticada e segue as permissões de armazenamento e da biblioteca existentes.
Mantenha a aba aberta até concluir. A verificação e a exclusão são operações
separadas: evite criar novos fluxos ou alterar a biblioteca em outra aba durante
a limpeza.
