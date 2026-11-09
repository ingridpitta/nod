// Auditoria de toque do celular (NOD-383, ADR-094). Abre o app num Chrome headless em 390×844 com toque (hover: none,
// pointer: coarse), percorre o início, a gaveta, o menu da conta, a lista de Configurações, as 6 seções e a folha de
// criar bot (segurando o + do topo) e falha listando cada alvo com área de toque menor que 44×44 (medida por
// elementFromPoint a 22 px do centro, nos 4 pontos cardinais), cada texto proibido no celular (atalho de teclado, macOS,
// "este computador", banco), cada título de item que quebra em duas linhas e cada detalhe cortado sem "Saiba mais".
// Não cobre (fica para o QA à mão): a conversa com mensagens, as prévias de arquivo e o computador do bot. Não roda no
// CI (precisa do Chrome e de um servidor stub): rode antes de abrir um PR que mexe na interface do celular. É a regressão
// de quem mexer na interface do celular (NOD-379/381/382/383).
//
//   1. um servidor com NOD_LOGIN=stub e a web compilada (`npx vite build`), por exemplo o do teste de carga:
//      CARGA_BANCO_PORTA=<porta do banco efêmero> CARGA_API_PORTA=8893 CARGA_WEB_DIR=$PWD/dist/web node scripts/carga-tela/servidor.ts
//   2. node scripts/alvos-44px/rodar.ts [claro|escuro]      (AUDITORIA_URL, padrão http://127.0.0.1:8893)
//
// O Chrome é o do cache do Playwright ou CARGA_CHROME (scripts/carga-tela/cdp.ts). Saída 0 = tudo limpo; 1 = achados.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirChrome, avaliar, type Cdp } from "../carga-tela/cdp.ts";
import { alvosPequenos, COLETOR, cortesSemSaiba, juntar, quebras, semMedida, textosProibidos, type Achado, type Coleta, type Medida } from "./regra.ts";

const URL_APP = process.env.AUDITORIA_URL ?? "http://127.0.0.1:8893";
const PORTA_CDP = Number(process.env.AUDITORIA_CDP_PORTA ?? 9361);
const SAIDA = process.env.AUDITORIA_SAIDA ?? join(tmpdir(), "nod-alvos-44px");
const TEMA = process.argv[2] === "escuro" ? "dark" : "light";
const LARGURA = 390;
const ALTURA = 844;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ate(cdp: Cdp, expressao: string, oQue: string, ms = 8000): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
    await espera(100);
  }
  throw new Error(`esperei ${ms} ms por ${oQue}`);
}

const clicar = (seletor: string) => `(() => { const el = document.querySelector(${JSON.stringify(seletor)}); if (!el) throw new Error("não achei ${seletor.replace(/"/g, "'")}"); el.click(); return true; })()`;

/** Mede a tela inteira: rola cada área rolável dentro da raiz e junta as medidas. */
async function medirTela(cdp: Cdp, nome: string, raiz: string): Promise<Achado[]> {
  const lotes: Medida[][] = [];
  const naoMedidos: Coleta["naoMedidos"] = [];
  const texto: string[] = [];
  let kbd = 0;
  const titulos: Coleta["titulos"] = [];
  const cortados: string[] = [];
  // A tela pode abrir já rolada (a gaveta mostra o bot da conversa atual): volta tudo ao topo, porque daqui só se desce.
  await avaliar(cdp, `(() => {
    const raiz = document.querySelector("dialog[open]") || document.querySelector(${JSON.stringify(raiz)}) || document.body;
    for (const el of [raiz, ...raiz.querySelectorAll("*")]) if (el.scrollTop > 0) el.scrollTop = 0;
  })()`);
  await espera(150);
  for (let passo = 0; passo < 12; passo++) {
    const c = await avaliar<Coleta>(cdp, `(${COLETOR})(${JSON.stringify(raiz)})`);
    lotes.push(c.medidas);
    naoMedidos.push(...c.naoMedidos);
    texto.push(c.texto);
    kbd = Math.max(kbd, c.kbd);
    titulos.push(...c.titulos);
    cortados.push(...c.cortados);
    // Rola um passo a área rolável (a maior) da raiz; acabou quando nada mais desce.
    const desceu = await avaliar<boolean>(cdp, `(() => {
      const raiz = document.querySelector("dialog[open]") || document.querySelector(${JSON.stringify(raiz)}) || document.body;
      const roláveis = [raiz, ...raiz.querySelectorAll("*")].filter((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY));
      const el = roláveis.sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
      const antes = el.scrollTop; el.scrollTop += Math.round(innerHeight * 0.6); return el.scrollTop > antes;
    })()`);
    if (!desceu) break;
    await espera(150);
  }
  const vistos = new Set<string>();
  const unicos = titulos.filter((t) => (vistos.has(t.texto) ? false : (vistos.add(t.texto), true)));
  await foto(cdp, nome);
  const medidas = juntar(lotes);
  return [...alvosPequenos(nome, medidas), ...semMedida(nome, naoMedidos, medidas), ...textosProibidos(nome, texto.join("\n"), kbd), ...quebras(nome, unicos), ...cortesSemSaiba(nome, cortados)];
}

async function foto(cdp: Cdp, nome: string): Promise<void> {
  const { data } = await cdp.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SAIDA, `${TEMA}-${nome.replace(/[^a-z0-9]+/gi, "-")}.png`), Buffer.from(data, "base64"));
}

