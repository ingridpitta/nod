import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { estadoInicial, type ConectarMaquina, type Estado } from "../../../web/estado/reducer.ts";
import { readFileSync } from "node:fs";
import { proximoItemDoMenu } from "../../../web/lib/linha-config.ts";
import { linhaMaquinaDoBot } from "../../../web/telas/detalhes.ts";
import { COMANDO_DESLIGAR_COMPUTADOR, donoDoUso, maquinaDoBot, maquinaNova, maquinasDeTrabalho, renderMaquinas } from "../../../web/telas/maquinas.ts";

/** ADR-090: Seu espaço › Máquinas e o "Conectar uma máquina" (protótipo "Nod — Motor na VM"). */
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false, ...o });
const bot = (id: string, nome: string, maquinaId: string | null = null) => ({ id, nome, titulo: "Dev", ownerId: "p", cor: "c-red", forma: "shape-square", conversaId: `c-${id}`, maquinaId, excluidoEm: null });
const conectar = (o: Partial<ConectarMaquina> = {}): ConectarMaquina => ({ passo: "comando", codigo: "", pedido: null, erro: null, chavesAntes: [], marcados: [], ...o });

function com(maquinas: MaquinaDto[], o: { padraoId?: string | null; conectar?: ConectarMaquina | null; bots?: ReturnType<typeof bot>[]; noMac?: boolean } = {}): Estado {
  return { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, maquinas: { maquinas, padraoId: o.padraoId ?? null, ...(o.noMac ? { servidorNoMac: { api: "http://127.0.0.1:8888" } } : {}) }, conectarMaquina: o.conectar ?? null, frota: { agentes: o.bots ?? [bot("a", "Ze 1", "vm"), bot("b", "Clarice")] } as never };
}

/** NOD-373: o "…" aberto de uma máquina, e só ele. */
function menuDe(estado: Estado, id: string): string {
  const html = renderMaquinas({ ...estado, contasUi: { ...estado.contasUi, maquinaMenu: id } } as Estado);
  const i = html.indexOf('class="cl-menu"');
  return i < 0 ? "" : html.slice(i, html.indexOf("</div></span></div>", i));
}
const comLeitura = (estado: Estado, leituras: { id: string; nome: string; ehMac: boolean }[]): Estado =>
  ({ ...estado, trabalhos: { trabalhos: [], pressao: "verde", maquinas: leituras.map((l) => ({ ...l, pressao: "verde", processador: "verde" })) } } as never);
const USO = "Quanto os bots podem usar";

