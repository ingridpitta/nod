// Auditoria de toque do celular (NOD-383, ADR-094): a regra pura. O executor (rodar.ts) coleta, no Chrome em 390×844 com
// toque, cada alvo visível e o que está debaixo do dedo a 22 px do centro nos 4 pontos cardinais; aqui se decide o que
// falha. Fica separado para o teste unitário provar a regra sem Chrome.

/** Metade de 44: um alvo de 44×44 centrado cobre o ponto a 22 px do centro (até a borda, inclusive). */
export const RAIO_TOQUE = 22;
export const ALVO_MINIMO = 44;

/** O que a página devolve de cada alvo: seletor legível, caixa visível e se o dedo nos 4 pontos cai nele. */
export type Medida = {
  /** Única por elemento na tela (o coletor marca o elemento com data-auditoria), estável entre rolagens. */
  chave: string;
  seletor: string;
  largura: number;
  altura: number;
  /** norte, leste, sul, oeste: true se elementFromPoint ali é o alvo, um filho dele ou o ::after dele. Numa caixa maior
   * que 44 no eixo, vale a melhor janela de 44 dentro dela (um cabeçalho fixo pode cobrir uma ponta). */
  acertos: [boolean, boolean, boolean, boolean];
};

export type Achado = { tela: string; tipo: "alvo" | "texto" | "quebra" | "corte"; detalhe: string };

const PONTOS = ["norte", "leste", "sul", "oeste"] as const;

/** Um alvo falha se algum dos 4 pontos a 22 px do centro não cai nele: a área de toque efetiva é menor que 44×44. */
export function alvosPequenos(tela: string, medidas: Medida[]): Achado[] {
  const achados: Achado[] = [];
  for (const m of medidas) {
    const faltam = PONTOS.filter((_, i) => !m.acertos[i]);
    if (faltam.length === 0) continue;
    achados.push({ tela, tipo: "alvo", detalhe: `${m.seletor} ${Math.round(m.largura)}x${Math.round(m.altura)} (fora: ${faltam.join(", ")})` });
  }
  return achados;
}

/**
 * O que não pode aparecer escrito no celular (critérios 1, 2 e 6 da NOD-383): atalho de teclado, o macOS e o computador
 * como se fossem o aparelho, e qualquer informação de banco. "esc" só como palavra solta (a tecla), não dentro de "escuro".
 */
export const PROIBIDOS: { nome: string; padrao: RegExp }[] = [
  { nome: "⌘", padrao: /⌘/ },
  { nome: "⇧", padrao: /⇧/ },
  { nome: "esc", padrao: /(?<![\p{L}])esc(?![\p{L}])/iu },
  { nome: "macOS", padrao: /macos/i },
  { nome: "este computador", padrao: /(neste|este) computador/i },
  { nome: "este Mac", padrao: /\b(neste|este) mac\b/i },
  { nome: "Dock", padrao: /\bdock\b/i },
  { nome: "banco", padrao: /\bbanco\b|ef[eê]mero/i },
];

export function textosProibidos(tela: string, texto: string, kbdVisiveis: number): Achado[] {
  const achados: Achado[] = PROIBIDOS.filter((p) => p.padrao.test(texto)).map((p) => {
    const m = p.padrao.exec(texto)!;
    const trecho = texto.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, " ").trim();
    return { tela, tipo: "texto" as const, detalhe: `"${p.nome}" em "${trecho}"` };
  });
  if (kbdVisiveis > 0) achados.push({ tela, tipo: "texto", detalhe: `${kbdVisiveis} <kbd> visível(is)` });
  return achados;
}

/** Título de item que quebra em duas linhas (critério 3): altura maior que 1,5 linha. */
export function quebras(tela: string, titulos: { texto: string; altura: number; linha: number }[]): Achado[] {
  return titulos.filter((t) => t.altura > t.linha * 1.5).map((t) => ({ tela, tipo: "quebra" as const, detalhe: `"${t.texto}" ocupa ${Math.round(t.altura)}px (linha ${Math.round(t.linha)}px)` }));
}

/** O que o coletor devolve de uma tela. */
export type Coleta = { medidas: Medida[]; naoMedidos: { chave: string; seletor: string }[]; texto: string; kbd: number; titulos: { texto: string; altura: number; linha: number }[]; cortados: string[] };

/** Detalhe cortado com reticências sem o "Saiba mais" ao lado (critério 7): o resto do texto some sem caminho para lê-lo. */
export function cortesSemSaiba(tela: string, cortados: string[]): Achado[] {
  return [...new Set(cortados)].map((t) => ({ tela, tipo: "corte" as const, detalhe: `"${t}" cortado sem "Saiba mais"` }));
}

/**
 * O coletor que roda DENTRO da página: o executor manda `(${COLETOR})("#app")` ao Chrome. É texto (JS puro) porque o
 * tsconfig dos scripts não tem DOM. Mede só o que cabe inteiro na tela com a margem do dedo; o resto o executor mede
 * depois de rolar. Com um <dialog> aberto, só ele conta (o fundo está inerte).
 */