/** Segura o + do topo da gaveta com o dedo (toque emulado) por 700 ms: no celular abre "Criar um bot agora?". */
async function segurarMais(cdp: Cdp): Promise<void> {
  const { x, y } = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector("[data-segurar=segurar-mais]").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await espera(700);
  await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function entrar(): Promise<string> {
  const modo = (await (await fetch(`${URL_APP}/api/sessao/modo`)).json()) as { modo: string; pessoas: { id: string; nome: string }[] };
  if (modo.modo !== "stub") throw new Error(`a auditoria precisa de NOD_LOGIN=stub (o servidor está em ${modo.modo})`);
  const pessoa = modo.pessoas.find((p) => p.nome === "Marlon") ?? modo.pessoas[0];
  if (!pessoa) throw new Error("nenhuma pessoa no cadastro: rode o seed");
  const r = await fetch(`${URL_APP}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId: pessoa.id }) });
  if (!r.ok) throw new Error(`entrar: ${r.status}`);
  return (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function principal(): Promise<number> {
  mkdirSync(SAIDA, { recursive: true });
  const cookie = await entrar();
  const { cdp } = await abrirChrome(PORTA_CDP, join(SAIDA, "perfil"));
  const achados: Achado[] = [];
  try {
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    const [nome, valor] = cookie.split("=");
    await cdp.enviar("Network.setCookie", { name: nome, value: valor ?? "", url: URL_APP });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: LARGURA, height: ALTURA, deviceScaleFactor: 3, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: TEMA }, { name: "hover", value: "none" }, { name: "pointer", value: "coarse" }, { name: "any-hover", value: "none" }, { name: "any-pointer", value: "coarse" }] }).catch(() => undefined);
    await cdp.enviar("Page.navigate", { url: URL_APP });
    await ate(cdp, `document.querySelector("[data-act=menu-conta]")`, "o app carregar", 30000);
    if (!(await avaliar<boolean>(cdp, `matchMedia("(hover: none) and (pointer: coarse)").matches`))) throw new Error("a emulação de toque não pegou: o app não está no modo celular");
    await espera(800);

    achados.push(...(await medirTela(cdp, "inicio", "#app")));

    await avaliar(cdp, clicar("[data-act=abrir-bots]"));
    await espera(500);
    achados.push(...(await medirTela(cdp, "gaveta", "#sidebar")));
    await avaliar(cdp, clicar("[data-act=abrir-bots]"));
    await espera(400);

    await avaliar(cdp, clicar("[data-act=menu-conta]"));
    await ate(cdp, `document.querySelector("[role=menuitem][data-secao=geral]")`, "o menu da conta");
    achados.push(...(await medirTela(cdp, "menu-conta", "[role=menu]")));
    await avaliar(cdp, clicar("[role=menuitem][data-secao=geral]"));
    await ate(cdp, `document.querySelector("#espaco .cfg-lista-tela")`, "a lista de Configurações");
    await espera(400);
    achados.push(...(await medirTela(cdp, "configuracoes", "#espaco")));

    for (const secao of ["conta", "geral", "conexao", "maquinas", "agentes", "feedback"]) {
      await ate(cdp, `document.querySelector("#espaco .cfg-lista-tela")`, "a lista de Configurações");
      await avaliar(cdp, clicar(`#espaco .cfg-item[data-secao=${secao}]`));
      await espera(600);
      // A Conta com contas ligadas abre a tela da Minha conta (um <dialog>); o coletor mede o diálogo aberto.
      achados.push(...(await medirTela(cdp, `secao-${secao}`, "#espaco")));
      const voltou = await avaliar<boolean>(cdp, `(() => { const v = document.querySelector("dialog[open] [data-act=cfg-lista], #espaco [data-act=cfg-lista]"); if (!v) return false; v.click(); return true; })()`);
      if (!voltou) achados.push({ tela: `secao-${secao}`, tipo: "alvo", detalhe: "sem o ‹ que volta para Configurações" });
      await espera(500);
    }
    await avaliar(cdp, `document.querySelector("#espaco [data-act=fechar-espaco]")?.click()`);
    await espera(500);

    // O + fica no topo da gaveta (a lista de bots), que no celular abre pelo ☰.
    await avaliar(cdp, clicar("[data-act=abrir-bots]"));
    await espera(500);
    await segurarMais(cdp);
    await ate(cdp, `document.querySelector("dialog#folha-criar-bot[open]")`, "a folha de criar bot");
    await espera(400);
    achados.push(...(await medirTela(cdp, "folha-criar-bot", "#folha-criar-bot")));
    await avaliar(cdp, clicar("#folha-criar-bot .fcb-cancelar"));
  } catch (e) {
    await foto(cdp, "erro").catch(() => undefined);
    throw e;
  } finally {
    cdp.fechar();
  }
  writeFileSync(join(SAIDA, `${TEMA}-achados.json`), JSON.stringify(achados, null, 2));
  if (achados.length === 0) {
    process.stdout.write(`alvos-44px (${TEMA}): limpo em ${LARGURA}x${ALTURA}. Fotos em ${SAIDA}\n`);
    return 0;
  }
  process.stdout.write(`alvos-44px (${TEMA}): ${achados.length} achado(s) em ${LARGURA}x${ALTURA}\n`);
  for (const a of achados) process.stdout.write(`  [${a.tela}] ${a.tipo}: ${a.detalhe}\n`);
  return 1;
}

process.exit(await principal());
