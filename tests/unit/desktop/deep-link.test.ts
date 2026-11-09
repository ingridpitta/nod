import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  criarFilaDeepLink,
  criarLogAdiado,
  criarReceptorDeepLink,
  DEEP_LINK_MAX,
  deepLinkDoArgv,
  ESQUEMA_DEEP_LINK,
  INTERVALO_DEEP_LINK_MS,
  lerDeepLink,
  VALIDADE_DEEP_LINK_MS,
} from "../../../desktop/deep-link.ts";

/** NOD-136: o link `nod://` vem de fora do app (qualquer página pode montar um); só três alvos passam. */
const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("lerDeepLink", () => {
  it("abre a conversa pelo UUID", () => {
    expect(lerDeepLink(`nod://conversa/${ID}`)).toEqual({ ok: true, alvo: { tipo: "conversa", conversaId: ID } });
  });

  it("aceita a barra no fim e normaliza a caixa do UUID e do esquema/host", () => {
    expect(lerDeepLink(`nod://conversa/${ID}/`)).toEqual({ ok: true, alvo: { tipo: "conversa", conversaId: ID } });
    expect(lerDeepLink(`NOD://Conversa/${ID.toUpperCase()}`)).toEqual({ ok: true, alvo: { tipo: "conversa", conversaId: ID } });
  });

  it("abre Sua vez e o computador do bot, com ou sem barra", () => {
    expect(lerDeepLink("nod://sua-vez")).toEqual({ ok: true, alvo: { tipo: "sua-vez" } });
    expect(lerDeepLink("nod://sua-vez/")).toEqual({ ok: true, alvo: { tipo: "sua-vez" } });
    expect(lerDeepLink("nod://computador-do-bot")).toEqual({ ok: true, alvo: { tipo: "computador-do-bot" } });
  });

  it("host desconhecido não navega", () => {
    expect(lerDeepLink("nod://instalar-time/abc")).toEqual({ ok: false, motivo: "host" });
    expect(lerDeepLink("nod://")).toEqual({ ok: false, motivo: "host" });
    expect(lerDeepLink(`nod://conversa:8080/${ID}`)).toEqual({ ok: false, motivo: "host" });
    // Revisão: porta vazia também (o URL a apaga em silêncio).
    expect(lerDeepLink("nod://sua-vez:")).toEqual({ ok: false, motivo: "host" });
    expect(lerDeepLink(`nod://conversa:/${ID}`)).toEqual({ ok: false, motivo: "host" });
  });

  it("id que não é UUID não navega", () => {
    expect(lerDeepLink("nod://conversa/123")).toEqual({ ok: false, motivo: "id" });
    expect(lerDeepLink("nod://conversa")).toEqual({ ok: false, motivo: "id" });
    expect(lerDeepLink("nod://conversa/")).toEqual({ ok: false, motivo: "id" });
    expect(lerDeepLink(`nod://conversa/${ID}x`)).toEqual({ ok: false, motivo: "id" });
    expect(lerDeepLink(`nod://conversa/%33${ID.slice(1)}`)).toEqual({ ok: false, motivo: "id" });
    expect(lerDeepLink("nod://conversa/../sua-vez")).toEqual({ ok: false, motivo: "caminho" });
  });

  it("revisão (3ª): `.`, `..` e `%2e` no caminho não navegam (o URL os resolveria)", () => {
    expect(lerDeepLink(`nod://conversa/x/../${ID}`)).toEqual({ ok: false, motivo: "caminho" });
    expect(lerDeepLink("nod://sua-vez/.")).toEqual({ ok: false, motivo: "caminho" });
    expect(lerDeepLink("nod://sua-vez/%2e")).toEqual({ ok: false, motivo: "caminho" });
    expect(lerDeepLink(`nod://conversa/${ID}/.`)).toEqual({ ok: false, motivo: "caminho" });
  });

  it("caminho a mais não navega", () => {
    expect(lerDeepLink(`nod://conversa/${ID}/apagar`)).toEqual({ ok: false, motivo: "caminho" });
    expect(lerDeepLink("nod://sua-vez/x")).toEqual({ ok: false, motivo: "caminho" });
  });

  it("query ou fragmento, mesmo vazios, não navegam", () => {
    expect(lerDeepLink(`nod://conversa/${ID}?x=1`)).toEqual({ ok: false, motivo: "query" });
    expect(lerDeepLink("nod://sua-vez?")).toEqual({ ok: false, motivo: "query" });
    expect(lerDeepLink("nod://sua-vez#topo")).toEqual({ ok: false, motivo: "query" });
  });

  it("usuário ou senha no link não navegam", () => {
    expect(lerDeepLink(`nod://eu@conversa/${ID}`)).toEqual({ ok: false, motivo: "credencial" });
    expect(lerDeepLink("nod://eu:senha@sua-vez")).toEqual({ ok: false, motivo: "credencial" });
    expect(lerDeepLink("nod://@sua-vez")).toEqual({ ok: false, motivo: "credencial" });
  });

  it("mais de 512 caracteres não navega; 512 ainda é lido", () => {
    expect(lerDeepLink(`nod://sua-vez/${"a".repeat(DEEP_LINK_MAX)}`)).toEqual({ ok: false, motivo: "longo" });
    const limite = `nod://sua-vez${"/".repeat(DEEP_LINK_MAX - "nod://sua-vez".length)}`;
    expect(limite).toHaveLength(DEEP_LINK_MAX);
    expect(lerDeepLink(limite)).toEqual({ ok: false, motivo: "caminho" });
  });

  it("outro esquema, sem `//`, espaço, controle ou não-texto é inválido", () => {
    expect(lerDeepLink(`https://conversa/${ID}`)).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink("nodx://sua-vez")).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink("nod:sua-vez")).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink(" nod://sua-vez")).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink("nod://sua-vez\n")).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink("nod://sua\tvez")).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink(undefined)).toEqual({ ok: false, motivo: "invalido" });
    expect(lerDeepLink(42)).toEqual({ ok: false, motivo: "invalido" });
  });
});

