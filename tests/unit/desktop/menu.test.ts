import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { templateDoMenu } from "../../../desktop/menu.ts";

/** NOD-174: o menu do Mac em pt-BR. Todo item com `role` ganha `label` explícito; o rótulo nativo do Electron é em inglês. */
const nada = { conexao: () => undefined, definirAvisos: () => undefined, exportarDiagnostico: () => undefined, buscar: () => undefined };

function itens(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? itens(i.submenu) : [])]);
}
const rotulos = (empacotado: boolean) => itens(templateDoMenu({ avisos: true, empacotado }, nada)).filter((i) => i.type !== "separator").map((i) => i.label);

describe("templateDoMenu", () => {
  it("nenhum item visível fica sem rótulo, nem item com role", () => {
    for (const empacotado of [true, false]) {
      for (const item of itens(templateDoMenu({ avisos: false, empacotado }, nada))) {
        if (item.type === "separator") continue;
        expect(item.label, JSON.stringify(item)).toBeTruthy();
      }
    }
  });

  it("os rótulos são os da spec, em pt-BR", () => {
    expect(rotulos(true)).toEqual([
      "nod", "Conexão / verificar conta de IA", "Exportar diagnóstico…", "Avisos no Mac", "Sair do nod",
      "Editar", "Desfazer", "Refazer", "Recortar", "Copiar", "Colar", "Selecionar tudo",
      "Buscar", "Buscar", "Buscar próxima", "Buscar anterior",
      "Visualizar", "Recarregar", "Tamanho real", "Aumentar", "Diminuir", "Tela cheia",
    ]);
  });

  it("nenhum rótulo em inglês", () => {
    const ingles = /\b(Quit|Edit|View|Undo|Redo|Cut|Copy|Paste|Select|Reload|Zoom|Toggle|Developer|Tools|Actual|Size|Full ?Screen)\b/i;
    for (const r of rotulos(false)) expect(r).not.toMatch(ingles);
  });

  it("Ferramentas de desenvolvedor só fora do app empacotado", () => {
    const devtools = (empacotado: boolean) => itens(templateDoMenu({ avisos: true, empacotado }, nada)).filter((i) => i.role === "toggleDevTools");
    expect(devtools(true)).toEqual([]);
    expect(devtools(false).map((i) => i.label)).toEqual(["Ferramentas de desenvolvedor"]);
  });

  it("o checkbox Avisos segue a preferência e chama a ação", () => {
    const chamadas: boolean[] = [];
    for (const avisos of [true, false]) {
      const item = itens(templateDoMenu({ avisos, empacotado: true }, { ...nada, definirAvisos: (l) => chamadas.push(l) })).find((i) => i.label === "Avisos no Mac");
      expect(item?.checked).toBe(avisos);
      item?.click?.({ checked: !avisos } as never, undefined, {} as never);
    }
    expect(chamadas).toEqual([false, true]);
  });

  it("Exportar diagnóstico… (NOD-138) chama a ação, empacotado ou não", () => {
    for (const empacotado of [true, false]) {
      let chamou = 0;
      const item = itens(templateDoMenu({ avisos: true, empacotado }, { ...nada, exportarDiagnostico: () => { chamou += 1; } })).find((i) => i.label === "Exportar diagnóstico…");
      expect(item?.role).toBeUndefined();
      item?.click?.({} as never, undefined, {} as never);
      expect(chamou).toBe(1);
    }
  });

  it("os itens nativos mantêm o role (Copiar e Colar seguem funcionando)", () => {
    const porRotulo = new Map(itens(templateDoMenu({ avisos: true, empacotado: true }, nada)).map((i) => [i.label, i.role]));
    expect(porRotulo.get("Copiar")).toBe("copy");
    expect(porRotulo.get("Colar")).toBe("paste");
    expect(porRotulo.get("Sair do nod")).toBe("quit");
  });

  it("NOD-42: Editar › Buscar mostra ⌘F/⌘G/⇧⌘G sem tomar a tecla e repassa o clique à página", () => {
    const acoes: string[] = [];
    const todos = itens(templateDoMenu({ avisos: true, empacotado: true }, { ...nada, buscar: (a) => acoes.push(a) }));
    const buscar = todos.find((i) => i.label === "Buscar" && Array.isArray(i.submenu));
    const sub = (buscar?.submenu ?? []) as MenuItemConstructorOptions[];
    expect(sub.map((i) => [i.label, i.accelerator, i.registerAccelerator])).toEqual([
      ["Buscar", "CmdOrCtrl+F", false], ["Buscar próxima", "CmdOrCtrl+G", false], ["Buscar anterior", "Shift+CmdOrCtrl+G", false],
    ]);
    for (const i of sub) i.click?.({} as never, undefined, {} as never);
    expect(acoes).toEqual(["abrir", "proxima", "anterior"]);
  });

  it("NOD-42: sem a ação de busca, o submenu não aparece", () => {
    const { buscar: _b, ...semBusca } = nada;
    expect(itens(templateDoMenu({ avisos: true, empacotado: true }, semBusca)).some((i) => i.label === "Buscar")).toBe(false);
  });
});

describe("NOD-132: a atualização do app no menu nod", () => {
  const rotulosCom = (atualizacao: Parameters<typeof templateDoMenu>[0]["atualizacao"]) => itens(templateDoMenu({ avisos: true, empacotado: true, atualizacao }, nada)).filter((i) => i.type !== "separator").map((i) => [i.label, i.enabled !== false]);
  it("mostra o item conforme o estado, depois de Exportar diagnóstico", () => {
    expect(rotulosCom({ fase: "ociosa", procuradaEm: null }).slice(1, 4)).toEqual([["Conexão / verificar conta de IA", true], ["Exportar diagnóstico…", true], ["Procurar atualizações…", true]]);
    expect(rotulosCom({ fase: "erro", mensagem: "x" })[3]).toEqual(["Procurar atualizações…", true]);
    expect(rotulosCom({ fase: "procurando", manual: true })[3]).toEqual(["Procurando atualização…", false]);
    expect(rotulosCom({ fase: "baixando", manual: false })[3]).toEqual(["Baixando atualização…", false]);
    expect(rotulosCom({ fase: "pronta", versao: "1.2.0" })[3]).toEqual(["Reiniciar para atualizar (1.2.0)", true]);
    expect(rotulosCom({ fase: "desligada", motivo: "Mova o nod para Aplicativos para receber atualizações." })[3]).toEqual(["Mova o nod para Aplicativos para receber atualizações.", false]);
    expect(rotulosCom(undefined)[3]).toEqual(["Avisos no Mac", true]);
  });
  it("os cliques chamam as ações", () => {
    let procurou = 0, reiniciou = 0;
    const acoes = { ...nada, procurarAtualizacao: () => { procurou++; }, reiniciarParaAtualizar: () => { reiniciou++; } };
    itens(templateDoMenu({ avisos: true, empacotado: true, atualizacao: { fase: "ociosa", procuradaEm: null } }, acoes)).find((i) => i.label === "Procurar atualizações…")?.click?.({} as never, undefined, {} as never);
    itens(templateDoMenu({ avisos: true, empacotado: true, atualizacao: { fase: "pronta", versao: "1.2.0" } }, acoes)).find((i) => i.label === "Reiniciar para atualizar (1.2.0)")?.click?.({} as never, undefined, {} as never);
    expect([procurou, reiniciou]).toEqual([1, 1]);
  });
});