describe("NOD-373: \"Quanto os bots podem usar\" numa máquina só", () => {
  const vm = maquina("vm", "vm-sp");
  const vm2 = maquina("vm2", "vm-rj");
  const pc = maquina("pc", "pc-bot", { papel: "computador" } as Partial<MaquinaDto>);
  const mac = maquina("mac", "MacBook do Marlon", { plataforma: "darwin" });

  it("critério 6: com Mac, o controle fica só no \"…\" do Mac; as outras dizem onde ele está", () => {
    const e = comLeitura(com([vm, mac, vm2], { padraoId: "vm" }), [{ id: "mac", nome: "MacBook do Marlon", ehMac: true }]);
    expect(menuDe(e, "mac")).toContain(USO);
    for (const id of ["vm", "vm2"]) {
      const menu = menuDe(e, id);
      expect(menu).not.toContain(USO);
      expect(menu).not.toContain('data-act="uso-do-mac"');
      expect(menu).toContain(`data-menu-texto="uso-onde-${id}">O limite de uso fica no “…” da máquina MacBook do Marlon.</div>`);
    }
  });

  it("critério 6: o Mac do servidor sem chave guarda o controle", () => {
    const e = comLeitura(com([vm], { padraoId: "vm" }), [{ id: "este-mac", nome: "Este Mac", ehMac: true }]);
    expect(menuDe(e, "este-mac")).toContain(USO);
    expect(menuDe(e, "vm")).toContain("O limite de uso fica no “…” da máquina Este Mac.");
  });

  it("revisão NOD-373: antes de a leitura chegar, o Mac (darwin) já guarda o controle — ele não pula da padrão para o Mac", () => {
    const e = com([vm, mac], { padraoId: "vm" });
    expect(menuDe(e, "mac")).toContain(USO);
    expect(menuDe(e, "vm")).toContain("O limite de uso fica no “…” da máquina MacBook do Marlon.");
  });

  it("revisão NOD-373: com leituras chegando mas o Mac (darwin) sem leitura, ele segue com o controle", () => {
    const e = comLeitura(com([vm, mac], { padraoId: "vm" }), [{ id: "vm", nome: "vm-sp", ehMac: false }]);
    expect(menuDe(e, "mac")).toContain(USO);
    expect(menuDe(e, "vm")).not.toContain(USO);
  });

  it("revisão NOD-373: um 2º Mac (darwin) por chave não vira \u201cEste Mac\u201d — só o do servidor (ehMac)", () => {
    const mac2 = maquina("mac2", "MacBook da Ana", { plataforma: "darwin" });
    const html = renderMaquinas(comLeitura(com([vm, mac, mac2], { padraoId: "vm" }), [{ id: "mac", nome: "MacBook do Marlon", ehMac: true }]));
    expect(html.match(/Este Mac · /g)).toHaveLength(1);
  });

  it("QA NOD-373: Mac sem contato (plataforma null) conta como sem Mac — a padrão guarda o controle e o Mac diz onde ele está", () => {
    const macCalado = maquina("mac", "MacBook do Marlon", { plataforma: null, conectada: false });
    const e = com([vm, macCalado, vm2], { padraoId: "vm2" });
    expect(menuDe(e, "vm2")).toContain(USO);
    expect(menuDe(e, "mac")).toContain("O limite de uso fica no “…” da máquina vm-rj.");
  });

  it("critério 7: sem Mac, só a máquina padrão tem o controle; critério 8: as outras só a linha", () => {
    const e = com([vm, vm2], { padraoId: "vm2" });
    expect(menuDe(e, "vm2")).toContain(USO);
    const outra = menuDe(e, "vm");
    expect(outra).not.toContain(USO);
    expect(outra).toContain("O limite de uso fica no “…” da máquina vm-rj.");
    expect(outra.match(/uso-onde/g)).toHaveLength(1);
  });

  it("sem Mac e sem padrão (ou padrão fora da lista), a primeira máquina de trabalho guarda o controle; a só computador não mostra nada", () => {
    expect(donoDoUso([pc, vm, vm2], new Set(), null, null)).toEqual({ id: "vm", nome: "vm-sp" });
    expect(donoDoUso([pc, vm, vm2], new Set(), null, "pc")).toEqual({ id: "vm", nome: "vm-sp" });
    expect(donoDoUso([pc], new Set(), null, null)).toBeNull();
    const e = com([pc, vm], { padraoId: null });
    expect(menuDe(e, "vm")).toContain(USO);
    const menuPc = menuDe(e, "pc");
    expect(menuPc).not.toContain(USO);
    expect(menuPc).not.toContain("O limite de uso fica");
  });
});

