# Compartilhamento da biblioteca por @

Em **Fluxos → Biblioteca de mídias → Compartilhar por @**, cada usuário pode
salvar um identificador único (3–30 letras minúsculas, números ou `_`). O dono
informa o @ do destinatário para liberar toda a biblioteca atual e suas novas
mídias. O destinatário também precisa cadastrar seu @.

As bibliotecas recebidas aparecem no mesmo diálogo. Importar cria uma cópia
independente no armazenamento e na biblioteca do destinatário, mantendo tipo,
pasta e legenda. A cópia entra na seleção normal dos fluxos, incluindo capas,
e respeita a cota de armazenamento do destinatário. Não compartilha contas de
Instagram nem permite editar ou apagar os originais.

Retirar acesso impede novas consultas e novos downloads autorizados. Links
assinados já emitidos podem continuar válidos por até uma hora. Cópias que já
foram importadas permanecem na conta de destino. A importação é individual;
clicar novamente após reabrir o diálogo pode criar outra cópia.

**Importar todas as mídias** percorre todas as páginas da biblioteca selecionada
e copia até três arquivos em paralelo, exibindo o progresso. A lista de IDs é
consultada em páginas de 500. Os arquivos são copiados diretamente no servidor:
S3 usa CopyObject com ETag, e arquivos antigos no Supabase usam sua cópia nativa.
Os bytes não passam pelo navegador nem pela memória da Edge Function. Mantenha o diálogo e a aba
abertos até concluir. Falhas individuais não descartam arquivos concluídos;
tentar novamente ignora as mídias já importadas enquanto o diálogo estiver
aberto. A cota de armazenamento continua sendo aplicada a cada arquivo.

## Implantação

1. Aplicar `supabase/migrations/20261113110302_user_library_sharing.sql`.
2. Publicar primeiro `s3-storage` com `copy.ts`, depois `instagram-publisher`
   com `library-sharing.ts` e `_shared/hybrid-storage.ts`.
3. Publicar o frontend. A otimização não exige nova migração SQL.

As tabelas de identificadores e permissões têm RLS e são acessíveis somente ao
`service_role`. O endpoint existente valida a sessão e a aprovação da conta,
usa a identidade autenticada nas operações e verifica a permissão antes de
listar mídias, assinar downloads ou importar cópias. O gateway de cópia aceita
somente credenciais de serviço, valida caminhos e reserva o tamanho real de cada
arquivo antes de copiar. Falhas de registro removem somente o novo arquivo.
Inventários S3 recentes/em andamento são compartilhados por 30 segundos dentro
da mesma instância, mantendo uma reserva atômica por arquivo.
A pesquisa é por @ exato; não há diretório
público de usuários. A autorização dos fluxos continua exigindo mídias próprias.

## Verificação

Os testes de `library-sharing.test.ts` executam a migração em Postgres/PGlite e
verificam unicidade, isolamento, exclusão em cascata e autorização no endpoint.
`LibrarySharingDialog.test.tsx` cobre liberação, retirada, importação e erros de
cota. `shared-copy.test.ts` cobre autorização, preservação de pastas e legendas, cota
e limpeza após erro de registro. `src/lib/storage/copy.test.ts` cobre cópia S3,
compatibilidade legada, reservas e inventários; `library-sharing-batch.test.ts`
verifica paginação, limite de concorrência, progresso e falhas parciais.

Antes de ativar em produção, validar com duas contas aprovadas: cadastrar @,
liberar acesso, importar uma mídia, criar um fluxo com a cópia e retirar acesso.
Os testes locais não publicam em contas reais nem aplicam migrações remotas.