describe("deepLinkDoArgv", () => {
  it("acha o link entre as flags da segunda instância", () => {
    expect(deepLinkDoArgv(["/Applications/nod.app/Contents/MacOS/nod", "--allow-file-access", "nod://sua-vez"])).toBe("nod://sua-vez");
    expect(deepLinkDoArgv(["nod.exe", "NOD://sua-vez"])).toBe("NOD://sua-vez");
  });

  it("sem link, null", () => {
    expect(deepLinkDoArgv(["nod", "--inspect", "https://nod.acme.com.br"])).toBeNull();
    expect(deepLinkDoArgv([])).toBeNull();
  });
});

describe("fila do deep link", () => {
  const relogio = () => {
    let t = 1_000;
    return { agora: () => t, andar: (ms: number) => { t += ms; } };
  };

  it("aplica: entrega o alvo uma vez e esvazia", () => {
    const r = relogio();
    const fila = criarFilaDeepLink(r.agora);
    expect(fila.tirar()).toEqual({ alvo: null, expirou: false });
    fila.guardar({ tipo: "sua-vez" });
    expect(fila.pendente()).toBe(true);
    r.andar(VALIDADE_DEEP_LINK_MS);
    expect(fila.tirar()).toEqual({ alvo: { tipo: "sua-vez" }, expirou: false });
    expect(fila.pendente()).toBe(false);
    expect(fila.tirar()).toEqual({ alvo: null, expirou: false });
  });

  it("expira: depois de 2 min o alvo é descartado", () => {
    const r = relogio();
    const fila = criarFilaDeepLink(r.agora);
    fila.guardar({ tipo: "conversa", conversaId: ID });
    r.andar(VALIDADE_DEEP_LINK_MS + 1);
    expect(fila.tirar()).toEqual({ alvo: null, expirou: true });
    expect(fila.pendente()).toBe(false);
  });

  it("o último vence, e a validade conta do último", () => {
    const r = relogio();
    const fila = criarFilaDeepLink(r.agora);
    fila.guardar({ tipo: "sua-vez" });
    r.andar(VALIDADE_DEEP_LINK_MS);
    fila.guardar({ tipo: "computador-do-bot" });
    r.andar(VALIDADE_DEEP_LINK_MS);
    expect(fila.tirar()).toEqual({ alvo: { tipo: "computador-do-bot" }, expirou: false });
  });
});