describe("Seu espaço › Máquinas (ADR-090)", () => {
  it("NOD-367: uma lista só, com o status em ponto e texto, quantos bots em cada uma e o padrão num seletor", () => {
    const html = renderMaquinas(com([maquina("vm", "vm-sp"), maquina("mac", "MacBook", { plataforma: "darwin" }), maquina("velha", "vm-velha", { conectada: false, plataforma: null, ultimoUsoEm: Date.UTC(2026, 9, 9, 14, 32) })]));
    expect(html).toContain("vm-sp");
    expect(html).toContain("1 bot aqui");
    expect(html).toMatch(/Offline desde \d\d\/\d\d/);
    expect(html).not.toContain("Claude Code pronto");
    const aberto = renderMaquinas({ ...com([maquina("vm", "vm-sp")]), contasUi: { ...estadoInicial.contasUi, maquinaMenu: "vm" } } as Estado);
    expect(aberto).toContain("Claude Code pronto");
    // NOD-367 (a11y): todo texto do "…" é item desabilitado (o leitor de tela chega nele pelas setas), nunca um <p> solto
    const menu = aberto.slice(aberto.indexOf('class="cl-menu"'));
    expect(menu).toMatch(/<div class="cfg-leitura" role="menuitem" aria-disabled="true" tabindex="-1" data-menu-texto="contas-vm">Claude Code pronto/);
    expect(menu).not.toMatch(/<p class="cfg-leitura"/);
    expect(aberto).toContain('data-act="maq-desconectar"');
    expect(aberto).toContain('role="menuitem"');
    expect(html).toContain('data-act-change="maquina-padrao"');
    // o seletor de cada bot saiu da tela: ele mora na ficha do bot
    expect(html).not.toContain("maquina-do-bot");
    for (const velho of ["mac-bot", "bot-maq", "lista chaves", "maq-topo"]) expect(html).not.toContain(velho);
    expect(html.match(/data-maquina-linha=/g)).toHaveLength(3);
  });

  it("NOD-367: as chaves revogadas só aparecem com alguma, recolhidas; a chave da máquina abre pelo \"…\"", () => {
    const ativa = { id: "vm", nome: "vm-sp", prefixo: "abcd1234", criadaEm: Date.UTC(2026, 9, 1, 12), ultimoUsoEm: null, revogadaEm: null };
    const velha = { ...ativa, id: "x", nome: "vm-antiga", revogadaEm: Date.UTC(2026, 9, 3, 12) };
    const base = com([maquina("vm", "vm-sp")]);
    expect(renderMaquinas({ ...base, chaves: [ativa] } as Estado)).not.toContain("Chaves revogadas");
    const comRevogada = renderMaquinas({ ...base, chaves: [ativa, velha] } as Estado);
    expect(comRevogada).toContain("Chaves revogadas (1)");
    expect(comRevogada).not.toContain("vm-antiga");
    expect(renderMaquinas({ ...base, chaves: [ativa, velha], configUi: { ...base.configUi, abertos: ["revogadas"] } } as Estado)).toMatch(/vm-antiga[\s\S]*Revogada em \d\d\/\d\d/);
    const menu = renderMaquinas({ ...base, chaves: [ativa], contasUi: { ...base.contasUi, maquinaMenu: "vm" } } as Estado);
    expect(menu).toContain('data-act="revogar-chave" data-id="vm"');
    expect(menu).toContain('data-recolhe="chave-vm"');
    const detalhes = renderMaquinas({ ...base, chaves: [ativa], configUi: { ...base.configUi, abertos: ["chave-vm"] } } as Estado);
    expect(detalhes).toMatch(/role="region"[\s\S]*Prefixo[\s\S]*abcd1234/);
  });

  it("sem máquinas, o vazio explica; carregando, diz que carrega", () => {
    expect(renderMaquinas(com([]))).toContain("Nenhuma máquina conectada ainda");
    expect(renderMaquinas({ ...com([]), maquinas: null })).toContain("Verificando…");
  });

  it("a máquina do bot é a dele, senão o padrão da pessoa, senão nenhuma", () => {
    const e = com([maquina("vm", "vm-sp"), maquina("mac", "MacBook")], { padraoId: "mac" });
    expect(maquinaDoBot(e, { maquinaId: "vm" })?.id).toBe("vm");
    expect(maquinaDoBot(e, { maquinaId: null })?.id).toBe("mac");
    expect(maquinaDoBot(com([maquina("vm", "vm-sp")]), { maquinaId: "sumiu" })).toBeNull();
  });

  it("conectar: o comando com o endereço do Nod, o código, a confirmação com o código e a idade do pedido", () => {
    expect(renderMaquinas(com([], { conectar: conectar() }))).toContain("/motor | sh");
    expect(renderMaquinas(com([], { conectar: conectar({ passo: "codigo", erro: "Esse código não existe" }) }))).toContain('role="alert"');
    const confirmar = renderMaquinas(com([], { conectar: conectar({ passo: "confirmar", codigo: "k7qm-4f2x", pedido: { nome: "vm-sp", plataforma: "linux", pedidoHaS: 300 } }) }));
    expect(confirmar).toContain("código K7QM-4F2X");
    expect(confirmar).toContain("há 5 minutos");
    expect(confirmar).toContain('data-act="aprovar-maquina"');
  });

  it("depois de aprovar, o Continuar espera a máquina nova aparecer; a escolha dos bots conta os marcados", () => {
    const esperando = renderMaquinas(com([maquina("mac", "MacBook")], { conectar: conectar({ passo: "ias", chavesAntes: ["mac"] }) }));
    expect(esperando).toContain("esperando a máquina terminar de conectar");
    expect(esperando).toMatch(/data-act="passo-conectar-maquina" data-passo="bots" disabled/);
    const estado = com([maquina("mac", "MacBook"), maquina("vm", "vm-sp")], { conectar: conectar({ passo: "bots", chavesAntes: ["mac"], marcados: ["a"] }) });
    expect(maquinaNova(estado, estado.conectarMaquina!)?.id).toBe("vm");
    const bots = renderMaquinas(estado);
    expect(bots).toContain("1 de 2 bots");
    expect(bots).toContain("Mover 1 bot");
    expect(bots).toContain('aria-checked="true" data-act="marcar-bot-maquina" data-id="a"');
    expect(bots).toContain("Bot novo também passa a trabalhar nela");
  });

  it("ADR-092: com o servidor no Mac, a opção sem máquina é \"Este Mac\", o Conectar mostra o túnel e a porta da API, e bot novo fica no Mac", () => {
    const html = renderMaquinas(com([maquina("vm", "vm-sp")], { noMac: true }));
    expect(html).toContain(">Este Mac<");
    expect(html).not.toContain("Qualquer uma");
    expect(html).toContain("uma VM só pega o trabalho dos bots escolhidos para ela");
    const comando = renderMaquinas(com([], { noMac: true, conectar: conectar() }));
    expect(comando).toContain("ssh -N -R 8888:127.0.0.1:8888");
    expect(comando).toContain("curl -fsSL http://127.0.0.1:8888/api/motor/instalar | sh");
    expect(renderMaquinas(com([], { noMac: true }))).toContain("Os bots rodam neste Mac");
    const bots = renderMaquinas(com([maquina("mac", "MacBook"), maquina("vm", "vm-sp")], { noMac: true, conectar: conectar({ passo: "bots", chavesAntes: ["mac"], marcados: ["a"] }) }));
    expect(bots).toContain("Os outros, e bot novo, continuam neste Mac");
  });

describe("Máquinas: a só-computador (NOD-94)", () => {
  const comp = maquina("comp", "vm-computador", { papel: "computador" });

  it("aparece na lista com o rótulo, mas fica fora dos seletores e nunca é a máquina do bot", () => {
    const e = com([maquina("vm", "vm-sp"), comp], { padraoId: "comp" });
    expect(maquinasDeTrabalho(e.maquinas!.maquinas).map((m) => m.id)).toEqual(["vm"]);
    const html = renderMaquinas(e);
    expect(html).toContain("vm-computador");
    expect(html).toContain("só computador");
    expect(html).toContain("hospeda o computador dos seus bots e não pega trabalho");
    expect(html).not.toMatch(/<option value="comp"/);
    expect(maquinaDoBot(e, { maquinaId: "comp" })).toBeNull();
    expect(maquinaNova(com([comp], { conectar: conectar({ chavesAntes: [] }) }), conectar({ chavesAntes: [] }))).toBeNull();
  });

  it("o atalho para instalar por SSH aparece no servidor e some no modo local", () => {
    expect(renderMaquinas(com([maquina("vm", "vm-sp")]))).toContain('data-act="ssh-abrir"');
    expect(renderMaquinas(com([maquina("vm", "vm-sp")], { noMac: true }))).not.toContain('data-act="ssh-abrir"');
  });

  it("desligar a só-computador é um comando que existe", () => {
    expect(COMANDO_DESLIGAR_COMPUTADOR).toBe("sudo systemctl disable --now nod-motor");
  });
});
});

