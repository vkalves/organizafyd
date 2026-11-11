"use strict";
const byId = (id) => document.getElementById(id);
const canvas = byId("canvas");
const ctx = canvas.getContext("2d");
let image = null;
let imageRequest = 0;
function message(text, error = false) {
  byId("error").hidden = !error;
  byId("error").textContent = error ? text : "";
  if (!error) byId("status").textContent = text;
}
function draw() {
  const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
  gradient.addColorStop(0, "#28384c");
  gradient.addColorStop(1, "#0b1018");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  if (image) {
    const scale = Math.max(
      1080 / image.naturalWidth,
      1920 / image.naturalHeight,
    );
    const w = image.naturalWidth * scale,
      h = image.naturalHeight * scale;
    ctx.drawImage(image, (1080 - w) / 2, (1920 - h) / 2, w, h);
  }
  const text = byId("headline").value.trim();
  if (text) {
    ctx.save();
    ctx.font = "600 52px system-ui, sans-serif";
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (line && ctx.measureText(candidate).width > 900) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    const visible = lines.slice(0, 4),
      height = visible.length * 70 + 48;
    const light = byId("background").value === "light";
    ctx.fillStyle = light ? "rgba(255,255,255,.9)" : "rgba(10,16,26,.82)";
    ctx.fillRect(48, 220, 984, height);
    ctx.fillStyle = light ? "#131d29" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    visible.forEach((row, i) => ctx.fillText(row, 540, 244 + 35 + i * 70, 900));
    ctx.restore();
  }
}
byId("image").addEventListener("change", async (event) => {
  const request = ++imageRequest;
  const file = event.target.files[0];
  if (!file) return;
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  ) {
    message("Escolha JPG, PNG ou WEBP de até 20 MB.", true);
    return;
  }
  const url = URL.createObjectURL(file);
  const candidate = new Image();
  candidate.onload = () => {
    URL.revokeObjectURL(url);
    if (request !== imageRequest) return;
    image = candidate;
    draw();
    byId("download").disabled = false;
    message("Imagem pronta. Baixe e adicione o adesivo Link no Instagram.");
  };
  candidate.onerror = () => {
    URL.revokeObjectURL(url);
    if (request === imageRequest)
      message(
        "Não foi possível abrir essa imagem. Escolha outro arquivo.",
        true,
      );
  };
  candidate.src = url;
});
byId("headline").addEventListener("input", draw);
byId("background").addEventListener("change", draw);
byId("label").addEventListener("input", () => {
  byId("guide-label").textContent =
    byId("label").value.trim() || "Seu adesivo Link";
});
byId("position").addEventListener("input", () => {
  byId("link-guide").style.top = byId("position").value + "%";
});
function linkValue() {
  const value = byId("url").value.trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Informe um endereço completo, começando com https://.");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      "Use um link http:// ou https:// sem usuário e senha no endereço.",
    );
  return value;
}
async function copy(value, success) {
  try {
    await navigator.clipboard.writeText(value);
    message(success);
  } catch {
    message(
      "Não foi possível copiar. Selecione o texto do campo e copie manualmente.",
      true,
    );
  }
}
byId("copy-url").addEventListener("click", () => {
  try {
    void copy(
      linkValue(),
      "Link copiado. Cole em Adesivos → Link no Instagram.",
    );
  } catch (error) {
    message(error.message, true);
  }
});
byId("copy-label").addEventListener("click", () => {
  const value = byId("label").value.trim();
  if (!value) {
    message("Preencha o texto do adesivo antes de copiar.", true);
    return;
  }
  void copy(value, "Texto copiado. Personalize o adesivo nativo no Instagram.");
});
byId("download").addEventListener("click", () => {
  if (!image) return;
  draw();
  canvas.toBlob(
    (blob) => {
      if (!blob) {
        message("Não foi possível preparar a imagem. Tente novamente.", true);
        return;
      }
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "avanca-story-1080x1920.jpg";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      message(
        "Download iniciado. No Instagram, abra a imagem e adicione o adesivo Link com o endereço copiado.",
      );
    },
    "image/jpeg",
    0.94,
  );
});
draw();
