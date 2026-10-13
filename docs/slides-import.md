# Criar slides para importar no Organizafyd

Na página Slides, arraste um arquivo `.json` para **Importar slide** ou clique em
**Escolher arquivo**. O site valida o arquivo inteiro, cria uma apresentação nova
e abre o editor com os elementos enquadrados. Apresentações existentes não são
substituídas. O limite é 10 MB e 500 elementos por arquivo.

O botão **Baixar arquivo modelo** fornece um exemplo funcional. O mesmo exemplo
fica em `public/templates/slide-organizafyd.json`.

## Orientação para o ChatGPT

Crie um arquivo JSON UTF-8 no formato abaixo. Entregue o arquivo para download,
não apenas o código. Use textos, logos e desenhos separados e editáveis. Respeite
as coordenadas, o tamanho dos elementos e a ordem das camadas. Para um visual de
quadro preto, use `background: "#000000"` e `showGrid: false` na apresentação,
`background: "transparent"` nos elementos e texto branco. Setas, círculos e
marcações podem ser elementos `drawing` com caminhos SVG. Não inclua HTML,
JavaScript, CSS livre ou arquivos do PowerPoint.

## Estrutura obrigatória

```json
{
  "title": "Título da apresentação",
  "data": {
    "kind": "slides",
    "version": 1,
    "background": "#000000",
    "showGrid": false,
    "nodes": [
      {
        "id": "texto-1",
        "type": "slide",
        "position": { "x": 80, "y": 80 },
        "style": { "width": 700, "height": 160 },
        "data": {
          "kind": "text",
          "text": "Seu texto aqui",
          "color": "#ffffff",
          "background": "transparent",
          "fontSize": 44,
          "bold": true,
          "align": "left"
        }
      }
    ]
  }
}
```

- `title`: até 140 caracteres. `id` e `type` são opcionais; os IDs são renovados
  na importação. `type`, quando informado, deve ser `slide`.
- `position`: coordenadas entre -100000 e 100000. `style.width` e `style.height`:
  números positivos de 1 a 20000, em unidades da tela. Reserve espaço suficiente
  para o texto, incluindo o preenchimento interno de 24 em cada lado.
- `zIndex`: inteiro opcional entre -10000 e 10000; valores maiores ficam à frente.
- Cores: hexadecimal (#fff, #ffffff, com ou sem alfa) ou `transparent`.
- `fontSize`: de 12 a 160 (padrão: 36); `bold`: booleano; `align`: `left`, `center`
  ou `right`. O campo `text` aceita texto puro de até 50000 caracteres.
- `viewport` é opcional em `data`: `{ "x": 80, "y": 80, "zoom": 1 }`. O primeiro
  acesso após importar enquadra o conteúdo na tela; a navegação é salva depois.

## Tipos de elemento

| `data.kind` | Campos necessários em `data` |
| --- | --- |
| `text` | `text` |
| `logo` | `icon` com um identificador da lista abaixo |
| `image` | `src`: link HTTP/HTTPS direto ou imagem raster incorporada |
| `video` | `src`: link HTTP/HTTPS direto de vídeo compatível com o navegador |
| `drawing` | `path`, `viewWidth`, `viewHeight`, `strokeWidth` |

Logos: `instagram`, `tiktok`, `youtube`, `telegram`, `whatsapp`, `github`, `google`,
`chatgpt`, `x`, `facebook`, `linkedin`, `discord`, `spotify`, `website`, `link`.
Use `name` para identificar elementos no painel de busca. Logos são vetores sem
fundo; a cor é definida por `color`.

Desenhos: `path` contém apenas os dados do atributo SVG `d`, por exemplo
`M 5 35 Q 60 5 125 35 M 105 15 L 125 35 L 102 48`. Use `viewWidth: 140`,
`viewHeight: 70` e `strokeWidth: 4` para esse exemplo. Não inclua tags SVG.
Os desenhos continuam movíveis, redimensionáveis e recoloríveis.

Imagens incorporadas: `data:image/png;base64,...` (também JPEG, WebP, GIF, AVIF).
O arquivo permanece completo sem depender de links externos. SVG incorporado,
`blob:`, caminhos locais e vídeos incorporados não são aceitos. Vídeos e imagens
por links dependem de o endereço continuar disponível e permitir o carregamento.
Links de páginas do YouTube ou Instagram não são URLs diretas de mídia.

A importação não copia arquivos de links para o armazenamento. Não inclua
`storagePath`; metadados de propriedade, estado de seleção e CSS livre são
removidos. O arquivo importado é salvo como dados editáveis, nunca executado.
