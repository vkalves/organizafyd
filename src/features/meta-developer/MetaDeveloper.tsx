import { MetaAppConfig, type MetaConfig } from "./MetaAppConfig";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  Instagram,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ConnectAccount } from "@/features/instagram-publisher/ConnectAccount";
import { loginRequest } from "@/features/instagram-publisher/login";
import "./meta-developer.css";

type Step = {
  label: string;
  title: string;
  description: string;
  actions: string[];
  example: { title: string; rows: [string, string][] };
  done: string;
};
const connectSteps: Step[] = [
  {
    label: "Prepare",
    title: "Seu Instagram precisa ser profissional.",
    description:
      "Use uma conta de Empresa ou Criador de conteúdo para conectar à Avança.",
    actions: [
      "No Instagram, abra o menu do seu perfil e procure “Tipo de conta e ferramentas”.",
      "Se a conta for pessoal, escolha “Mudar para conta profissional”. Para publicar Stories pela API, use uma conta de Empresa.",
      "No Meta Business Suite, confira se você tem acesso ao Instagram, à Página vinculada e ao portfólio empresarial que vai autorizar.",
    ],
    example: {
      title: "Antes de continuar",
      rows: [
        ["Instagram", "@suaempresa"],
        ["Tipo de conta", "Empresa ou Criador"],
        ["Acesso", "Você administra os ativos"],
      ],
    },
    done: "Você consegue administrar o perfil e os ativos da empresa na Meta.",
  },
  {
    label: "Autorize",
    title: "Conecte pela tela oficial da Meta.",
    description:
      "A Avança abre a autorização oficial. Sua senha é digitada somente na Meta.",
    actions: [
      "Clique em “Conectar conta” abaixo. Escolha continuar no navegador, copiar um link ou abrir pelo QR Code.",
      "Entre na conta da Meta que administra o negócio e selecione o portfólio empresarial correto.",
      "Autorize um único perfil do Instagram por conexão e mantenha as permissões de perfil e publicação selecionadas.",
    ],
    example: {
      title: "Exemplo de seleção",
      rows: [
        ["Portfólio", "Minha Empresa"],
        ["Instagram autorizado", "@suaempresa"],
        ["Permissões", "Perfil e publicação"],
      ],
    },
    done: "A tela oficial conclui a autorização e retorna à Avança.",
  },
  {
    label: "Confira",
    title: "Sua conta apareceu? Tudo certo.",
    description:
      "Veja a conta conectada antes de preparar sua primeira publicação.",
    actions: [
      "Abra a aba Instagram e procure o @perfil que você acabou de autorizar.",
      "Se houver um aviso de reconexão, gere um novo link e repita a autorização.",
      "Com a conta disponível, abra Novo Reel ou Modo Fluxo e escolha o conteúdo e os horários.",
    ],
    example: {
      title: "O que conferir na Avança",
      rows: [
        ["Aba", "Instagram"],
        ["Perfil", "Seu @perfil aparece na lista"],
        ["Próximo passo", "Preparar uma publicação"],
      ],
    },
    done: "O perfil está na lista de contas e disponível para selecionar ao publicar.",
  },
];
const appSteps: Step[] = [
  {
    label: "Crie o app",
    title: "Abra seu app no Meta for Developers.",
    description:
      "Este caminho é para quem administra a integração. Quem só vai conectar um perfil pode usar o guia rápido.",
    actions: [
      "Abra “Meus apps” no Meta for Developers e crie ou selecione o aplicativo da sua empresa.",
      "Configure o caso de uso que oferece Facebook Login for Business e acesso à API do Instagram. Os nomes dos menus podem variar na Meta.",
      "Preencha os dados básicos solicitados, como contato, política de privacidade e exclusão de dados. Use os endereços reais do seu serviço.",
    ],
    example: {
      title: "Exemplo de identificação",
      rows: [
        ["Nome do aplicativo", "Minha Empresa · Instagram"],
        ["Finalidade", "Conectar e publicar no Instagram"],
        ["Responsável", "Administrador da integração"],
      ],
    },
    done: "O app aparece no seu painel e o login empresarial está disponível.",
  },
  {
    label: "Permissões",
    title: "Defina o que o app pode fazer.",
    description:
      "O login atual da Avança usa Facebook Login for Business com uma configuração de login unificado.",
    actions: [
      "No Facebook Login for Business, crie uma configuração e selecione o fluxo de token de usuário do sistema (System User).",
      "Inclua instagram_basic para identificar o perfil e instagram_content_publish para publicar. Para métricas, confira também instagram_manage_insights e os acessos aos ativos exigidos pela Meta.",
      "Associe os ativos empresariais necessários à configuração e guarde o ID da configuração. Ele é diferente do App ID.",
    ],
    example: {
      title: "Permissões, em palavras simples",
      rows: [
        ["instagram_basic", "Identificar o Instagram"],
        ["instagram_content_publish", "Publicar conteúdo"],
        ["instagram_manage_insights", "Consultar métricas, quando permitido"],
      ],
    },
    done: "A configuração tem os acessos necessários e um ID de configuração próprio.",
  },
  {
    label: "Endereço de retorno",
    title: "Diga à Meta para onde voltar.",
    description:
      "Depois da autorização, a Meta precisa devolver a pessoa ao endereço correto da Avança.",
    actions: [
      "Abra as configurações do Facebook Login for Business e procure “Valid OAuth Redirect URIs” (URIs de redirecionamento OAuth válidos).",
      "Copie o endereço de retorno mostrado abaixo e cole nesse campo, sem alterar nenhum caractere.",
      "Salve na Meta. Use o endereço informado pelo servidor, mesmo que ele seja diferente do domínio do site.",
    ],
    example: {
      title: "Onde preencher",
      rows: [
        ["Produto", "Facebook Login for Business"],
        ["Campo", "Valid OAuth Redirect URIs"],
        ["Valor", "O endereço de retorno abaixo"],
      ],
    },
    done: "O endereço completo foi salvo na lista de retornos válidos da Meta.",
  },
  {
    label: "Ative a integração",
    title: "Salve as credenciais do aplicativo.",
    description:
      "Administradores podem salvar as credenciais pelo formulário abaixo, sem editar arquivos no servidor.",
    actions: [
      "Em Configurações do app → Básico, localize App ID e App Secret. Na configuração de login, localize o ID da configuração.",
      "Preencha os três valores no formulário abaixo. Deixe o Secret vazio para manter a chave atual; ao trocar o App ID, informe a nova chave.",
      "Para atender pessoas fora dos papéis de teste, conclua a análise do app, o acesso avançado e a verificação empresarial que a Meta solicitar antes de liberar o uso público.",
    ],
    example: {
      title: "Três valores diferentes",
      rows: [
        ["App ID", "Identifica o aplicativo"],
        ["App Secret", "Chave privada do servidor"],
        ["ID da configuração", "Define o fluxo e as permissões"],
      ],
    },
    done: "O servidor informa que a conexão está disponível. A aprovação do app deve ser conferida no painel da Meta.",
  },
  {
    label: "Teste a conexão",
    title: "Autorize um perfil e confira o resultado.",
    description:
      "A confirmação final acontece quando a conta aparece conectada na Avança.",
    actions: [
      "Confira se o Instagram é profissional, tem Página vinculada e está no portfólio que será autorizado.",
      "Clique em “Conectar conta”, conclua o login oficial e autorize um perfil por vez.",
      "Abra Instagram e confira se o perfil aparece. Depois, prepare uma publicação de teste com um conteúdo seu.",
    ],
    example: {
      title: "Como saber se funcionou",
      rows: [
        ["Autorização", "Concluída na Meta"],
        ["Conta na Avança", "Visível na aba Instagram"],
        ["Publicação", "Confirmada no histórico após publicar"],
      ],
    },
    done: "Seu perfil está disponível para publicar. Cada nova conta precisa da própria autorização.",
  },
];
const faqs = [
  [
    "Preciso criar um app para conectar meu Instagram?",
    "Se a conexão da Avança já está disponível, use o guia rápido e autorize sua conta. A criação do app é uma tarefa de quem administra a integração.",
  ],
  [
    "Meu Instagram não aparece na autorização.",
    "Confira a conta profissional, a Página vinculada, o portfólio escolhido e seu acesso a esses ativos no Meta Business Suite. Gere um novo link e selecione um único Instagram.",
  ],
  [
    "A Meta diz que o endereço de retorno é inválido.",
    "Compare o endereço salvo em Valid OAuth Redirect URIs com o exibido no guia. Protocolo, domínio, caminho e barras precisam ser iguais.",
  ],
  [
    "Apareceu um erro de permissão ou de função de desenvolvedor.",
    "Durante testes, confira os papéis do app e os convites pendentes. Para clientes externos, o administrador precisa conferir a análise e os acessos exigidos pela Meta.",
  ],
  [
    "O tutorial que eu vi usa Instagram Login. É igual?",
    "São configurações diferentes. Este AVANÇA usa Facebook Login for Business e permissões instagram_basic e instagram_content_publish. Siga o fluxo deste guia; permissões instagram_business_* pertencem ao outro tipo de integração.",
  ],
];

