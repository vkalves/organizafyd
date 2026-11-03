# Instagram Studio — etapa de preparação

Entrada: Instagram (`/instagram`; `/instagram/publicar` também abre a automação). As antigas telas de contas, pendentes, prontos e tarefas foram retiradas da navegação e suas URLs redirecionam para a automação. Segue a navegação existente, autenticação Supabase e React Query usadas no projeto, com composição e fila inspiradas nos publicadores X/TikTok.

## Implementado
- Seleção das contas já cadastradas no módulo Instagram (cadastro não significa autorização OAuth).
- Rascunhos persistentes, edição, cancelamento, filtro e até 200 registros recentes.
- Planejamento de Feed, Reel, Story e Carrossel, legenda e URLs HTTPS de mídia, horário local convertido para UTC.
- Fila `waiting_integration` explicitamente sem envio. Nunca apresentar estes registros como publicados ou como agendamento ativo.
- Tabela independente com RLS por usuário e chave composta impedindo associação a conta de outro usuário.

## Instalação
1. Revisar e aplicar `supabase/migrations/20261103000000_instagram_publisher_foundation.sql` no Supabase do projeto, após as migrações existentes de Instagram.
2. Publicar o frontend normalmente (`npm ci` e `npm run build`).
3. Com dois usuários de teste, verificar que cada usuário só lê/altera seus próprios registros e não consegue vincular uma conta do outro.
4. Abrir `/instagram/publicar`, criar rascunho, recarregar, editar e cancelar. Planejar um horário futuro e verificar o status Aguardando integração.

Sem a migração, a tela informa a instalação pendente e bloqueia salvamento. Nenhum cron ou segredo é criado nesta etapa. A migração não foi aplicada remotamente durante o desenvolvimento.

## Próxima etapa: execução real
Implementar autorização Meta no servidor, com estado OAuth de uso único vinculado ao usuário; armazenamento de tokens cifrados separado das tabelas expostas ao cliente; renovação e desconexão. Consultar a documentação vigente da Meta antes de definir permissões, tipos de conta e formatos suportados.

Adicionar upload privado, validação real de tamanho/tipo/duração/proporção e entrega controlada da mídia. Os links atuais são apenas referências de planejamento; não são baixados nem validados como arquivos. Os limites de 10 itens e 2.200 caracteres são limites locais desta interface, não uma promessa de compatibilidade com todos os formatos da API.

Criar fila operacional separada e worker autenticado, claim atômico, idempotência por postagem, pausa por conta, processamento de contêineres, histórico de tentativas e estado incerto para evitar duplicações após timeouts. O worker deve operar com o navegador fechado. Registros `waiting_integration` exigem revisão de data e confirmação explícita antes de serem convertidos para envio real; não publicar automaticamente itens antigos ao ativar a integração.
