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

## Implantação

1. Aplicar `supabase/migrations/20261113110302_user_library_sharing.sql`.
2. Publicar a função `instagram-publisher` com `library-sharing.ts`.
3. Publicar o frontend.

As tabelas de identificadores e permissões têm RLS e são acessíveis somente ao
`service_role`. O endpoint existente valida a sessão e a aprovação da conta,
usa a identidade autenticada nas operações e verifica a permissão antes de
listar mídias ou assinar um download. A pesquisa é por @ exato; não há diretório
público de usuários. A autorização dos fluxos continua exigindo mídias próprias.

## Verificação

Os testes de `library-sharing.test.ts` executam a migração em Postgres/PGlite e
verificam unicidade, isolamento, exclusão em cascata e autorização no endpoint.
`LibrarySharingDialog.test.tsx` cobre liberação, retirada, importação e erros de
cota. `library-sharing-api.test.ts` cobre cópia, preservação de metadados, cota e
limpeza após erro de registro.

Antes de ativar em produção, validar com duas contas aprovadas: cadastrar @,
liberar acesso, importar uma mídia, criar um fluxo com a cópia e retirar acesso.
Os testes locais não publicam em contas reais nem aplicam migrações remotas.
