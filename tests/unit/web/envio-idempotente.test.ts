import { describe, expect, it, vi } from "vitest";
import { corpoDoEnvio, criarEnvios, enviarUmaVez } from "../../../web/lib/envio-idempotente.ts";
import { enviarPeloComposer, idsDaResposta, type ApiDeEnvio } from "../../../web/lib/perguntas.ts";

function contador(): () => string {
  let n = 0;
  return () => `chave-${++n}`;
}

describe("NOD-156: idEnvio no envio da web", () => {
  it("o corpo do envio leva idEnvio quando há um; sem ele, fica como antes (cliente antigo)", () => {
    expect(corpoDoEnvio("oi", [], "11111111-1111-4111-8111-111111111111")).toEqual({ texto: "oi", idEnvio: "11111111-1111-4111-8111-111111111111" });
    expect(corpoDoEnvio("oi", ["a1"], "22222222-2222-4222-8222-222222222222")).toEqual({ texto: "oi", anexos: ["a1"], idEnvio: "22222222-2222-4222-8222-222222222222" });
    expect(corpoDoEnvio("oi")).toEqual({ texto: "oi" });
    expect(corpoDoEnvio("oi", ["a1"])).toEqual({ texto: "oi", anexos: ["a1"] });
  });

  it("o reenvio da mesma fala depois de uma falha reusa a chave; fala nova depois de um envio que deu certo gera outra", () => {
    const envios = criarEnvios(contador());
    const primeira = envios.iniciar("c1", "oi", []);
    expect(primeira).toBe("chave-1");
    envios.concluir("c1", false); // a resposta se perdeu
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-1");
    envios.concluir("c1", true);
    // A pessoa manda "oi" de novo, de propósito: é outra fala.
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-2");
    envios.concluir("c1", true);
  });

  it("revisão do PR do pensamento no chat (27/10): o 'Tentar de novo' manda a chave da própria pendente, mesmo com outra fala no meio", () => {
    const envios = criarEnvios(contador());
    expect(envios.iniciar("c1", "a", [])).toBe("chave-1");
    envios.concluir("c1", false); // a fala A falhou (o POST pode ter chegado)
    expect(envios.iniciar("c1", "b", [])).toBe("chave-2"); // a pessoa manda B
    envios.concluir("c1", true);
    // Sem a chave dada, A ganharia "chave-3" e o servidor a gravaria de novo.
    expect(envios.iniciar("c1", "a", [], undefined, "chave-1")).toBe("chave-1");
    // Continua uma por vez: com a chave dada em voo, outro envio espera.
    expect(envios.iniciar("c1", "x", [])).toBeNull();
    envios.concluir("c1", true);
  });

  it("texto ou anexos diferentes depois da falha são outra fala; cada conversa tem a sua", () => {
    const envios = criarEnvios(contador());
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-1");
    envios.concluir("c1", false);
    expect(envios.iniciar("c1", "oi, tudo bem?", [])).toBe("chave-2");
    envios.concluir("c1", false);
    expect(envios.iniciar("c1", "oi, tudo bem?", ["a1"])).toBe("chave-3");
    envios.concluir("c1", false);
    expect(envios.iniciar("c2", "oi, tudo bem?", ["a1"])).toBe("chave-4");
  });

  it("ADR-113: a mesma fala com outra citação (ou sem a que tinha) é outra fala; com a mesma, reusa (revisão do PR 392)", () => {
    const envios = criarEnvios(contador());
    expect(envios.iniciar("c1", "pega o T3", [], "m1")).toBe("chave-1");
    envios.concluir("c1", false); // a resposta se perdeu
    expect(envios.iniciar("c1", "pega o T3", [], "m1")).toBe("chave-1");
    envios.concluir("c1", false);
    // Tirou a citação com o × e reenviou: o servidor não pode devolver a mensagem gravada com a citação.
    expect(envios.iniciar("c1", "pega o T3", [])).toBe("chave-2");
    envios.concluir("c1", false);
    expect(envios.iniciar("c1", "pega o T3", [], "m2")).toBe("chave-3");
  });

  it("um segundo envio na mesma conversa com o primeiro em voo é ignorado (devolve null); outra conversa segue", () => {
    const envios = criarEnvios(contador());
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-1");
    expect(envios.iniciar("c1", "oi", [])).toBeNull();
    expect(envios.iniciar("c2", "oi", [])).toBe("chave-2");
    envios.concluir("c1", true);
    expect(envios.iniciar("c1", "e aí?", [])).toBe("chave-3");
  });

  it("enviarPeloComposer repassa o idEnvio só para a mensagem comum (resposta e sala ficam fora)", async () => {
    const api = { enviar: vi.fn(async () => ({})), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "mensagem" }, "oi", ["an1"], "chave-1");
    expect(api.enviar).toHaveBeenCalledWith("c", "oi", ["an1"], "chave-1");
    await enviarPeloComposer(api, { conversaId: "c", salaId: "s1" }, { tipo: "mensagem" }, "oi, sala", [], "chave-2");
    expect(api.postarNaSala).toHaveBeenCalledWith("s1", "oi, sala");
    await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "resposta", decisaoId: "d1" }, "sim", [], "chave-3");
    expect(api.responder).toHaveBeenCalledWith("d1", "sim");
  });

  it("Parte 1 do plano 'o pensamento no chat': os ids do POST voltam só quando têm a forma do RespostaMutacao (servidor de antes: sem ids)", async () => {
    const api = { enviar: vi.fn(async () => ({ ok: true, ids: { mensagem: "m1", turno: "t1", extra: 7 } })), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    expect(await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "mensagem" }, "oi", [], "chave-1")).toEqual({ enviado: "mensagem", ids: { mensagem: "m1", turno: "t1" } });
    expect(idsDaResposta({})).toBeNull();
    expect(idsDaResposta({ ids: {} })).toBeNull();
    expect(idsDaResposta(null)).toBeNull();
    const antigo = { enviar: vi.fn(async () => ({})), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    expect(await enviarPeloComposer(antigo, { conversaId: "c", salaId: null }, { tipo: "mensagem" }, "oi", [], "chave-2")).toEqual({ enviado: "mensagem" });
  });
});

describe("revisão W3 (2026-10-08): o campo da task com a trava do chat", () => {
  it("com um envio em voo para a mesma task, o segundo (Enter + botão) não sai; depois de terminar — ou falhar — sai de novo", async () => {
    const envios = criarEnvios(contador());
    const chamadas: string[] = [];
    let soltar: () => void = () => undefined;
    const primeiro = enviarUmaVez(envios, "trabalho:login", "cobre o cadastro", async () => {
      chamadas.push("1");
      await new Promise<void>((r) => { soltar = r; });
    });
    expect(await enviarUmaVez(envios, "trabalho:login", "cobre o cadastro", async () => { chamadas.push("2"); })).toBe(false);
    // Outra task não espera esta.
    expect(await enviarUmaVez(envios, "trabalho:outra", "oi", async () => { chamadas.push("outra"); })).toBe(true);
    soltar();
    expect(await primeiro).toBe(true);
    expect(await enviarUmaVez(envios, "trabalho:login", "cobre o cadastro", async () => { chamadas.push("3"); })).toBe(true);
    expect(chamadas).toEqual(["1", "outra", "3"]);
    await expect(enviarUmaVez(envios, "trabalho:login", "x", async () => { throw new Error("sem rede"); })).rejects.toThrow("sem rede");
    expect(await enviarUmaVez(envios, "trabalho:login", "x", async () => undefined)).toBe(true);
  });
});