describe("receptor do deep link (processo principal)", () => {
  const montar = () => {
    let t = 0;
    const agendados: { fn: () => void; em: number }[] = [];
    const fila = criarFilaDeepLink(() => t);
    const log = vi.fn();
    const focar = vi.fn();
    const avisarWeb = vi.fn();
    const receber = criarReceptorDeepLink({ fila, log, focar, avisarWeb, agora: () => t, agendar: (fn, ms) => { agendados.push({ fn, em: t + ms }); } });
    const andar = (ms: number) => {
      t += ms;
      for (const a of agendados.splice(0)) {
        if (a.em <= t) a.fn();
        else agendados.push(a);
      }
    };
    return { fila, log, focar, avisarWeb, receber, andar, agendados };
  };

  it("link inválido grava só o motivo, traz o app para a frente (spec) e não avisa a web nem entra na fila", () => {
    const r = montar();
    r.receber(`nod://conversa/${ID}?token=segredo`);
    expect(r.log).toHaveBeenCalledWith("aviso", "deep_link_ignorado", { motivo: "query" });
    expect(JSON.stringify(r.log.mock.calls)).not.toContain("segredo");
    expect(r.focar).toHaveBeenCalledTimes(1);
    expect(r.avisarWeb).not.toHaveBeenCalled();
    expect(r.fila.pendente()).toBe(false);
  });

  it("link válido entra na fila, grava o tipo, foca e avisa a web", () => {
    const r = montar();
    r.receber(`nod://conversa/${ID}`);
    expect(r.log).toHaveBeenCalledWith("info", "deep_link_recebido", { tipo: "conversa" });
    expect(JSON.stringify(r.log.mock.calls)).not.toContain(ID);
    expect(r.focar).toHaveBeenCalledTimes(1);
    expect(r.avisarWeb).toHaveBeenCalledTimes(1);
    expect(r.fila.tirar().alvo).toEqual({ tipo: "conversa", conversaId: ID });
  });

  it("revisão: dentro de 2 s o último vence na fila, e foco e aviso saem uma vez só, no fim do intervalo", () => {
    const r = montar();
    r.receber("nod://sua-vez");
    r.andar(500);
    r.receber("nod://computador-do-bot");
    r.receber(`nod://conversa/${ID}`);
    r.receber("nod://lixo");
    expect(r.focar).toHaveBeenCalledTimes(1);
    expect(r.avisarWeb).toHaveBeenCalledTimes(1);
    expect(r.agendados).toHaveLength(1);
    r.andar(INTERVALO_DEEP_LINK_MS - 501);
    expect(r.avisarWeb).toHaveBeenCalledTimes(1);
    r.andar(1);
    expect(r.focar).toHaveBeenCalledTimes(2);
    expect(r.avisarWeb).toHaveBeenCalledTimes(2);
    expect(r.fila.tirar().alvo).toEqual({ tipo: "conversa", conversaId: ID });
  });

  it("o aviso do fim do intervalo não sai se a web já buscou o link", () => {
    const r = montar();
    r.receber("nod://sua-vez");
    r.receber("nod://computador-do-bot");
    r.fila.tirar();
    r.andar(INTERVALO_DEEP_LINK_MS);
    expect(r.avisarWeb).toHaveBeenCalledTimes(1);
  });

  it("QA: link inválido dentro do intervalo traz o app no fim dele, sem avisar a web", () => {
    const r = montar();
    r.receber("nod://sua-vez");
    r.fila.tirar(); // a web já puxou o válido
    r.andar(100);
    r.receber("nod://lixo");
    r.receber("nod://lixo2");
    expect(r.agendados).toHaveLength(1);
    expect(r.focar).toHaveBeenCalledTimes(1);
    r.andar(INTERVALO_DEEP_LINK_MS);
    expect(r.focar).toHaveBeenCalledTimes(2);
    expect(r.avisarWeb).toHaveBeenCalledTimes(1);
  });

  it("inválido e depois válido no intervalo: um foco e um aviso no fim", () => {
    const r = montar();
    r.receber("nod://sua-vez");
    r.andar(100);
    r.receber("nod://lixo");
    r.receber("nod://computador-do-bot");
    r.andar(INTERVALO_DEEP_LINK_MS);
    expect(r.focar).toHaveBeenCalledTimes(2);
    expect(r.avisarWeb).toHaveBeenCalledTimes(2);
    expect(r.fila.tirar().alvo).toEqual({ tipo: "computador-do-bot" });
  });

  it("passado o intervalo, o próximo link age na hora", () => {
    const r = montar();
    r.receber("nod://sua-vez");
    r.andar(INTERVALO_DEEP_LINK_MS);
    r.receber("nod://computador-do-bot");
    expect(r.avisarWeb).toHaveBeenCalledTimes(2);
    expect(r.agendados).toHaveLength(0);
  });
});