describe("NOD-367: a máquina na ficha do bot", () => {
  it("o seletor mostra \"Qualquer uma\" e as máquinas vivas (mais a atual, mesmo offline) e chama PUT /agentes/:id/maquina", () => {
    const e = com([maquina("vm", "vm-sp"), maquina("velha", "vm-velha", { conectada: false }), maquina("morta", "vm-morta", { conectada: false }), maquina("comp", "vm-comp", { papel: "computador" })]);
    const html = linhaMaquinaDoBot(e, { id: "a", nome: "Ze 1", maquinaId: "velha" });
    expect(html).toContain('data-act-change="maquina-do-bot"');
    expect(html).toContain('data-id="a"');
    expect(html).toContain(">Qualquer uma<");
    expect(html).toContain(">vm-sp<");
    expect(html).toMatch(/<option value="velha" selected>vm-velha \(offline\)</);
    expect(html).not.toContain("vm-morta");
    expect(html).not.toContain("vm-comp");
    expect(linhaMaquinaDoBot(com([]), { id: "a", nome: "Ze 1", maquinaId: null })).toBe("");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/"maquina-do-bot": \(valor, el\) => [\s\S]{0,80}api!?\.maquinaDoBot\(el\.dataset\.id/);
    const api = readFileSync(new URL("../../../web/lib/api.ts", import.meta.url), "utf8");
    expect(api).toMatch(/maquinaDoBot: [^\n]*"PUT", `\$\{base\}\/agentes\/\$\{[^}]+\}\/maquina`/);
  });

  it("NOD-367 (a11y do \"…\"): setas andam em volta, Home e End vão às pontas, outra tecla não mexe", () => {
    expect(proximoItemDoMenu(4, 0, "ArrowDown")).toBe(1);
    expect(proximoItemDoMenu(4, 3, "ArrowDown")).toBe(0);
    expect(proximoItemDoMenu(4, 0, "ArrowUp")).toBe(3);
    expect(proximoItemDoMenu(4, -1, "ArrowDown")).toBe(0);
    expect(proximoItemDoMenu(4, -1, "ArrowUp")).toBe(3);
    expect(proximoItemDoMenu(4, 2, "Home")).toBe(0);
    expect(proximoItemDoMenu(4, 0, "End")).toBe(3);
    expect(proximoItemDoMenu(4, 1, "Tab")).toBeNull();
    expect(proximoItemDoMenu(0, -1, "ArrowDown")).toBeNull();
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/closest\?\.<HTMLElement>\("#espaco \.cl-menu"\)[\s\S]{0,300}proximoItemDoMenu\(/);
  });
});
