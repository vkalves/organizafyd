import {
  AlertTriangle,
  ArrowRight,
  Download,
  Image,
  Link2,
  Monitor,
} from "lucide-react";
import { Link } from "react-router-dom";

export function StoryLinkExtension() {
  return (
    <div className="story-link-page">
      <header className="story-link-topbar">
        <div>
          <div className="eyebrow">Preparar e finalizar no Instagram</div>
          <h1 className="page-title">Stories com Link</h1>
        </div>
        <span className="story-link-top-status">Editor local · v0.8.1</span>
      </header>
      <section className="panel story-link-hero">
        <div className="story-link-hero-copy">
          <div className="story-link-kicker">
            <Link2 size={15} /> PREPARAR STORY
          </div>
          <h2>Sua imagem pronta. O link no Instagram.</h2>
          <p>
            Prepare a imagem, copie o endereço e finalize com o adesivo Link no
            próprio Instagram. A extensão funciona sem acessar sua conta.
          </p>
          <a
            className="button button-primary"
            href="/extensions/storys-com-link.zip?v=0.8.1"
            download="storys-com-link.zip"
          >
            <Download size={16} /> Baixar extensão v0.8.1
          </a>
          <span className="story-link-version">
            Chrome e Edge · sem publicação automática
          </span>
        </div>
        <div className="story-link-mark" aria-hidden="true">
          <Link2 size={54} />
        </div>
      </section>
      <section
        className="notice story-link-warning"
        aria-labelledby="extension-update-title"
      >
        <AlertTriangle size={19} className="shrink-0" aria-hidden="true" />
        <div>
          <h2 id="extension-update-title" className="text-sm font-semibold">
            Usava a versão antiga? Remova antes de instalar.
          </h2>
          <p className="mt-2 text-xs leading-relaxed">
            Em chrome://extensions ou edge://extensions, remova a extensão
            Storys Com Link v0.7.0 ou anterior. Feche todas as janelas do
            navegador e abra novamente. Depois instale a v0.8.1 em uma nova
            pasta.
          </p>
          <p className="mt-2 text-xs leading-relaxed">
            <strong>
              Baixar ou instalar a nova versão não desativa a antiga.
            </strong>{" "}
            A extensão anterior acessava a sessão do Instagram e alterava
            requisições; a v0.8.1 remove esse mecanismo.
          </p>
        </div>
      </section>
      <div className="story-link-features">
        <div>
          <Image size={20} />
          <strong>Imagem 9:16</strong>
          <span>Recorte e texto opcionais, em 1080 × 1920</span>
        </div>
        <div>
          <Link2 size={20} />
          <strong>Link para copiar</strong>
          <span>Adicione o adesivo clicável no Instagram</span>
        </div>
        <div>
          <Monitor size={20} />
          <strong>Editor local</strong>
          <span>Sem acesso a cookies, contas ou sessões</span>
        </div>
      </div>
      <section className="story-link-section">
        <div className="story-link-section-heading">
          <span>01</span>
          <div>
            <h2>Como usar</h2>
            <p>
              Três passos, com a publicação confirmada por você no Instagram.
            </p>
          </div>
        </div>
        <div className="story-link-publish-grid">
          {[
            [
              "1",
              "Prepare a imagem",
              "Clique no ícone da extensão. No editor local, escolha a foto e acrescente um texto, se quiser.",
            ],
            [
              "2",
              "Baixe e copie",
              "Baixe a imagem 1080 × 1920 e clique em Copiar link. A marcação do adesivo é apenas uma referência da prévia.",
            ],
            [
              "3",
              "Finalize no Instagram",
              "Ao criar um Story no aplicativo do Instagram, abra a imagem, toque em Adesivos → Link e cole o endereço. Ajuste o adesivo e publique.",
            ],
          ].map(([number, title, description]) => (
            <article className="story-link-step" key={number}>
              <b>{number}</b>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <details className="panel p-5">
        <summary className="cursor-pointer text-sm font-medium">
          Como instalar no Chrome ou Edge
        </summary>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>
            Remova a versão antiga e reinicie o navegador, como indicado acima.
          </li>
          <li>Baixe o ZIP e extraia em uma nova pasta permanente.</li>
          <li>
            Abra chrome://extensions ou edge://extensions e ative o Modo
            desenvolvedor.
          </li>
          <li>
            Clique em Carregar sem compactação e selecione a pasta com
            manifest.json.
          </li>
          <li>
            Confira a versão 0.8.1. Clique no ícone da extensão para abrir o
            editor local.
          </li>
        </ol>
      </details>
      <p className="text-xs leading-relaxed text-muted-foreground">
        A v0.8.1 prepara a imagem e o link; não agenda, publica ou cria
        Destaques. Ela não recupera contas com restrições nem garante ausência
        de alertas da Meta. Se uma conta pedir confirmação de identidade, siga o
        processo oficial do Instagram.
      </p>
      <footer className="story-link-footer">
        <Link className="link" to="/avanca/stories">
          Ir para Stories <ArrowRight size={14} />
        </Link>
        <span>
          O link só fica clicável após adicionar o adesivo nativo no Instagram.
        </span>
      </footer>
    </div>
  );
}
