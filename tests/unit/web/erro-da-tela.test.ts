import { describe, expect, it, vi } from "vitest";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ErroApi, FRASE_SERVIDOR_INDISPONIVEL } from "../../../web/lib/erro-api.ts";
import { FRASE_ACAO_SEM_INTERNET, FRASE_ACAO_SEM_RESPOSTA, FRASE_ERRO_DA_TELA, REGISTROS_POR_CARGA, REGISTROS_POR_MINUTO, acaoDoErro, criarRegistroDeErros, detalhesDoErro, erroDaAcao, erroDe, erroParaRelatar, quadroLimpo, registroDe, type ErroNaTela } from "../../../web/lib/erro-da-tela.ts";
import { criarSondaDeRede } from "../../../web/lib/sonda-de-rede.ts";

describe("erroDe (NOD-215)", () => {
  it("TypeError vira erro_da_tela com frase de erro interno, nunca 'conexão', e é registrado", () => {
    const registrar = vi.fn();
    const erro = erroDe(new TypeError("Cannot read properties of undefined (reading 'x')"), registrar, "conversa");
    expect(erro).toEqual({ codigo: "erro_da_tela", mensagem: FRASE_ERRO_DA_TELA, rota: "conversa" });
    expect(erro!.mensagem).not.toMatch(/conex/i);
    expect(erro!.mensagem).not.toMatch(/Cannot read/);
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it("ErroApi segue como veio, com status, rota e correlation_id", () => {
    const registrar = vi.fn();
    expect(erroDe(new ErroApi(500, "falha_interna", "Algo deu errado.", "cid", "POST /x"), registrar)).toEqual({ codigo: "falha_interna", mensagem: "Algo deu errado.", correlationId: "cid", status: 500, rota: "POST /x" });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("AbortError é silencioso", () => {
    expect(erroDe(new DOMException("x", "AbortError"), vi.fn())).toBeNull();
  });

  it("o registro guarda nome e origem, sem a mensagem, e só uma vez por origem (erro no render não vira enxurrada)", () => {
    const destino = vi.fn();
    const registrar = criarRegistroDeErros(destino);
    const e = new TypeError("segredo do usuário");
    for (let i = 0; i < 5; i++) registrar(e, "conversa");
    expect(destino).toHaveBeenCalledTimes(1);
    const [r] = destino.mock.calls[0] as [Record<string, unknown>];
    expect(r.nome).toBe("TypeError");
    expect(JSON.stringify(r)).not.toContain("segredo");
    const outro = criarRegistroDeErros(() => { throw new Error("destino quebrado"); });
    expect(() => outro(new Error("y"), null)).not.toThrow();
  });

  it("Detalhes trazem tipo, rota, status e correlation_id", () => {
    expect(detalhesDoErro({ codigo: "manutencao", mensagem: "m", status: 503, rota: "GET /frota", correlationId: "c1" })).toBe("tipo: manutencao · rota: GET /frota · status: 503 · correlation_id: c1");
    expect(detalhesDoErro({ codigo: "servidor_indisponivel", mensagem: "m", status: 0, rota: "GET /frota" })).toBe("tipo: servidor_indisponivel · rota: GET /frota · status: sem resposta");
  });
});

describe("reducer: o 'Reconectando…' some sozinho (NOD-215)", () => {
  const rede: ErroNaTela = { codigo: "servidor_indisponivel", mensagem: FRASE_SERVIDOR_INDISPONIVEL, status: 0, rota: "GET /frota" };
  const outro: ErroNaTela = { codigo: "conflito", mensagem: "Já resolvido." };
  const com = (erro: ErroNaTela | null): Estado => ({ ...estadoInicial, erro });

  it("some quando o SSE volta a aberto", () => {
    const e = reduzir(com(rede), { tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null });
    expect(e.erro).toBeNull();
    expect(reduzir(com(rede), { tipo: "conexao", estado: "reconectando", tentativa: 2, proximaEmMs: 1000 }).erro).toEqual(rede);
  });

  it("some quando a próxima chamada dá certo", () => {
    expect(reduzir(com(rede), { tipo: "rede-voltou" }).erro).toBeNull();
  });

  it("não apaga um erro de outra natureza", () => {
    expect(reduzir(com(outro), { tipo: "rede-voltou" }).erro).toEqual(outro);
    expect(reduzir(com(outro), { tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null }).erro).toEqual(outro);
  });

  it("rede-caiu não cobre outro erro e mantém o ocupado (a ação segue tentando)", () => {
    expect(reduzir(com(outro), { tipo: "rede-caiu", erro: rede }).erro).toEqual(outro);
    const e = reduzir({ ...com(null), ocupado: true }, { tipo: "rede-caiu", erro: rede });
    expect(e.erro).toEqual(rede);
    expect(e.ocupado).toBe(true);
  });
});

describe("revisão NOD-215: o registro do erro_da_tela não vaza dado nem vira enxurrada", () => {
  const SEGREDOS = ["tok_abc123segredo", "sid=cookie-da-pessoa", "texto que a pessoa digitou", "Bearer eyJhbGci"];
  function erroComSegredo(): Error {
    const e = new TypeError(`falhou com ${SEGREDOS[0]}\n${SEGREDOS[1]} ${SEGREDOS[2]}\nAuthorization: ${SEGREDOS[3]}`);
    e.stack = [
      `TypeError: falhou com ${SEGREDOS[0]}`,
      `${SEGREDOS[1]} ${SEGREDOS[2]}`,
      `Authorization: ${SEGREDOS[3]}`,
      "    at renderPrincipal (https://nod.app/main.js?token=tok_abc123segredo:120:7)",
      "    at render (https://nod.app/main.js#sid=cookie-da-pessoa:80:3)",
      "    at a (https://nod.app/x.js:1:1)",
      "    at b (https://nod.app/x.js:2:1)",
      "    at c (https://nod.app/x.js:3:1)",
      "    at d (https://nod.app/x.js:4:1)",
    ].join("\n");
    return e;
  }

  it("registro e o Error que vai para reportError levam só nome, origem e pilha curta sem query nem mensagem", () => {
    const destino = vi.fn();
    criarRegistroDeErros(destino)(erroComSegredo(), "conversa");
    const [r] = destino.mock.calls[0] as [ReturnType<typeof registroDe>];
    expect(destino.mock.calls[0]).toHaveLength(1); // a exceção original não é entregue ao destino
    expect(r.nome).toBe("TypeError");
    expect(r.origem).toBe("at renderPrincipal (https://nod.app/main.js:120:7)");
    expect(r.pilha).toHaveLength(5);
    const relatado = erroParaRelatar(r);
    const tudo = `${JSON.stringify(r)}\n${relatado.message}\n${relatado.stack}`;
    for (const s of SEGREDOS) expect(tudo).not.toContain(s);
    expect(relatado.name).toBe("ErroDaTela");
    expect(relatado.message).toContain("conversa");
  });

  it("nome forjado e pilha estilo Firefox também saem limpos", () => {
    const e = new Error("x");
    e.name = "tok_abc 123 segredo com espaço";
    e.stack = "f@https://nod.app/a.js?k=segredo:1:2\ng@https://nod.app/b.js:3:4";
    const r = registroDe(e, null);
    expect(r.nome).toBe("ErroSemNome");
    expect(r.pilha).toEqual(["f@https://nod.app/a.js:1:2", "g@https://nod.app/b.js:3:4"]);
    expect(quadroLimpo("at f (http://h/a.js?x=1&y=2#frag:9:9)")).toBe("at f (http://h/a.js:9:9)");
  });

  it("o mesmo erro repetido no render/retry é registrado uma vez; e há teto por minuto e por carga", () => {
    let t = 0;
    const destino = vi.fn();
    const registrar = criarRegistroDeErros(destino, () => t);
    const e = erroComSegredo();
    for (let i = 0; i < 100; i++) registrar(e, "conversa");
    expect(destino).toHaveBeenCalledTimes(1);
    const distinto = (i: number): Error => { const x = new Error("m"); x.stack = `Error: m\n    at f${i} (https://nod.app/x.js:${i}:1)`; return x; };
    for (let i = 0; i < 50; i++) registrar(distinto(i), null);
    expect(destino).toHaveBeenCalledTimes(REGISTROS_POR_MINUTO);
    for (let min = 1; min <= 10; min++) {
      t = min * 60_000;
      for (let i = 0; i < 50; i++) registrar(distinto(min * 100 + i), null);
    }
    expect(destino).toHaveBeenCalledTimes(REGISTROS_POR_CARGA);
  });
});

describe("revisão NOD-215: ação que caiu por rede não vira o aviso que some sozinho", () => {
  it("erroDaAcao troca a falha de rede por acao_nao_concluida (banner), com a causa em Detalhes", () => {
    const fora: ErroNaTela = { codigo: "servidor_indisponivel", mensagem: FRASE_SERVIDOR_INDISPONIVEL, status: 0, rota: "POST /propostas/p1/recusar" };
    const e = erroDaAcao(fora);
    expect(e).toMatchObject({ codigo: "acao_nao_concluida", mensagem: FRASE_ACAO_SEM_RESPOSTA, causa: "servidor_indisponivel" });
    expect(e.mensagem).not.toMatch(/sozinhos/);
    expect(acaoDoErro(e).tipo).toBe("erro");
    expect(detalhesDoErro(e)).toBe("tipo: acao_nao_concluida · causa: servidor_indisponivel · rota: POST /propostas/p1/recusar · status: sem resposta");
    expect(erroDaAcao({ codigo: "sem_internet", mensagem: "m" }).mensagem).toBe(FRASE_ACAO_SEM_INTERNET);
    const outro: ErroNaTela = { codigo: "conflito", mensagem: "x" };
    expect(erroDaAcao(outro)).toBe(outro);
    // Banner da ação não é apagado pela volta da rede.
    const comBanner = reduzir({ ...estadoInicial, erro: e }, { tipo: "rede-voltou" });
    expect(reduzir(comBanner, { tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null }).erro).toEqual(e);
  });
});

describe("revisão NOD-215: o 'Reconectando…' nunca fica preso", () => {
  const rede: ErroNaTela = { codigo: "servidor_indisponivel", mensagem: FRASE_SERVIDOR_INDISPONIVEL, status: 0, rota: "GET /frota" };
  const semNet: ErroNaTela = { codigo: "sem_internet", mensagem: "m", status: 0, rota: "GET /frota" };

  it("várias falhas simultâneas e de causas diferentes: um aberto apaga; uma falha atrasada depois do aberto some com a próxima resposta", () => {
    let e: Estado = { ...estadoInicial, erro: null };
    e = reduzir(e, { tipo: "rede-caiu", erro: rede });
    e = reduzir(e, { tipo: "rede-caiu", erro: semNet });
    e = reduzir(e, { tipo: "rede-caiu", erro: rede });
    e = reduzir(e, { tipo: "conexao", estado: "reconectando", tentativa: 3, proximaEmMs: 4000 });
    expect(e.erro).toEqual(rede);
    e = reduzir(e, { tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null });
    expect(e.erro).toBeNull();
    // A última tentativa de um GET em voo falha DEPOIS do aberto (corrida timeout × reconexão).
    e = reduzir(e, { tipo: "rede-caiu", erro: rede });
    expect(e.erro).toEqual(rede);
    e = reduzir(e, { tipo: "rede-voltou" });
    expect(e.erro).toBeNull();
  });

  it("a sonda faz uma leitura por vez enquanto o aviso está na tela e para quando ele some", async () => {
    let aviso = true;
    const timers: Array<() => void> = [];
    let sondas = 0;
    let servidorDePe = false;
    const sonda = criarSondaDeRede({
      sondar: async () => { sondas++; if (!servidorDePe) throw new Error("fora"); aviso = false; },
      precisa: () => aviso,
      agendar: (fn) => { timers.push(fn); },
      intervaloMs: 5_000,
    });
    sonda.lembrar();
    sonda.lembrar();
    sonda.lembrar();
    expect(timers).toHaveLength(1); // uma sonda por vez
    const rodar = async (): Promise<void> => { timers.shift()!(); await new Promise((r) => setTimeout(r, 0)); };
    await rodar();
    expect(sondas).toBe(1);
    expect(timers).toHaveLength(1); // falhou: agenda de novo
    servidorDePe = true;
    await rodar();
    expect(sondas).toBe(2);
    expect(aviso).toBe(false);
    expect(timers).toHaveLength(0); // aviso sumiu: a sonda para
    expect(sonda.agendada()).toBe(false);
  });

  it("a sonda não roda se o aviso já sumiu antes da hora (SSE reabriu)", async () => {
    let aviso = true;
    const timers: Array<() => void> = [];
    const sondar = vi.fn(async () => undefined);
    const sonda = criarSondaDeRede({ sondar, precisa: () => aviso, agendar: (fn) => { timers.push(fn); } });
    sonda.lembrar();
    aviso = false;
    timers.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(sondar).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });
});