export const COLETOR = String.raw`function coletar(seletorRaiz) {
  const raio = ${RAIO_TOQUE};
  const dialogo = document.querySelector("dialog[open]");
  const raiz = dialogo || document.querySelector(seletorRaiz) || document.body;
  // Recortado por um ancestral (um recolhido em 0fr, uma lista com overflow): não está na tela.
  const recortado = (el, r) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const ra = a.getBoundingClientRect();
      if (r.right <= ra.left + 1 || r.left >= ra.right - 1 || r.bottom <= ra.top + 1 || r.top >= ra.bottom - 1) return true;
    }
    return false;
  };
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05 && !el.closest("[hidden],[inert],[aria-hidden=true]") && !recortado(el, r);
  };
  const nome = (el) => {
    const partes = [el.tagName.toLowerCase()];
    if (el.id) partes.push("#" + el.id);
    const classe = [...el.classList].slice(0, 2).map((c) => "." + c).join("");
    if (classe) partes.push(classe);
    if (el.dataset && el.dataset.act) partes.push("[data-act=" + el.dataset.act + "]");
    const rot = (el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return partes.join("") + (rot ? ' "' + rot + '"' : "");
  };
  window.__auditoria = window.__auditoria || 0;
  const chave = (el) => { if (!el.dataset.auditoria) el.dataset.auditoria = String(++window.__auditoria); return el.dataset.auditoria; };
  // O <label> que envolve um input escondido (um interruptor feito à mão) é o alvo: o input invisível não conta.
  const candidatos = [...raiz.querySelectorAll("button, a[href], [role=button], [role=switch], [role=tab], [role=menuitem], [data-act], input:not([type=hidden]), select, textarea, summary, label:has(input)")]
    .filter((el) => !el.disabled && visivel(el));
  // Um [data-act] dentro de um botão é o mesmo alvo.
  const alvos = candidatos.filter((el) => !candidatos.some((o) => o !== el && o.contains(el) && o.matches("button, a[href]")));
  const acerta = (el, x, y) => {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const sob = document.elementFromPoint(x, y);
    return !!sob && (sob === el || el.contains(sob));
  };
  // A melhor janela de 44 num eixo: o centro dela anda de 4 em 4 px dentro da caixa; numa caixa menor que 44, só o centro.
  // Os pontos são o primeiro e o último pixel da janela (c − 22 + 0,5 e c + 22 − 1): o Chrome arredonda o x,5 para cima,
  // e c + 21,5 cairia no pixel seguinte, já fora de uma caixa de 44 exatos.
  const janela = (el, fixo, ini, fim, vertical) => {
    const centros = [];
    if (fim - ini <= 2 * raio) centros.push((ini + fim) / 2);
    else for (let c = ini + raio; c <= fim - raio + 0.01; c += 4) centros.push(c);
    let melhor = [false, false];
    for (const c of centros) {
      const p = vertical ? [acerta(el, fixo, c - raio + 0.5), acerta(el, fixo, c + raio - 1)] : [acerta(el, c + raio - 1, fixo), acerta(el, c - raio + 0.5, fixo)];
      if (p[0] && p[1]) return p;
      if (p.filter(Boolean).length > melhor.filter(Boolean).length) melhor = p;
    }
    return melhor;
  };
  const medidas = [];
  const naoMedidos = [];
  for (const el of alvos) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const item = { chave: chave(el), seletor: nome(el) };
    // Fora da tela na vertical: a rolagem traz. Centro coberto: outra rolagem mede; se nenhuma medir, vira achado.
    if (cy < 0 || cy > innerHeight || !acerta(el, cx, cy)) { naoMedidos.push(item); continue; }
    const [norte, sul] = janela(el, cx, r.top, r.bottom, true);
    const [leste, oeste] = janela(el, cy, r.left, r.right, false);
    medidas.push({ ...item, largura: r.width, altura: r.height, acertos: [norte, leste, sul, oeste] });
  }
  const kbd = [...raiz.querySelectorAll("kbd, .cfg-kbd")].filter(visivel).length;
  const titulos = [...raiz.querySelectorAll(".cfg-item-nome:not(:has(b)), .cfg-item-nome > b, .lc-txt > b")].filter(visivel).map((el) => {
    const cs = getComputedStyle(el);
    return { texto: el.innerText.trim(), altura: el.getBoundingClientRect().height, linha: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 };
  });
  // O placeholder aparece na tela mas não está no innerText.
  const placeholders = [...raiz.querySelectorAll("[placeholder]")].filter(visivel).map((el) => el.getAttribute("placeholder")).join("\n");
  const cortados = [...raiz.querySelectorAll(".lc-txt small:not(.lc-aberto), .lc-nota-curta:not(.lc-aberto)")].filter((el) => visivel(el) && el.scrollWidth > el.clientWidth + 1)
    .filter((el) => { const linha = el.closest(".lc-com-saiba") || el.closest(".lc-linha"); return !(linha && linha.querySelector(".lc-saiba")) && !(el.nextElementSibling && el.nextElementSibling.matches(".lc-saiba")); })
    .map((el) => el.innerText.trim().slice(0, 60));
  return { medidas, naoMedidos, texto: (raiz.innerText || "") + "\n" + placeholders, kbd, titulos, cortados };
}`;

/** Junta as medidas de várias rolagens: o mesmo elemento (pela chave) medido duas vezes conta uma, e vale a melhor. */
export function juntar(lotes: Medida[][]): Medida[] {
  const porChave = new Map<string, Medida>();
  for (const m of lotes.flat()) {
    const antes = porChave.get(m.chave);
    if (!antes || m.acertos.filter(Boolean).length > antes.acertos.filter(Boolean).length) porChave.set(m.chave, m);
  }
  return [...porChave.values()];
}

/** Alvo que nenhuma rolagem conseguiu medir (centro sempre coberto ou fora da tela) falha: silêncio não é aprovação. */
export function semMedida(tela: string, naoMedidos: { chave: string; seletor: string }[], medidas: Medida[]): Achado[] {
  const medidos = new Set(medidas.map((m) => m.chave));
  const vistos = new Set<string>();
  return naoMedidos.filter((n) => !medidos.has(n.chave) && !vistos.has(n.chave) && (vistos.add(n.chave), true)).map((n) => ({ tela, tipo: "alvo" as const, detalhe: `${n.seletor} sem medida (centro coberto ou fora da tela)` }));
}