export default function MetaDeveloper({
  onConnected,
}: {
  onConnected: (id: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"connect" | "app">("connect");
  const [index, setIndex] = useState(0);
  const [copyState, setCopyState] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(false);
  const config = useQuery({
    queryKey: ["meta-developer-config"],
    queryFn: () => loginRequest<MetaConfig>("config"),
    retry: false,
    staleTime: 60000,
  });
  const steps = mode === "connect" ? connectSteps : appSteps;
  const step = steps[index];
  const callback = config.data?.callback?.startsWith("https://")
    ? config.data.callback
    : "";
  useEffect(() => {
    if (shouldFocus.current) titleRef.current?.focus();
  }, [index, mode]);
  function go(next: number) {
    shouldFocus.current = true;
    setIndex(next);
    setCopyState("");
  }
  function changeMode(next: typeof mode) {
    shouldFocus.current = true;
    setMode(next);
    setIndex(0);
    setCopyState("");
  }
  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(callback);
      setCopyState("Endereço copiado.");
    } catch {
      setCopyState(
        "Não foi possível copiar. Selecione o endereço e copie manualmente.",
      );
    }
  }
  return (
    <section className="meta-guide" aria-label="Integração Meta Developer">
      <header className="meta-guide-heading">
        <div className="meta-guide-mark" aria-hidden="true">
          <Code2 size={25} />
        </div>
        <div>
          <span className="meta-guide-eyebrow">INTEGRAÇÕES · AVANÇA</span>
          <h1>Meta Developer</h1>
          <p>Do primeiro acesso à conta conectada. Um passo de cada vez.</p>
        </div>
      </header>
      <div className="meta-guide-status" role="status">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          {config.isPending
            ? "Consultando a conexão da Avança…"
            : config.isError
              ? "Não foi possível consultar a configuração."
              : config.data?.ready
                ? "Conexão da Avança disponível"
                : "Conexão aguardando configuração pelo administrador"}
        </span>
        <button
          type="button"
          onClick={() => void config.refetch()}
          disabled={config.isFetching}
          aria-label="Atualizar status da integração"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="meta-guide-paths" aria-label="Escolha seu objetivo">
        <button
          type="button"
          aria-pressed={mode === "connect"}
          onClick={() => changeMode("connect")}
        >
          <Instagram size={19} />
          <span>
            <strong>Quero conectar meu Instagram</strong>
            <small>Guia rápido · 3 passos</small>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={mode === "app"}
          onClick={() => changeMode("app")}
        >
          <Code2 size={19} />
          <span>
            <strong>Quero configurar um app Meta</strong>
            <small>Para administradores · 5 passos</small>
          </span>
        </button>
      </div>
      <div className="meta-guide-workspace">
        <nav className="meta-guide-steps" aria-label="Etapas da integração">
          {steps.map((item, i) => (
            <button
              key={`${mode}-${i}`}
              type="button"
              aria-current={i === index ? "step" : undefined}
              onClick={() => go(i)}
            >
              <span>{i + 1}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>
        <article className="meta-guide-card" aria-labelledby="meta-step-title">
          <div className="meta-guide-step-count">
            PASSO {index + 1} DE {steps.length}
          </div>
          <h2 id="meta-step-title" tabIndex={-1} ref={titleRef}>
            {step.title}
          </h2>
          <p className="meta-guide-description">{step.description}</p>
          <div className="meta-guide-instructions">
            <ol>
              {step.actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ol>
            <aside
              className="meta-guide-example"
              aria-label="Exemplo ilustrativo"
            >
              <span>EXEMPLO ILUSTRATIVO</span>
              <h3>{step.example.title}</h3>
              <dl>
                {step.example.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
          {mode === "app" && index === 0 && (
            <a
              className="button button-secondary"
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir Meta for Developers <ExternalLink size={15} />
            </a>
          )}
          {mode === "app" && index === 2 && (
            <div className="meta-guide-callback">
              <label htmlFor="meta-callback">
                Endereço de retorno da Avança
              </label>
              {callback ? (
                <div>
                  <input
                    id="meta-callback"
                    readOnly
                    value={callback}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={() => void copyCallback()}
                    aria-label="Copiar endereço de retorno"
                  >
                    <Copy size={17} />
                  </button>
                </div>
              ) : (
                <p>
                  O endereço aparecerá após consultar o servidor. Use “Atualizar
                  status da integração” para tentar novamente.
                </p>
              )}
              <p role="status">
                {copyState ||
                  "Cole o endereço completo em Valid OAuth Redirect URIs na Meta."}
              </p>
            </div>
          )}
          {mode === "app" && index === 3 && (config.data?.canManage ? (
            <MetaAppConfig config={config.data} onSaved={saved => {
              queryClient.setQueryData(["meta-developer-config"], saved);
            }} />
          ) : <p>Somente administradores da integração podem salvar credenciais. Solicite a configuração ao responsável pela Avança.</p>)}
          <div className="meta-guide-done">
            <CheckCircle2 size={19} aria-hidden="true" />
            <div>
              <strong>Como saber se deu certo</strong>
              <p>{step.done}</p>
            </div>
          </div>
          {((mode === "connect" && index >= 1) ||
            (mode === "app" && index === 4)) && (
            <div className="meta-guide-connect">
              <ConnectAccount
                onConnected={onConnected}
                variant="default"
                size="default"
              />
              <Link className="button button-secondary" to="/avanca/instagram">
                Ver minhas contas <ArrowRight size={15} />
              </Link>
            </div>
          )}
          <footer className="meta-guide-controls">
            <button
              type="button"
              className="button button-secondary"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <ArrowLeft size={16} /> Voltar
            </button>
            {index < steps.length - 1 ? (
              <button
                type="button"
                className="button button-primary"
                onClick={() => go(index + 1)}
              >
                Próximo passo <ArrowRight size={16} />
              </button>
            ) : (
              <Link className="button button-primary" to="/avanca/instagram">
                <Check size={16} /> Ir para Instagram
              </Link>
            )}
          </footer>
        </article>
      </div>
      <section className="meta-guide-help" aria-labelledby="meta-help-title">
        <h2 id="meta-help-title">Travou em algum passo?</h2>
        <p>Abra apenas a dúvida que precisa resolver.</p>
        {faqs.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
        <a
          href="https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentação oficial da Meta <ExternalLink size={13} />
        </a>
      </section>
    </section>
  );
}
