# Validação das cotas de mídia

O administrador acessa o painel de usuários, altera os gigabytes de uma conta e salva. O endpoint valida a sessão administrativa e grava a cota no Postgres. Uploads no Supabase e autorizações de upload na AWS consultam a mesma cota. Contas administrativas têm espaço ilimitado.

| Verificação | Resultado |
| --- | --- |
| Testes direcionados | 50 testes passando em 6 arquivos de administração e armazenamento |
| Banco | Migrações executadas em Postgres embarcado (PGlite); padrão de 1 GB para usuários existentes/novos, administradores ilimitados, auditoria, upgrades, downgrades, exclusão e controle de acesso |
| AWS | Inventário paginado dos quatro buckets, reservas compartilhadas, falhas de inventário, cópias migradas sem contagem duplicada e exclusões concorrentes cobertos com serviços simulados |
| Navegador → endpoint → banco → interface | Chromium com handler real e PGlite, autenticação simulada e interceptação de todas as solicitações ao Supabase; alteração de 1 para 2,5 GB confirmada no banco e na tela |
| Redução de cota | Redução para 0,1 GB mantém o arquivo existente e impede novo upload; excluir o arquivo libera espaço |
| Interface móvel | Verificada em 390 × 844 sem overflow horizontal; nenhum erro de página |
| Produção | `npm run build` passa |
| Lint | Passa nos componentes, API e auxiliares novos/alterados selecionados |
| Edge Functions | `deno check` passa para `s3-storage` e `app-admin`, com suas dependências |
| TypeScript completo | Continua com os mesmos diagnósticos da versão original, confirmados em cópia limpa: `MediaPreview.tsx`, `flows-api.ts` e `useSupabaseCrud.ts`. Nenhum novo diagnóstico |

Os testes não enviam mídias reais para a AWS, não usam autenticação de usuários reais e não aplicam alterações em produção. A migração, as duas funções e a interface precisam ser publicadas. Quando há mídias preexistentes na AWS, executar a reconciliação descrita em [administration.md](administration.md) antes de reabrir os uploads.

Para repetir os testes:

```sh
npm test -- src/features/administration src/lib/storage
npm run build
```

Para o teste de navegador, iniciar o servidor de desenvolvimento e executar `scripts/test-storage-quotas.mjs` com Playwright instalado. O script aceita `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH`, `APP_URL` e `ARTIFACT_DIR`, e grava capturas de desktop, celular e do novo painel de armazenamento. Ele aguarda o fechamento da apresentação inicial, que usa uma janela modal e captura o foco.