describe("log adiado (o link do app frio chega antes do arquivo de log)", () => {
  it("guarda até liberar, entrega em ordem e depois passa direto", () => {
    const log = vi.fn();
    const adiado = criarLogAdiado(log);
    adiado.log("aviso", "deep_link_ignorado", { motivo: "host" });
    adiado.log("info", "deep_link_recebido", { tipo: "sua-vez" });
    expect(log).not.toHaveBeenCalled();
    adiado.liberar();
    expect(log.mock.calls).toEqual([
      ["aviso", "deep_link_ignorado", { motivo: "host" }],
      ["info", "deep_link_recebido", { tipo: "sua-vez" }],
    ]);
    adiado.log("info", "deep_link_expirado");
    expect(log).toHaveBeenLastCalledWith("info", "deep_link_expirado");
  });

  it("guarda no máximo 5 (uma página em laço não enche a memória)", () => {
    const log = vi.fn();
    const adiado = criarLogAdiado(log);
    for (let i = 0; i < 20; i++) adiado.log("aviso", "deep_link_ignorado", { motivo: "host" });
    adiado.liberar();
    expect(log).toHaveBeenCalledTimes(5);
  });
});

describe("ligação no processo principal (desktop/main.ts)", () => {
  const main = readFileSync("desktop/main.ts", "utf8");

  it("open-url síncrono no corpo do main, argv da segunda instância e do app frio", () => {
    expect(main).toContain(`app.on("open-url", (event, url) => { event.preventDefault(); receberDeepLink(url); });`);
    expect(main).toMatch(/second-instance[\s\S]{0,120}deepLinkDoArgv\(argv\)/);
    expect(main).toContain("deepLinkDoArgv(process.argv)");
    // Revisão (3ª): a posição importa — dentro do whenReady o link do app frio se perderia.
    const pronto = main.indexOf("app.whenReady()");
    expect(main.indexOf(`app.on("open-url"`)).toBeGreaterThan(-1);
    expect(main.indexOf(`app.on("open-url"`)).toBeLessThan(pronto);
    expect(main.indexOf("deepLinkDoArgv(process.argv)")).toBeLessThan(pronto);
  });

  it("o log guardado sai logo depois de o arquivo de log existir; o pull confere o remetente", () => {
    expect(main).toMatch(/definirDestinoDoLog\([^\n]*\);\n\s*logDeepLink\.liberar\(\);/);
    expect(main).toContain("ipcMain.handle(CANAIS_DESKTOP.deepLinkPendente, (e) => { validarRemetenteWeb(e); return entregarDeepLink(); });");
    expect(main).not.toContain("app.setAsDefaultProtocolClient(");
  });

  it("QA: a fila vence pelo relógio de parede; o aviso à web vai sem a URL, à janela da web; o expirado fica no log", () => {
    expect(main).toContain("const filaDeepLink = criarFilaDeepLink(() => Date.now());");
    expect(main).toContain("avisarWeb: () => janelaWeb()?.webContents.send(CANAIS_DESKTOP.deepLink),");
    expect(main).toContain(`if (expirou) logDeepLink.log("info", "deep_link_expirado");`);
    expect(main).toMatch(/second-instance", \(_event, argv\) => \{\n\s*const url = deepLinkDoArgv\(argv\);\n\s*if \(url\) receberDeepLink\(url\);/);
  });
});

describe("electron-builder.yml", () => {
  it("o bloco mac registra o esquema nod (vira CFBundleURLTypes no Info.plist)", () => {
    const yml = readFileSync("electron-builder.yml", "utf8");
    // O bloco `mac:` vai da linha `mac:` até a próxima chave de topo.
    const mac = /^mac:\n((?:[ #].*\n|\n)*)/m.exec(yml)?.[1] ?? "";
    expect(mac).toMatch(/^ {2}protocols:\n {4}- name: nod\n {6}schemes: \[nod\]$/m);
    expect(ESQUEMA_DEEP_LINK).toBe("nod");
  });
});
