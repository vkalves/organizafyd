import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarClock, Images, ShieldCheck } from "lucide-react";
import "./tiktok-publisher.css";
const operator = import.meta.env.VITE_LEGAL_OPERATOR?.trim() || "";
const email = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "";
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const titles: Record<string, string> = {
  "/sobre": "Organize seu trabalho. Prepare suas publicações.",
  "/privacidade": "Política de Privacidade",
  "/termos": "Termos de Uso",
  "/exclusao-de-dados": "Exclusão de dados",
  "/contato": "Contato e suporte",
};
export function PublicLinks() {
  return (
    <nav aria-label="Informações públicas">
      <Link to="/sobre">Sobre o Organizafy</Link>
      <Link to="/privacidade">Privacidade</Link>
      <Link to="/termos">Termos de Uso</Link>
      <Link to="/exclusao-de-dados">Excluir dados</Link>
      <Link to="/contato">Contato</Link>
    </nav>
  );
}
export default function PublicInfo() {
  const { pathname } = useLocation();
  const about = pathname === "/sobre";
  useEffect(() => {
    const previous = document.title;
    document.title = `${about ? "Sobre" : titles[pathname]} · Organizafy`;
    return () => { document.title = previous; };
  }, [pathname, about]);
  return (
    <div className="tt-public">
      <header>
        <Link to="/sobre">
          <strong>Organizafy</strong>
        </Link>
        <Link to="/auth" className="tt-public-button">
          Acessar minha conta
        </Link>
      </header>
      {about ? (
        <>
          <section className="tt-public-hero">
            <span className="tt-kicker">ORGANIZAÇÃO E PUBLICAÇÃO</span>
            <h1>{titles[pathname]}</h1>
            <p>
              Um espaço para organizar tarefas, notas, mapas mentais, slides e
              operações de conteúdo. Criadores e equipes usam suas próprias
              contas para planejar e acompanhar o trabalho.
            </p>
            <Link className="tt-public-button" to="/auth?next=tiktok">
              Conhecer o painel de fotos
            </Link>
          </section>
          <div className="tt-public-cards">
            <article>
              <Images />
              <h2>Fotos em carrossel</h2>
              <p>
                Escolha as imagens, ajuste a ordem, escreva o título e a
                descrição e confira a capa antes de autorizar.
              </p>
            </article>
            <article>
              <CalendarClock />
              <h2>Horários por postagem</h2>
              <p>
                Defina uma data para cada publicação e acompanhe os resultados
                na fila. Você pode cancelar o que ainda não começou a ser
                enviado.
              </p>
            </article>
            <article>
              <ShieldCheck />
              <h2>Você controla sua conta</h2>
              <p>
                A conexão acontece no TikTok, sem compartilhar sua senha. Revise
                a privacidade, desconecte contas ou exclua os dados do módulo.
              </p>
            </article>
          </div>
          <section>
            <h2>Como funciona</h2>
            <ol>
              <li>Crie ou acesse sua conta Organizafy.</li>
              <li>
                Conecte sua própria conta do TikTok e conceda a permissão de
                publicação.
              </li>
              <li>Escolha fotos, legenda, privacidade e horário.</li>
              <li>
                Revise, autorize o envio e acompanhe o resultado no painel.
              </li>
            </ol>
            <p>
              A integração de publicação está em preparação para configuração e
              análise do TikTok. Publicações públicas dependem da aprovação do
              aplicativo. Não há promessa de aprovação, alcance ou postagens
              ilimitadas.
            </p>
            <h2>Para criadores e equipes</h2>
            <p>
              O módulo é destinado a clientes da plataforma que autorizam suas
              próprias contas. A disponibilidade comercial, os preços e as
              condições de acesso devem ser conferidos com a administração antes
              da contratação.
            </p>
          </section>
        </>
      ) : (
        <article className="tt-public-legal">
          <h1>{titles[pathname]}</h1>
          <p>Atualizado em 17 de outubro de 2026.</p>
          {pathname === "/privacidade" && (
            <>
              <h2>Responsável e alcance</h2>
              <p>
                Esta política descreve o uso de dados da conta Organizafy e do
                módulo TikTok Fotos. Responsável:{" "}
                {operator ||
                  "administração do Organizafy (identificação em configuração)"}
                . O canal de atendimento está em{" "}
                <Link to="/contato">Contato</Link>.
              </p>
              <h2>Dados utilizados</h2>
              <p>
                O serviço utiliza seu identificador de usuário e email de
                cadastro para autenticação. Ao conectar o TikTok, armazena o
                identificador e o nome da conta, as permissões e as credenciais
                necessárias para publicar e renovar o acesso. As credenciais do
                TikTok são criptografadas no servidor e não são mostradas no
                painel.
              </p>
              <p>
                Quando você autoriza uma postagem, o módulo armazena fotos,
                título, descrição, capa, privacidade, opções de música e
                comentários, indicações de IA e conteúdo comercial, horário,
                registro da autorização e resultado do envio.
              </p>
              <h2>Finalidade e compartilhamento</h2>
              <p>
                Os dados são usados para prestar o serviço solicitado: conectar
                contas, manter a fila, enviar conteúdo autorizado e informar
                erros e resultados. O TikTok recebe o conteúdo e as
                configurações necessárias. Supabase fornece autenticação, banco
                e armazenamento; a hospedagem do site entrega páginas e fotos.
                Esses provedores podem processar dados em outros países conforme
                suas próprias condições.
              </p>
              <h2>Acesso às fotos</h2>
              <p>
                As fotos enviadas ao módulo ficam em armazenamento com links
                públicos de nomes aleatórios, para que o TikTok possa buscá-las.
                Quem tiver o link pode acessá-las, mesmo antes da postagem ou se
                a postagem for privada. Não envie material confidencial.
                Cancelar uma postagem não remove seus arquivos.
              </p>
              <h2>Armazenamento e exclusão</h2>
              <p>
                Os dados ficam no serviço enquanto necessários ao funcionamento
                da fila e do histórico, até sua exclusão pelo usuário ou
                solicitação de atendimento. Desconectar remove as credenciais
                locais e pausa a conta; o histórico e as fotos permanecem.
                “Excluir meus dados do TikTok” remove contas conectadas, filas,
                histórico e arquivos desse módulo. Conteúdo já recebido pelo
                TikTok e cópias técnicas de segurança seguem as regras e os
                ciclos dos respectivos provedores.
              </p>
              <h2>Seus controles</h2>
              <p>
                Você pode revisar as postagens, cancelar as que ainda aguardam
                envio, pausar contas, revogar o acesso nas configurações do
                TikTok e solicitar acesso, correção ou exclusão de dados pelo{" "}
                <Link to="/contato">canal de suporte</Link>. Veja também as{" "}
                <Link to="/exclusao-de-dados">instruções de exclusão</Link>.
              </p>
              <h2>Sessão no navegador</h2>
              <p>
                O login usa armazenamento local do navegador para manter a
                sessão. Sair da conta encerra o acesso local; não exclui dados
                armazenados no servidor. Mudanças relevantes nesta política
                serão publicadas nesta página.
              </p>
            </>
          )}
          {pathname === "/termos" && (
            <>
              <h2>Uso do serviço</h2>
              <p>
                O Organizafy oferece ferramentas de organização e preparação de
                conteúdo para seus clientes. Ao usar o módulo TikTok Fotos, você
                autoriza apenas ações sobre contas que lhe pertencem ou que tem
                permissão para administrar.
              </p>
              <h2>Publicações autorizadas</h2>
              <p>
                Você define fotos, ordem, texto, conta, privacidade e horário e
                autoriza cada envio. O agendamento permite que o servidor
                execute essa autorização no horário solicitado, sem manter o
                navegador aberto. Você é responsável por revisar o conteúdo e
                ter os direitos sobre imagens, marcas e músicas utilizadas.
              </p>
              <h2>Regras das plataformas</h2>
              <p>
                É necessário cumprir as regras do TikTok, incluindo
                identificação de conteúdo comercial e conteúdo gerado por IA
                quando aplicável. Não utilize o serviço para spam, violação de
                direitos ou ações sem autorização do titular da conta.
              </p>
              <h2>Disponibilidade e limites</h2>
              <p>
                A conexão oficial depende das permissões concedidas, da
                aprovação do aplicativo e da disponibilidade do TikTok. Há
                limites de uso e de infraestrutura. Horários podem sofrer
                atrasos de processamento, conexão, filas ou moderação. O serviço
                não garante alcance, resultados financeiros nem publicação sem
                falhas.
              </p>
              <h2>Falhas e cancelamento</h2>
              <p>
                Você pode cancelar uma postagem enquanto ainda aguarda envio.
                Depois que o TikTok recebe o material, a publicação pode
                continuar mesmo após desconectar ou excluir os dados locais.
                Envios incertos exigem conferir o perfil antes de recriar a
                postagem, para evitar duplicação.
              </p>
              <h2>Fotos e dados</h2>
              <p>
                Ao autorizar, você permite a preparação das fotos e seu
                armazenamento em links públicos para entrega ao TikTok, conforme
                a <Link to="/privacidade">Política de Privacidade</Link>. A
                preparação pode modificar resolução, compressão e transparência.
                Confira a prévia antes do envio.
              </p>
              <h2>Contratação e suporte</h2>
              <p>
                Preços, cobrança e condições comerciais devem ser apresentados e
                aceitos antes da compra. Estes termos não substituem as
                condições específicas da sua contratação nem afastam direitos
                obrigatórios previstos em lei. Responsável:{" "}
                {operator ||
                  "administração do Organizafy (identificação em configuração)"}
                . Atendimento em <Link to="/contato">Contato</Link>.
              </p>
            </>
          )}
          {pathname === "/exclusao-de-dados" && (
            <>
              <h2>Excluir pelo painel</h2>
              <ol>
                <li>Acesse sua conta Organizafy.</li>
                <li>Abra TikTok Fotos e entre em Contas.</li>
                <li>Abra “Excluir meus dados do TikTok”.</li>
                <li>Leia o aviso, digite EXCLUIR e confirme.</li>
              </ol>
              <p>
                Essa ação remove as contas TikTok conectadas ao seu usuário,
                credenciais locais, filas, histórico e fotos armazenadas no
                módulo. Se ocorrer um erro, repita a exclusão ou solicite
                atendimento.
              </p>
              <h2>O que permanece fora deste módulo</h2>
              <p>
                Isso não apaga sua conta Organizafy, dados de outras ferramentas
                ou posts já recebidos pelo TikTok. Para apagar esses posts, use
                o próprio TikTok. Envios em andamento podem terminar. Cópias
                técnicas de segurança seguem o ciclo de retenção dos provedores.
              </p>
              <h2>Revogar acesso no TikTok</h2>
              <p>
                Você também pode remover o Organizafy das permissões de
                aplicativos conectados nas configurações do TikTok. Apenas
                revogar a permissão no TikTok não exclui o histórico e os
                arquivos no Organizafy.
              </p>
              <h2>Se não conseguir entrar</h2>
              <p>
                Use a recuperação de senha ou fale com o{" "}
                <Link to="/contato">suporte</Link>. Nunca envie senhas ou
                tokens. Podemos precisar confirmar a titularidade antes de
                atender uma solicitação.
              </p>
              <Link className="tt-public-button" to="/tiktok">
                Abrir minhas contas
              </Link>
            </>
          )}
          {pathname === "/contato" && (
            <>
              <h2>Administração do Organizafy</h2>
              <p>
                {operator ||
                  "Identificação do responsável ainda em configuração."}
              </p>
              {validEmail ? (
                <p>
                  Para suporte, privacidade ou solicitações de dados:{" "}
                  <a href={`mailto:${email}`}>{email}</a>.
                </p>
              ) : (
                <div className="tt-notice">
                  O email público de suporte ainda está em configuração. A
                  administração precisa preencher este canal antes de abrir a
                  integração ao público ou solicitar a análise do TikTok.
                </div>
              )}
              <p>
                Informe o email da sua conta e descreva o problema. Não envie
                senha, código de acesso, credenciais ou fotos confidenciais.
              </p>
              <p>
                Para remover dados do módulo sem atendimento, use{" "}
                <Link to="/exclusao-de-dados">Excluir dados</Link>.
              </p>
            </>
          )}
        </article>
      )}
      {(!operator || !validEmail) && about && (
        <p className="tt-notice">
          Cadastro público em preparação: a identificação do responsável e o
          canal de suporte precisam ser concluídos antes da disponibilização da
          integração aos clientes.
        </p>
      )}
      <PublicLinks />
    </div>
  );
}
