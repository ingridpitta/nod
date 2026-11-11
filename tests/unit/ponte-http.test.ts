import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { AnuncioMaquina } from "../../src/contracts/ponte.ts";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarPonteHttpServidor } from "../../src/adapters/http/rotas/ponte.ts";
import { criarPonteHttp, urlServidor } from "../../src/adapters/executor/ponte-http.ts";
import { versaoAceita } from "../../src/domain/versao-app.ts";
import { contasAnunciadas, entrega, falas, impressoes, inventario, memoria, progressoDoLogin, relatoEspera, sinais, trechos } from "../../src/adapters/http/rotas/ponte-validacao.ts";
import { CONTAS_ANUNCIADAS_MAX } from "../../src/contracts/contas-ia.ts";
import { TEXTO_ENTREGA_MAX_CHARS } from "../../src/shared/constantes.ts";
import { camposDoRelato, relatoValido } from "../../src/use-cases/limpeza-das-tasks.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { definirInteligenciaDoBot } from "../../src/use-cases/inteligencia.ts";
import { ANA, depsEmMemoria, executar, MARLON } from "../helpers/deps-l6.ts";

describe("ADR-099 (parte 2): as esperas pela ponte HTTP", () => {
  const ID = "3f6b0d1e-2a4c-4b5d-8e9f-0a1b2c3d4e5f";
  it("o cliente puxa as esperas e relata; servidor antigo (404) ou fora do ar devolve null, sem aviso de falha", async () => {
    const aoFalhar = vi.fn();
    const ok = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ esperas: [{ id: ID, comando: "gh pr checks 1 --watch", pasta: "Ada/ci", iniciada: false }, { id: 1 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ seguir: true })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: ok, aoFalhar });
    expect(await c.ponte.esperas?.("p", "m")).toEqual([{ id: ID, comando: "gh pr checks 1 --watch", pasta: "Ada/ci", iniciada: false }]);
    expect(await c.ponte.relatarEspera?.("p", "m", { id: ID, tipo: "iniciou" })).toEqual({ seguir: true });
    expect(ok).toHaveBeenLastCalledWith("https://nod.example/api/maquina/esperas/resultado", expect.objectContaining({ body: JSON.stringify({ relato: { id: ID, tipo: "iniciou" } }) }));
    const antigo = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 })), aoFalhar });
    expect(await antigo.ponte.esperas?.("p", "m")).toBeNull();
    expect(await antigo.ponte.relatarEspera?.("p", "m", { id: ID, tipo: "iniciou" })).toBeNull();
    expect(aoFalhar).not.toHaveBeenCalled();
  });
  it("o servidor valida o relato: id uuid, tipo e motivo conhecidos, código inteiro e saída com teto", () => {
    expect(relatoEspera({ id: ID, tipo: "terminou", codigo: 0, saida: "ok" })).toEqual({ id: ID, tipo: "terminou", codigo: 0, saida: "ok" });
    expect(relatoEspera({ id: ID, tipo: "terminou", codigo: null, saida: "" })).toMatchObject({ codigo: null });
    expect(relatoEspera({ id: ID, tipo: "caiu", motivo: "pasta_ausente" })).toEqual({ id: ID, tipo: "caiu", motivo: "pasta_ausente" });
    for (const r of [{ id: "x", tipo: "iniciou" }, { id: ID, tipo: "sumiu" }, { id: ID, tipo: "caiu", motivo: "outro" }, { id: ID, tipo: "terminou", codigo: 1.5, saida: "" }, { id: ID, tipo: "terminou", codigo: 0, saida: "x".repeat(20_000) }]) {
      expect(() => relatoEspera(r)).toThrow();
    }
  });
});

describe("desktop: fronteiras HTTP", () => {
  it("só aceita HTTPS sem credenciais ou caminhos; loopback exige opção de desenvolvimento", () => {
    expect(urlServidor("https://nod.example")).toBe("https://nod.example");
    for (const u of ["http://nod.example", "http://127.0.0.1:8888", "https://user:secret@nod.example", "file:///tmp/a", "https://nod.example/api", "https://nod.example/?token=x"]) expect(() => urlServidor(u)).toThrow();
    expect(urlServidor("http://127.0.0.1:8888", true)).toBe("http://127.0.0.1:8888");
  });
  it("compara versões numericamente e recusa entradas malformadas", () => {
    expect(versaoAceita("0.10.0", "0.2.0")).toBe(true);
    for (const v of [undefined, ["0.2.0"], "0.1.9", "0.2.0-beta", "wat"]) expect(versaoAceita(v, "0.2.0")).toBe(false);
  });
  it("manda só bearer da máquina e versão, recusa redirect, nunca Origin", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ plano: null }), { headers: { "x-nod-versao-minima": "0.1.0" } }));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "test-only", versao: "0.1.0", fetchImpl: f });
    expect(await c.ponte.puxar("id-ignorado")).toBeNull();
    expect(f).toHaveBeenCalledWith("https://nod.example/api/maquina/puxar", expect.objectContaining({ redirect: "error", body: "{}", headers: { authorization: "Bearer test-only", "content-type": "application/json", "x-nod-versao": "0.1.0" } }));
  });
  // revisto em 2026-10-12 (NOD-214): só a resposta definitiva (chave revogada, app velho) aborta na hora; o 5xx do servidor
  // reiniciando vira `indefinido` e o CLI segue (tests/unit/executor/ponte-http-reinicio.test.ts).
  it.each([[401, false], [426, false], [503, "indefinido"]] as const)("renovação que falha (%i) devolve %s", async (status, ativo) => {
    const c = criarPonteHttp({ url: "https://nod.example", chave: "test", versao: "0.1.0", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status })) });
    expect((await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, eventos: [] })).ativo).toBe(ativo);
  });
  it("não confia no relógio nem em prosa do inventário remoto", () => {
    expect(inventario({ estado: "ausente", em: Infinity, motivo: "segredo" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    expect(() => sinais({ attempted: "true" })).toThrow();
    // NOD-178: a causa conhecida atravessa, com a frase do servidor; causa desconhecida é descartada.
    expect(inventario({ estado: "nao_autenticado", em: 1, motivo: "segredo", causa: "sonda_lenta" }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "O harness demorou para responder; o Mac está carregado. Tente de novo em instantes.", causa: "sonda_lenta" });
    // Anunciado por harness, a frase diz quem demorou.
    expect(inventario({ estado: "ausente", em: 1, motivo: "Instale", causa: "sonda_lenta" }, 100, "Codex")).toEqual({ estado: "ausente", em: 100, motivo: "O Codex demorou para responder; o Mac está carregado. Tente de novo em instantes.", causa: "sonda_lenta" });
    expect(inventario({ estado: "ausente", em: 1, motivo: "x", causa: "inventada" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    // NOD-171: cli_antigo atravessa com as versões no formato x.y.z[-pre]; a frase é do servidor, nunca do Mac.
    expect(inventario({ estado: "ausente", em: 1, motivo: "texto do Mac", causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0" }, 100, "Codex")).toEqual({ estado: "ausente", em: 100, causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0", motivo: "O Codex deste Mac (0.158.9) é mais antigo que o testado pelo nod. Atualize para a versão 0.159.0 ou mais nova." });
    for (const versao of [undefined, "", "2.1", "<script>", "1.2.3 (Claude Code)", 3]) {
      expect(inventario({ estado: "ausente", em: 1, causa: "cli_antigo", versao, minima: "2.1.290" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    }
    expect(inventario({ estado: "nao_autenticado", em: 1, causa: "cli_antigo", versao: "2.1.1", minima: "2.1.290" }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "Entre na conta do harness neste computador" });
    expect(() => entrega({ resultado: { desfecho: "inventado" }, fala: {}, seqLocal: -1 }, "x")).toThrow();
  });
  it("revisto em 2026-10-10: as causas do app novo (sem Node, configuração quebrada) atravessam, com a frase do servidor", () => {
    expect(inventario({ estado: "ausente", em: 1, motivo: "env: node: No such file", causa: "sem_node" }, 100, "Codex")).toEqual({ estado: "ausente", em: 100, causa: "sem_node", motivo: "Codex precisa do Node, e este computador não tem o Node instalado." });
    expect(inventario({ estado: "ausente", em: 1, motivo: "config.toml: chave", causa: "config_invalida" }, 100, "Codex")).toEqual({ estado: "ausente", em: 100, causa: "config_invalida", motivo: "A configuração do Codex neste computador tem um erro; entrar de novo não resolve." });
    // Só em `ausente` (o CLI não serve como está); em `nao_autenticado` não é "falta entrar" com outra causa.
    expect(inventario({ estado: "nao_autenticado", em: 1, causa: "config_invalida" }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "Entre na conta do harness neste computador" });
    // O limite é do servidor: o Mac não o anuncia.
    expect(inventario({ estado: "nao_autenticado", em: 1, causa: "limite", renovaEm: 999 }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "Entre na conta do harness neste computador" });
  });
  it("NOD-9: `atualizando` atravessa só em ausente, com a frase do servidor; a atualização anunciada é reescrita campo a campo", () => {
    expect(inventario({ estado: "ausente", em: 1, motivo: "texto do Mac", causa: "atualizando" }, 100, "Claude")).toEqual({ estado: "ausente", em: 100, causa: "atualizando", motivo: "Atualizando o Claude… Os pedidos para ele esperam e rodam assim que terminar." });
    expect(inventario({ estado: "nao_autenticado", em: 1, causa: "atualizando" }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "Entre na conta do harness neste computador" });
    const cheia = { fase: "falhou", antes: "2.1.200", depois: "2.1.250", alvo: "2.1.289", motivo: "sem_espaco", caminho: "npm_local", em: 50, seguraEm: 60, espaco: { livreMb: 1200, precisaMb: 2048 }, stderr: "EACCES /usr/lib" };
    const { stderr: _cru, ...semCru } = cheia;
    expect(inventario({ estado: "pronto", versao: "2.1.200", em: 1, atualizacao: cheia }, 100)).toEqual({ estado: "pronto", versao: "2.1.200", em: 100, atualizacao: semCru });
    // Os opcionais fora do formato caem sozinhos; a fase segue.
    const torta = { fase: "pedindo_aprovacao", antes: "dois", depois: "2.1", alvo: "2.1.289", motivo: "inventado", caminho: "brew", em: 50, seguraEm: -1, espaco: { livreMb: 1.5, precisaMb: 10 } };
    expect(inventario({ estado: "ausente", causa: "atualizando", em: 1, atualizacao: torta }, 100).atualizacao).toEqual({ fase: "pedindo_aprovacao", alvo: "2.1.289", em: 50 });
    // O espaço só atravessa com os dois números inteiros, de 0 até 1 PB (em MB); um fora derruba o par, e a fase segue.
    for (const espaco of [{ livreMb: -1, precisaMb: 10 }, { livreMb: 10, precisaMb: -1 }, { livreMb: 1_000_000_001, precisaMb: 10 }, { livreMb: 10, precisaMb: 1_000_000_001 }, { livreMb: 10, precisaMb: "2048" }, { livreMb: 10 }]) {
      expect(inventario({ estado: "pronto", versao: "2.1.200", em: 1, atualizacao: { fase: "falhou", alvo: "2.1.289", em: 50, espaco } }, 100).atualizacao).toEqual({ fase: "falhou", alvo: "2.1.289", em: 50 });
    }
    expect(inventario({ estado: "pronto", versao: "2.1.200", em: 1, atualizacao: { fase: "falhou", alvo: "2.1.289", em: 50, espaco: { livreMb: 0, precisaMb: 1_000_000_000 } } }, 100).atualizacao?.espaco).toEqual({ livreMb: 0, precisaMb: 1_000_000_000 });
    // Sem fase conhecida, alvo semver ou instante, a atualização some e o anúncio segue.
    for (const ruim of [{ ...cheia, fase: "baixando" }, { ...cheia, alvo: "latest" }, { ...cheia, em: "agora" }, { ...cheia, em: 0 }, "falhou", null, []]) {
      expect(inventario({ estado: "pronto", versao: "2.1.200", em: 1, atualizacao: ruim }, 100)).toEqual({ estado: "pronto", versao: "2.1.200", em: 100 });
    }
  });
  it("conta sem acesso (2026-10-05): a causa é código fechado, a frase é do servidor, e o erro cru atravessa só até o teto", () => {
    expect(inventario({ estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "texto do Mac", versao: "9" }, 7)).toEqual({ estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "A conta entrou, mas está sem acesso: a organização dela desativou o uso por assinatura.", em: 7 });
    // App antigo (sem o campo) ou valor inventado: sem causa, com a frase de sempre.
    for (const causa of [undefined, "porque sim", 3, ["conta_sem_acesso"]]) expect(inventario({ estado: "nao_autenticado", causa }, 7)).toEqual({ estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 7 });
    // A causa não muda uma IA pronta.
    expect(inventario({ estado: "pronto", versao: "1", causa: "conta_sem_acesso" }, 7)).toEqual({ estado: "pronto", versao: "1", em: 7 });

    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "" } };
    const resultado = { desfecho: "falha", motivoFalha: "nao_autenticado", texto: "", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const ok = entrega({ ...base, resultado: { ...resultado, causaSemIa: "conta_sem_acesso", erroCru: "success | Your organization has disabled…" } }, "maq");
    expect(ok.resultado).toMatchObject({ causaSemIa: "conta_sem_acesso", erroCru: "success | Your organization has disabled…", motivoFalha: "nao_autenticado" });
    const estranho = entrega({ ...base, resultado: { ...resultado, causaSemIa: "inventada", erroCru: "x".repeat(8_001) } }, "maq").resultado;
    expect("causaSemIa" in estranho).toBe(false);
    expect("erroCru" in estranho).toBe(false);
    expect("erroCru" in entrega({ ...base, resultado: { ...resultado, erroCru: { texto: "objeto" } } }, "maq").resultado).toBe(false);
  });
  it("NOD-179: o uso do plano atravessa validado; fora do formato some e a entrega é aceita", () => {
    const agora = Date.UTC(2026, 9, 6, 12);
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "ok" } };
    const resultado = { desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const usoDoPlano = { harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.1, renovaEm: agora + 3_600_000 }, semana: null, medidoEm: agora - 1000 };
    expect(entrega({ ...base, resultado: { ...resultado, usoDoPlano } }, "maq", agora).resultado.usoDoPlano).toEqual(usoDoPlano);
    for (const utilizacao of [Number.NaN, -1, 5]) {
      const r = entrega({ ...base, resultado: { ...resultado, usoDoPlano: { ...usoDoPlano, cincoHoras: { utilizacao, renovaEm: null } } } }, "maq", agora).resultado;
      expect(r.desfecho).toBe("sucesso");
      expect("usoDoPlano" in r).toBe(false);
    }
    expect("usoDoPlano" in entrega({ ...base, resultado }, "maq", agora).resultado).toBe(false);
  });
  it("NOD-171: limite_do_plano atravessa com a hora em que volta; hora absurda, ou sem o limite, some", () => {
    const agora = Date.UTC(2026, 9, 6, 12);
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "" } };
    const resultado = { desfecho: "falha", motivoFalha: "limite_do_plano", texto: "", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const voltaEm = agora + 3_600_000;
    expect(entrega({ ...base, resultado: { ...resultado, limiteVoltaEm: voltaEm } }, "maq", agora).resultado).toMatchObject({ motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm });
    for (const ruim of [agora + 40 * 86_400_000, -1, 1.5, "amanhã", null]) {
      const r = entrega({ ...base, resultado: { ...resultado, limiteVoltaEm: ruim } }, "maq", agora).resultado;
      expect(r.motivoFalha).toBe("limite_do_plano");
      expect("limiteVoltaEm" in r).toBe(false);
    }
    expect("limiteVoltaEm" in entrega({ ...base, resultado: { ...resultado, motivoFalha: "erro_execucao", limiteVoltaEm: voltaEm } }, "maq", agora).resultado).toBe(false);
  });
  it("NOD-280 (re-QA A4, m04): hora entre 8 e 31 dias chega cortada em 8 dias, a mesma que o servidor grava", () => {
    const agora = Date.UTC(2026, 9, 6, 12);
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "" } };
    const resultado = { desfecho: "falha", motivoFalha: "limite_do_plano", texto: "", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    expect(entrega({ ...base, resultado: { ...resultado, limiteVoltaEm: agora + 20 * 86_400_000 } }, "maq", agora).resultado.limiteVoltaEm).toBe(agora + 8 * 86_400_000);
    expect(entrega({ ...base, resultado: { ...resultado, limiteVoltaEm: agora + 8 * 86_400_000 } }, "maq", agora).resultado.limiteVoltaEm).toBe(agora + 8 * 86_400_000);
  });
  it("ADR-101: a decisão das contas no limite atravessa só em turno falho e no formato; fora disso some", () => {
    const agora = Date.UTC(2026, 9, 12, 12);
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "" } };
    const resultado = { desfecho: "falha", motivoFalha: "limite_do_plano", texto: "", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const conta = { tipo: "perguntar", de: 1, livres: [2], foraDaTroca: [2], voltaEm: agora + 3_600_000 };
    expect(entrega({ ...base, resultado: { ...resultado, contaNoLimite: conta } }, "maq", agora).resultado.contaNoLimite).toEqual(conta);
    expect("contaNoLimite" in entrega({ ...base, resultado: { ...resultado, contaNoLimite: { ...conta, livres: [9] } } }, "maq", agora).resultado).toBe(false);
    // o limite do Codex chega como erro_execucao: a decisão atravessa; o servidor só a usa se ele mesmo vir limite
    expect(entrega({ ...base, resultado: { ...resultado, motivoFalha: "erro_execucao", contaNoLimite: conta } }, "maq", agora).resultado.contaNoLimite).toEqual(conta);
    expect("contaNoLimite" in entrega({ ...base, resultado: { ...resultado, desfecho: "sucesso", motivoFalha: undefined, contaNoLimite: conta } }, "maq", agora).resultado).toBe(false);
  });
  it("renovação leva texto e ferramentas NA ORDEM, juntando texto seguido, esvazia a fila e não mistura turnos", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "Próximo "); c.delta("x", "lote."); c.ferramenta("x", "mcp__nod__gmail__search_threads"); c.delta("x", "44 processados.");
    c.delta("outro", "de outro turno");
    const pedido = { turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] };
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ texto: "Próximo lote." }, { ferramenta: "mcp__nod__gmail__search_threads" }, { texto: "44 processados." }]);
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[1]?.[1]?.body)).trechos).toEqual([]);
    // Pool de laços: cada turno renova só o próprio texto.
    await c.ponte.renovar({ ...pedido, turnoId: "outro" });
    expect(JSON.parse(String(f.mock.calls[2]?.[1]?.body)).trechos).toEqual([{ texto: "de outro turno" }]);
  });
  it("ADR-165: a ferramenta sai com o resumo do argumento, redigido de novo na saída e com o teto do executor (120)", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.ferramenta("x", "Bash", "t1", `deploy --token=abcdefgh123 ${"y".repeat(300)}`);
    c.ferramenta("x", "Read", "t2");
    c.ferramenta("x", "Grep", undefined, "turno\\.atividade");
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    const [bash, read, grep] = JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos as { ferramenta: string; id?: string; resumo?: string }[];
    expect(bash).toMatchObject({ ferramenta: "Bash", id: "t1" });
    expect(bash!.resumo).not.toContain("abcdefgh123");
    expect(Array.from(bash!.resumo!).length).toBe(120);
    expect(read).toEqual({ ferramenta: "Read", id: "t2" });
    expect(grep).toEqual({ ferramenta: "Grep", resumo: "turno\\.atividade" });
  });
  it("vigia (NOD-73): o aviso novo substitui o que ainda não saiu; o servidor só aceita nome e números", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "oi"); c.vigia("x", { mudoMs: 600_000, emFundo: 0 }); c.vigia("x", { mudoMs: 1_200_000, aberta: "Bash", emFundo: 1 });
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ texto: "oi" }, { vigia: { mudoMs: 1_200_000, aberta: "Bash", emFundo: 1 } }]);

    const valido = { mudoMs: 600_000, aberta: "mcp__nod__gmail__search_threads", emFundo: 2, repeticao: { nome: "Bash", vezes: 10 } };
    expect(trechos([{ vigia: valido }])).toEqual([{ vigia: valido }]);
    expect(trechos([{ vigia: { mudoMs: 0, emFundo: 0 } }])).toEqual([{ vigia: { mudoMs: 0, emFundo: 0 } }]);
    // Estrito: campo a mais (argumento), nome fora do formato, limiar inventado ou número fora da faixa somem.
    expect(trechos([
      { vigia: { ...valido, input: { command: "cat .env" } } },
      { vigia: { ...valido, repeticao: { nome: "Bash", vezes: 10, input: "x" } } },
      { vigia: { ...valido, aberta: "rm -rf /" } },
      { vigia: { ...valido, repeticao: { nome: "Bash", vezes: 7 } } },
      { vigia: { mudoMs: -1, emFundo: 0 } },
      { vigia: { mudoMs: 1.5, emFundo: 0 } },
      { vigia: { mudoMs: 0, emFundo: 1001 } },
      { vigia: "x" },
      { texto: "ok" },
    ])).toEqual([{ texto: "ok" }]);
  });
  it("subagentes (NOD-350, critério 6): a lista nova substitui a que não saiu; o servidor só aceita o contrato estrito", async () => {
    const f = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith("/puxar") ? { plano: { turnoId: "x" } } : { ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    const um = { id: "ae5ad90904c8b0ae8", natureza: "agente" as const, descricao: "Contar linhas do um.txt", estado: "trabalhando" as const, passo: "Read", chamadas: 1, duracaoMs: 898 };
    const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
    // Turno que este Mac não está rodando (nunca puxou, ou já entregou): a lista não entra na fila.
    c.subagentes("x", [um]);
    await c.ponte.puxar("p");
    c.subagentes("x", [um]); c.delta("x", "oi"); c.subagentes("x", [{ ...um, chamadas: 2 }], true);
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais, eventos: [] });
    expect(JSON.parse(String(f.mock.calls[1]?.[1]?.body)).trechos).toEqual([{ texto: "oi" }, { subagentes: [{ ...um, chamadas: 2 }], ocioso: true }]);
    // O `parar` do fim do turno chega depois do `entregar`: não recria a fila do turno (nunca mais sairia nem seria apagada).
    let soltar!: () => void;
    f.mockImplementationOnce(() => new Promise((ok) => { soltar = () => ok(new Response("{}")); }));
    const entrega = c.ponte.entregar({ turnoId: "x" } as never);
    // A lista que sai a cada 5 s cai no meio da entrega (que pode tentar por 120 s): não recria a fila.
    c.subagentes("x", [{ ...um, estado: "parado" }]);
    soltar();
    await entrega;
    c.subagentes("x", [{ ...um, estado: "parado" }]);
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais, eventos: [] });
    expect(JSON.parse(String(f.mock.calls.at(-1)?.[1]?.body)).trechos ?? []).toEqual([]);
    // `ocioso` é a única segunda chave aceita, e só booleana.
    expect(trechos([{ subagentes: [um], ocioso: false }])).toEqual([{ subagentes: [um], ocioso: false }]);
    expect(trechos([{ subagentes: [um], ocioso: "sim" }, { subagentes: [um], resumo: "x" }, { texto: "ok" }])).toEqual([{ texto: "ok" }]);

    const comando = { id: "b1", natureza: "comando", descricao: "", estado: "concluido", passo: null, chamadas: 0, duracaoMs: 0 };
    expect(trechos([{ subagentes: [um, comando] }])).toEqual([{ subagentes: [um, comando] }]);
    expect(trechos([{ subagentes: [] }])).toEqual([{ subagentes: [] }]);
    const ruins: unknown[] = [
      { ...um, summary: "Li o arquivo e achei 3 linhas" },
      { ...um, prompt: "Leia um.txt" },
      { ...um, input: { command: "cat .env" } },
      { ...um, descricao: "d".repeat(81) },
      { ...um, descricao: "linha\nquebrada" },
      { ...comando, descricao: "rm -rf /tmp/x" },
      { ...um, estado: "rodando" },
      { ...um, natureza: "bash" },
      { ...um, passo: "p".repeat(81) },
      { ...um, passo: "" },
      { ...um, passo: "Leu um arquivo" },
      { ...um, passo: "<img src=x onerror=alert(1)>" },
      { ...um, chamadas: -1 },
      { ...um, chamadas: 1.5 },
      { ...um, duracaoMs: 8 * 24 * 3_600_000 },
      { ...um, id: "../x" },
      (({ passo: _p, ...r }) => r)(um),
      "x",
    ];
    for (const ruim of ruins) expect(trechos([{ subagentes: [ruim] }, { texto: "ok" }])).toEqual([{ texto: "ok" }]);
    expect(trechos([{ subagentes: [um, um] }])).toEqual([]);
    expect(trechos([{ subagentes: Array.from({ length: 21 }, (_, i) => ({ ...um, id: `a${i}` })) }])).toEqual([]);
    expect(trechos([{ subagentes: Array.from({ length: 20 }, (_, i) => ({ ...um, id: `a${i}` })) }])[0]).toBeDefined();
  });
  it("fila acima de 16k de texto descarta o mais antigo", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "a".repeat(10_000)); c.ferramenta("x", "Bash"); c.delta("x", "b".repeat(10_000));
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    const enviados = JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos as { texto?: string }[];
    expect(enviados.reduce((n, t) => n + (t.texto?.length ?? 0), 0)).toBe(16_000);
    expect(enviados.at(-1)?.texto).toBe("b".repeat(10_000));
  });
  it("ADR-085: a leitura de memória aceita o processador (opcional); fora do formato ele é ignorado, não a leitura toda (revisão do #209)", () => {
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [] })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [] });
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], processador: { nivel: "amarela", carga: 0.8 } })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [], processador: { nivel: "amarela", carga: 0.8 } });
    for (const processador of [{ nivel: "laranja", carga: 1 }, { nivel: "verde", carga: -1 }, { nivel: "verde", carga: 5000 }, { nivel: "verde" }, "alto", null]) {
      expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], processador })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [] });
    }
    expect(() => memoria({ nivel: "laranja", totalMb: 10, porTurno: [] })).toThrow();
  });

  it("ADR-091: o uso da CPU (0 a 1) vai junto; fora disso some só ele, e a leitura vale como a de um app anterior", () => {
    const base = { nivel: "verde", totalMb: 10, porTurno: [] };
    expect(memoria({ ...base, processador: { nivel: "vermelha", carga: 3, uso: 0.75 } })).toEqual({ ...base, processador: { nivel: "vermelha", carga: 3, uso: 0.75 } });
    for (const uso of [-0.1, 1.5, Number.NaN, "0.5", null]) {
      expect(memoria({ ...base, processador: { nivel: "vermelha", carga: 3, uso } })).toEqual({ ...base, processador: { nivel: "vermelha", carga: 3 } });
    }
  });
  it("#219: a leitura aceita o disco (opcional); fora do formato ele é ignorado sozinho — sem medição, nada espera", () => {
    const disco = { livreMb: 17_408, totalMb: 477_184 };
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], disco })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [], disco });
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], processador: { nivel: "verde", carga: 0.2 }, disco })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [], processador: { nivel: "verde", carga: 0.2 }, disco });
    // Revisão do #224: null passa como null (o app mede e não conseguiu).
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], disco: null })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [], disco: null });
    for (const ruim of [{ livreMb: 20, totalMb: 10 }, { livreMb: -1, totalMb: 10 }, { livreMb: 1.5, totalMb: 10 }, { livreMb: 0, totalMb: 0 }, { livreMb: 1 }, "cheio", [1, 2]]) {
      expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], disco: ruim })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [] });
    }
  });

  it("servidor: trecho fora do formato cai sozinho; acima do teto, nada passa", () => {
    expect(trechos([{ texto: "oi" }, { ferramenta: "mcp__nod__x" }, { ferramenta: "rm -rf /" }, { texto: "a", ferramenta: "b" }, 3])).toEqual([{ texto: "oi" }, { ferramenta: "mcp__nod__x" }]);
    expect(trechos([{ texto: "a".repeat(9_000) }, { texto: "b".repeat(9_000) }])).toEqual([]);
    expect(trechos("texto")).toEqual([]);
  });
  it("servidor: a lista de tarefas do bot passa validada; fora do formato ou acima de 50, o trecho some", () => {
    const tarefas = [{ id: "1", titulo: "Ler o diff", estado: "feita" }, { id: "2", titulo: "Checar SQL", estado: "andamento" }];
    expect(trechos([{ tarefas }])).toEqual([{ tarefas }]);
    expect(trechos([{ tarefas: [{ id: "1", titulo: "x", estado: "concluida" }] }, { texto: "ok" }])).toEqual([{ texto: "ok" }]);
    expect(trechos([{ tarefas: Array.from({ length: 51 }, (_, i) => ({ id: String(i), titulo: "t", estado: "pendente" })) }])).toEqual([]);
  });
  it("ADR-067: falas da sessão viva — seq inteiro ≥ 1 e texto dentro do teto; fora do formato a renovação é recusada (o executor reenvia)", () => {
    expect(falas(undefined)).toEqual([]);
    expect(falas([{ seq: 1, texto: "Disparei os testes." }, { seq: 2, texto: "Verdes." }])).toEqual([{ seq: 1, texto: "Disparei os testes." }, { seq: 2, texto: "Verdes." }]);
    for (const ruim of [[{ seq: 0, texto: "x" }], [{ seq: 1.5, texto: "x" }], [{ seq: 1 }], [{ seq: 1, texto: "x".repeat(TEXTO_ENTREGA_MAX_CHARS + 1) }], "x", Array.from({ length: 51 }, (_, i) => ({ seq: i + 1, texto: "t" }))]) {
      expect(() => falas(ruim), JSON.stringify(ruim).slice(0, 60)).toThrow();
    }
  });
});

describe("NOD-175: ponte do servidor na drenagem", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const LONGPOLL_MS = 2_000;
  const plano = { turnoId: "00000000-0000-4000-8000-000000000003" } as PlanoTurno;

  function montar(puxar: PonteInternaNod["puxar"], papel: "motor" | "computador" | null = null) {
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: LONGPOLL_MS,
      ...(papel ? { papelDaChave: async () => papel } : {}),
    });
    const chamar = async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    return { p, chamar };
  }
  const conectar = { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } };

  it("reserva em voo quando a drenagem começa: o plano é entregue e reservasEmVoo volta de 1 a 0", async () => {
    let soltar: (p: PlanoTurno) => void = () => undefined;
    const { p, chamar } = montar(() => new Promise((r) => { soltar = r; }));
    await chamar("conectar", conectar);
    const puxando = chamar("puxar");
    await vi.waitFor(() => expect(p.reservasEmVoo()).toBe(1));
    p.iniciarDrenagem();
    soltar(plano);
    expect(await puxando).toEqual({ status: 200, body: { plano } });
    expect(p.reservasEmVoo()).toBe(0);
  });

  it("NOD-94: a máquina só-computador conecta, mas nunca reserva turno — o puxar espera e volta {plano:null}; a sessão diz o papel", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValue(plano);
    const { p, chamar } = montar(puxar, "computador");
    expect(await chamar("sessao")).toMatchObject({ status: 200, body: { papel: "computador" } });
    expect(await chamar("conectar", { ...conectar, papel: "motor" })).toMatchObject({ status: 200, body: { papel: "computador" } });
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: null } });
    expect(puxar).not.toHaveBeenCalled();
    expect(p.reservasEmVoo()).toBe(0);
  });

  it("NOD-94: sem o papel da chave (servidor de teste, chave antiga) a sessão e o conectar dizem motor", async () => {
    const { chamar } = montar(vi.fn<PonteInternaNod["puxar"]>().mockResolvedValue(plano));
    expect(await chamar("sessao")).toMatchObject({ body: { papel: "motor" } });
    expect(await chamar("conectar", conectar)).toMatchObject({ body: { papel: "motor" } });
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano } });
  });

  it("ADR-085: o puxar leva a leitura do Mac (com o processador) até a ponte; app antigo manda {} e a ponte recebe undefined", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValue(plano);
    const { chamar } = montar(puxar);
    await chamar("conectar", conectar);
    const leitura = { nivel: "verde", totalMb: 900, porTurno: [], processador: { nivel: "vermelha", carga: 1.4 } };
    await chamar("puxar", { memoria: leitura });
    expect(puxar).toHaveBeenLastCalledWith(escopo.pessoaId, leitura);
    await chamar("puxar", {});
    expect(puxar).toHaveBeenLastCalledWith(escopo.pessoaId, undefined);
  });

  it("revisão do #209: leitura com defeito no puxar vai como 'sem leitura' (nunca 400); a leitura entra uma vez por pedido, não a cada volta da espera", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(plano);
    const { chamar } = montar(puxar);
    await chamar("conectar", conectar);
    const leitura = { nivel: "amarela", totalMb: 900, porTurno: [] };
    expect(await chamar("puxar", { memoria: leitura })).toEqual({ status: 200, body: { plano } });
    expect(puxar.mock.calls.map((c) => c[1])).toEqual([leitura, undefined, undefined]);
    puxar.mockClear();
    expect(await chamar("puxar", { memoria: { nivel: "laranja" } })).toEqual({ status: 200, body: { plano } });
    expect(puxar).toHaveBeenLastCalledWith(escopo.pessoaId, undefined);
  });

  it("drenando: o puxar volta {plano:null} na hora, sem chamar a ponte; drenagem no meio do long-poll também corta a espera", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValue(null);
    const { p, chamar } = montar(puxar);
    await chamar("conectar", conectar);
    const esperando = chamar("puxar");
    await vi.waitFor(() => expect(puxar).toHaveBeenCalled());
    const inicio = Date.now();
    p.iniciarDrenagem();
    expect(await esperando).toEqual({ status: 200, body: { plano: null } });
    // NOD-194: o que importa é não ter esperado o long-poll; afirmado contra ele, não contra um número mágico.
    expect(Date.now() - inicio).toBeLessThan(LONGPOLL_MS / 2);
    puxar.mockClear();
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: null } });
    expect(puxar).not.toHaveBeenCalled();
    expect(p.reservasEmVoo()).toBe(0);
  });
});

describe("NOD-167: Codex sem app-server no anúncio do Mac", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  function montar() {
    const maquinas = new Map<string, AnuncioMaquina>();
    const ponte: PonteInternaNod = { conectar: async (m) => { maquinas.set(m.machineId, m); }, puxar: async () => null, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [...maquinas.values()], escopoDoTurno: () => null };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
    });
    const conectar = async (corpo: unknown) => {
      const rota = p.rotas.find((r) => r.padrao.test("/conectar"));
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: () => undefined });
    };
    return { p, maquinas, conectar };
  }
  const pronto = { estado: "pronto", versao: "fake", em: 0 };
  const base = { versaoContrato: 1, nome: "Mac", inventario: pronto, ligacao: true };

  it("o Codex pronto anunciado sem app-server recusa; app antigo (sem o campo), lixo no campo ou Codex fora não recusam", async () => {
    const { p, maquinas, conectar } = montar();
    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto }, semLacoDeVoz: ["codex-cli", "hermes", 7, "__proto__"] });
    expect(maquinas.get("m1")?.semLacoDeVoz).toEqual(["codex-cli"]);
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(true);
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "claude-cli")).toBe(false);
    expect(p.semLacoDeVozDaPessoa("outra-pessoa", "codex-cli")).toBe(false);

    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(maquinas.get("m1")?.semLacoDeVoz).toBeUndefined();
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(false);

    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto }, semLacoDeVoz: "codex-cli" });
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(false);

    // Codex não pronto: a recusa é a de sempre (sem_ia), não esta.
    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": { estado: "ausente", motivo: "x", em: 0 } }, semLacoDeVoz: ["codex-cli"] });
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(false);
  });

  /** Revisão do épico #188 (S15, 2026-10-08): o anúncio das capacidades chega à ponte só com chaves e harnesses conhecidos. */
  it("S15: as capacidades anunciadas chegam à ponte; ausentes ou lixo, o anúncio sai sem elas", async () => {
    const { maquinas, conectar } = montar();
    await conectar({ ...base, harnesses: { "claude-cli": pronto }, capacidades: { "claude-cli": { bifurcaSessao: true, retomaSessao: "sim", inventada: true }, hermes: { bifurcaSessao: true }, __proto__: { x: 1 } } });
    expect(maquinas.get("m1")?.capacidades).toEqual({ "claude-cli": { mensagemNoMeio: false, retomaSessao: false, bifurcaSessao: true, processoProprio: false, terminal: false, anexos: [], comandosDoCli: false, pastaDeTrabalho: false, anexarMidia: false } });
    await conectar({ ...base, harnesses: { "claude-cli": pronto } });
    expect(maquinas.get("m1")?.capacidades).toBeUndefined();
    await conectar({ ...base, harnesses: { "claude-cli": pronto }, capacidades: ["claude-cli"] });
    expect(maquinas.get("m1")?.capacidades).toBeUndefined();
  });
});

describe("NOD-199: anúncio só de inventário no servidor", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const turnoId = "00000000-0000-4000-8000-000000000003";
  const pronto = { estado: "pronto", versao: "fake", em: 0 };
  const semLogin = { estado: "nao_autenticado", motivo: "entre", em: 0 };
  function montar() {
    const relogio = { agora: 1_800_000_000_000 };
    const maquinas = new Map<string, AnuncioMaquina>();
    const entregues: string[] = [];
    const barrados: string[][] = [];
    const plataformas: [string, string][] = [];
    const ponte: PonteInternaNod = {
      conectar: async (m) => { maquinas.set(m.machineId, m); }, puxar: async () => ({ turnoId } as PlanoTurno), renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }),
      entregar: async (e) => { entregues.push(e.turnoId); }, desconectar: async () => undefined, maquinasConectadas: () => [...maquinas.values()], escopoDoTurno: () => null,
    };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => relogio.agora, delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
      repetirBarrados: async (_e, prontos) => { barrados.push([...prontos]); },
      registrarPlataforma: async (_e, chaveId, plataforma) => { plataformas.push([chaveId, plataforma]); },
    });
    const chamar = async (nome: string, corpo: unknown = {}, o: { escopo?: typeof escopo; versao?: string } = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": o.versao ?? VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo: o.escopo ?? escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    return { p, chamar, relogio, maquinas, entregues, barrados, plataformas };
  }
  const base = { versaoContrato: 1, nome: "Mac", inventario: pronto, ligacao: true };
  const entregaDe = { turnoId, machineId: "m1", seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] } };

  it.each([["logo depois do puxar", 1_000], ["mais de 90 s depois do último contato", 95_000]])("com um turno rodando, o anúncio %s atualiza as IAs sem recusar nem limpar o plano; o turno entrega", async (_n, ms) => {
    const { p, chamar, relogio, maquinas, entregues, barrados } = montar();
    await chamar("conectar", { ...base, harnesses: { "claude-cli": pronto, "codex-cli": semLogin } });
    expect((await chamar("puxar")).body).toEqual({ plano: { turnoId } });
    relogio.agora += ms;
    expect(await chamar("inventario", { ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).toEqual({ status: 200, body: { ok: true } });
    expect(p.harnessesDaPessoa(escopo.pessoaId)["codex-cli"]?.estado).toBe("pronto");
    // O nome e o laço de voz vêm do conectar; o resto, do anúncio novo.
    expect(maquinas.get("m1")).toMatchObject({ machineId: "m1", nome: "Mac", ligacao: true, harnesses: { "codex-cli": { estado: "pronto" } } });
    expect(barrados.at(-1)).toEqual(["claude-cli", "codex-cli"]);
    // O plano continua lá: a entrega casa e é aceita.
    expect(await chamar("entregar", entregaDe)).toEqual({ status: 200, body: { ok: true } });
    expect(entregues).toEqual([turnoId]);
    // O conectar, ao contrário, recusa com turno rodando (o comportamento que a NOD-199 contorna, sem mudar).
    await chamar("puxar");
    await expect(chamar("conectar", base)).rejects.toThrow("estado_invalido");
  });

  it("QA: o anúncio não esquece as entregas já recebidas — a entrega repetida depois dele continua idempotente", async () => {
    // A entrega foi aceita, mas a resposta se perdeu; antes do reenvio do app, a vigia anunciou o Codex. Se a rota de
    // inventário zerasse `recebidas`, o reenvio cairia em nao_permitido (o plano já saiu) em vez do 200 idempotente.
    const { chamar, entregues } = montar();
    await chamar("conectar", { ...base, harnesses: { "claude-cli": pronto, "codex-cli": semLogin } });
    await chamar("puxar");
    expect(await chamar("entregar", entregaDe)).toEqual({ status: 200, body: { ok: true } });
    expect(await chamar("inventario", { ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto } })).toEqual({ status: 200, body: { ok: true } });
    expect(await chamar("entregar", entregaDe)).toEqual({ status: 200, body: { ok: true } });
    expect(entregues).toEqual([turnoId]);
  });

  it("sem conexão desta chave, ou com a chave de outra pessoa, recusa com estado_invalido (409 → reconectar)", async () => {
    const { chamar } = montar();
    await expect(chamar("inventario", base)).rejects.toThrow("estado_invalido");
    await chamar("conectar", base);
    await expect(chamar("inventario", base, { escopo: { ...escopo, pessoaId: "00000000-0000-4000-8000-000000000009" } })).rejects.toThrow("estado_invalido");
    await expect(chamar("inventario", base, { escopo: { ...escopo, tenantId: "00000000-0000-4000-8000-000000000009" } })).rejects.toThrow("estado_invalido");
  });

  it("app abaixo da versão mínima: 426, como nas outras rotas; corpo sem o contrato: entrada inválida", async () => {
    const { chamar } = montar();
    await chamar("conectar", base);
    expect(await chamar("inventario", base, { versao: "0.0.1" })).toEqual({ status: 426, body: { codigo: "atualize_app", versaoMinimaApp: VERSAO_MINIMA_APP } });
    await expect(chamar("inventario", { ...base, versaoContrato: 2 })).rejects.toThrow("entrada_invalida");
  });

  it.each(["conectar", "inventario"])("o anúncio pela rota %s filtra igual: harness não integrado, semLacoDeVoz de IA não pronta e campos extras ficam de fora", async (rota) => {
    const { chamar, maquinas } = montar();
    await chamar("conectar", base);
    await chamar(rota, { ...base, harnesses: { "claude-cli": pronto, "codex-cli": semLogin, hermes: pronto, __proto__: pronto }, semLacoDeVoz: ["codex-cli", "claude-cli", "hermes"], capacidades: { "claude-cli": { bifurcaSessao: true, inventada: 1 }, hermes: { bifurcaSessao: true } }, extra: "ignorado", planos: [] });
    const m = maquinas.get("m1")!;
    expect(Object.keys(m.harnesses ?? {}).sort()).toEqual(["claude-cli", "codex-cli"]);
    expect(m.semLacoDeVoz).toEqual(["claude-cli"]);
    expect(m.capacidades).toEqual({ "claude-cli": { mensagemNoMeio: false, retomaSessao: false, bifurcaSessao: true, processoProprio: false, terminal: false, anexos: [], comandosDoCli: false, pastaDeTrabalho: false, anexarMidia: false } });
    expect(m).not.toHaveProperty("extra");
    expect(m).not.toHaveProperty("planos");
  });

  it("QA (merge com a ADR-090): o anúncio de inventário mantém o nome e a plataforma do conectar — o motor na VM segue \"linux\"", async () => {
    const { p, chamar, maquinas, plataformas } = montar();
    await chamar("conectar", { ...base, nome: "vm-nod", plataforma: "linux", harnesses: { "claude-cli": pronto, "codex-cli": semLogin } });
    expect(maquinas.get("m1")?.plataforma).toBe("linux");
    await chamar("inventario", { ...base, nome: "outro", plataforma: "darwin", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(maquinas.get("m1")).toMatchObject({ nome: "vm-nod", plataforma: "linux", harnesses: { "codex-cli": { estado: "pronto" } } });
    expect(p.maquina(escopo, "m1")).toEqual({ nome: "vm-nod", plataforma: "linux" });
    // 2026-10-09 (0067): só o `conectar` grava a plataforma na chave — é ela que o aviso de queda lê depois que a conexão some.
    expect(plataformas).toEqual([["m1", "linux"]]);
    await chamar("conectar", { ...base, harnesses: { "claude-cli": pronto } });
    expect(plataformas).toEqual([["m1", "linux"], ["m1", "darwin"]]);
  });
  it("auditoria A2: a máquina que volta entre 60 e 90 s de silêncio recebe 409 no puxar (o cliente reconecta) e, reanunciada, volta a receber turno", async () => {
    const { p, chamar, relogio } = montar();
    await chamar("conectar", base);
    relogio.agora += 61_000;
    await p.varrer();
    // O varredor rebaixou o inventário; a conexão só some aos 90 s. Antes, o puxar respondia 200 sem nunca reservar.
    expect(p.inventario(escopo.pessoaId).estado).toBe("ausente");
    await expect(chamar("puxar")).rejects.toThrow("estado_invalido");
    relogio.agora += 5_000;
    await expect(chamar("puxar")).rejects.toThrow("estado_invalido");
    // O 409 vira `reconectar` no cliente, que manda o anúncio pelo `conectar`: o inventário volta e o puxar reserva.
    expect(await chamar("conectar", base)).toMatchObject({ status: 200 });
    expect(p.inventario(escopo.pessoaId).estado).toBe("pronto");
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: { turnoId } } });
  });

  it("auditoria A2: o anúncio pela rota de inventário também devolve a conexão rebaixada; com menos de 60 s nada muda", async () => {
    const { p, chamar, relogio } = montar();
    await chamar("conectar", base);
    relogio.agora += 59_000;
    await p.varrer();
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: { turnoId } } });
    await chamar("entregar", entregaDe);
    relogio.agora += 61_000;
    await p.varrer();
    await expect(chamar("puxar")).rejects.toThrow("estado_invalido");
    expect(await chamar("inventario", base)).toEqual({ status: 200, body: { ok: true } });
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: { turnoId } } });
  });

  it("auditoria A4: o processo que voltou em menos de 90 s com planos órfãos conecta — o servidor descarta o que ele não roda", async () => {
    const { p, chamar, relogio } = montar();
    await chamar("conectar", base);
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: { turnoId } } });
    // O processo morreu sem `desconectar` (SIGKILL) e o novo conecta logo: lista vazia = não roda nada.
    relogio.agora += 5_000;
    expect(await chamar("conectar", { ...base, turnosEmAndamento: [] })).toMatchObject({ status: 200 });
    // O plano órfão saiu: a entrega dele (sem token de adoção) é recusada, e o próximo conectar não recusa mais.
    await expect(chamar("entregar", entregaDe)).rejects.toThrow("nao_permitido");
    expect(await chamar("conectar", base)).toMatchObject({ status: 200 });
    expect(p.inventario(escopo.pessoaId).estado).toBe("pronto");
  });

  it("auditoria A4: o turno que o cliente ainda roda fica no conectar (a entrega casa); lista fora do formato segue a regra antiga", async () => {
    const { chamar, entregues } = montar();
    await chamar("conectar", base);
    await chamar("puxar");
    expect(await chamar("conectar", { ...base, turnosEmAndamento: [turnoId] })).toMatchObject({ status: 200 });
    expect(await chamar("entregar", entregaDe)).toEqual({ status: 200, body: { ok: true } });
    expect(entregues).toEqual([turnoId]);
    await chamar("puxar");
    for (const lixo of ["x", ["nao-uuid"], Array.from({ length: 65 }, () => turnoId)]) await expect(chamar("conectar", { ...base, turnosEmAndamento: lixo })).rejects.toThrow("estado_invalido");
  });
});

describe("ADR-088: a limpeza das pastas de task pela ponte", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const pasta = { trabalhoId: "00000000-0000-4000-8000-000000000009", pasta: "Dev 1/fix-abc123", quando: "encerrada" } as const;

  it("servidor: a pessoa é a da chave; o relato só leva números conhecidos", async () => {
    const pastasParaLimpar = vi.fn<NonNullable<PonteInternaNod["pastasParaLimpar"]>>().mockResolvedValue([pasta]);
    const relatarLimpeza = vi.fn<NonNullable<PonteInternaNod["relatarLimpeza"]>>().mockResolvedValue(undefined);
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar: async () => null, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null, pastasParaLimpar, relatarLimpeza };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
    });
    const chamar = async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } });
    expect(await chamar("limpeza", { pessoaId: "outra" })).toEqual({ status: 200, body: { pastas: [pasta] } });
    expect(pastasParaLimpar).toHaveBeenCalledWith(escopo.pessoaId, { apertado: false });
    // ADR-096: o disco apertado atravessa; só o booleano `true` conta.
    await chamar("limpeza", { apertado: true });
    expect(pastasParaLimpar).toHaveBeenLastCalledWith(escopo.pessoaId, { apertado: true });
    await chamar("limpeza", { apertado: "sim" });
    expect(pastasParaLimpar).toHaveBeenLastCalledWith(escopo.pessoaId, { apertado: false });
    // ADR-106: os códigos das pastas atravessam validados — só sha256 em hex minúsculo, sem repetir; lista vazia é
    // lista. Nome de pasta não passa (nunca sai da máquina).
    const a = "a".repeat(64);
    const b = "0123456789abcdef".repeat(4);
    await chamar("limpeza", { codigos: [a, "Vera/a-111111", "A".repeat(64), "a".repeat(63), 3, a, b] });
    expect(pastasParaLimpar).toHaveBeenLastCalledWith(escopo.pessoaId, { apertado: false, codigos: [a, b] });
    await chamar("limpeza", { codigos: [] });
    expect(pastasParaLimpar).toHaveBeenLastCalledWith(escopo.pessoaId, { apertado: false, codigos: [] });
    await chamar("limpeza", { codigos: a, pastas: ["Vera/a-111111"] });
    expect(pastasParaLimpar).toHaveBeenLastCalledWith(escopo.pessoaId, { apertado: false });
    await chamar("limpeza/resultado", { relato: { pastas: 2, removidas: 1, liberadoBytes: 1_048_576, puladas: { suja: 1, inventado: 9 }, caminho: "/Users/m/nod/x", orfas: -3 } });
    // ADR-106: o relato leva a máquina que limpou.
    expect(relatarLimpeza).toHaveBeenCalledWith(escopo.pessoaId, { pastas: 2, removidas: 1, pastasApagadas: 0, liberadoBytes: 1_048_576, puladas: { suja: 1 }, orfas: 0, orfasParadas: 0, duracaoMs: 0 }, "m1");
    // Revisão do #225: a passada simulada atravessa marcada, com o tamanho estimado.
    await chamar("limpeza/resultado", { relato: { removidas: 3, simulada: true, estimadoBytes: 2048, puladas: { aninhado: 1, head_solto: 2 } } });
    expect(relatarLimpeza).toHaveBeenLastCalledWith(escopo.pessoaId, expect.objectContaining({ removidas: 3, simulada: true, estimadoBytes: 2048, puladas: { aninhado: 1, head_solto: 2 } }), "m1");
    // 2ª revisão: a passada adiada (Docker mudo) também atravessa marcada.
    await chamar("limpeza/resultado", { relato: { adiada: true } });
    expect(relatarLimpeza).toHaveBeenLastCalledWith(escopo.pessoaId, expect.objectContaining({ adiada: true, removidas: 0 }), "m1");
    // ADR-096: a passada apertada atravessa marcada, com o que os caches liberaram.
    await chamar("limpeza/resultado", { relato: { apertada: true, cachesBytes: 4096, removidas: 2 } });
    expect(relatarLimpeza).toHaveBeenLastCalledWith(escopo.pessoaId, expect.objectContaining({ apertada: true, cachesBytes: 4096, removidas: 2 }), "m1");
    // ADR-096 §4: os guardados, os vencidos, as órfãs e os motivos novos atravessam; número inválido some.
    await chamar("limpeza/resultado", { relato: { guardadas: 3, guardadoBytes: 1_048_576, guardadosVencidos: 2, orfasRemovidas: -1, puladas: { processo_vivo: 1, grande_demais: 1, clone_sumiu: 1 } } });
    const ultimo = relatarLimpeza.mock.lastCall?.[1];
    expect(ultimo).toMatchObject({ guardadas: 3, guardadoBytes: 1_048_576, guardadosVencidos: 2, puladas: { processo_vivo: 1, grande_demais: 1, clone_sumiu: 1 } });
    expect(ultimo).not.toHaveProperty("orfasRemovidas");
    expect(ultimo).not.toHaveProperty("pastasEnviadas");
    // ADR-106: os contadores da lista atravessam (zero também); a máquina antiga não manda e eles não aparecem.
    await chamar("limpeza/resultado", { relato: { pastasEnviadas: 300, pastasCortadas: 0, candidatos: -2 } });
    expect(relatarLimpeza.mock.lastCall?.[1]).toMatchObject({ pastasEnviadas: 300, pastasCortadas: 0, candidatos: 0 });
    // E viram campos do `limpeza_feita`, zero inclusive; sem eles (máquina antiga), os campos não aparecem.
    expect(camposDoRelato(relatoValido({ pastasEnviadas: 300, pastasCortadas: 2, candidatos: 0 }))).toMatchObject({ pastas_enviadas: 300, pastas_cortadas: 2, candidatos: 0 });
    expect(camposDoRelato(relatoValido({}))).not.toHaveProperty("pastas_enviadas");
    // NOD-295 A: os clones apagados sem guardar atravessam e viram `clones_apagados`; zero ou inválido some.
    expect(camposDoRelato(relatoValido({ clonesApagados: 4 }))).toMatchObject({ clones_apagados: 4 });
    expect(relatoValido({ clonesApagados: -1 })).not.toHaveProperty("clonesApagados");
    expect(camposDoRelato(relatoValido({}))).not.toHaveProperty("clones_apagados");
  });

  it("app: servidor antigo (404) ou resposta estranha vira lista vazia; só itens no formato passam", async () => {
    const antigo = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 })) });
    expect(await antigo.ponte.pastasParaLimpar!("p")).toEqual([]);
    const corpo = { pastas: [pasta, { trabalhoId: "x", pasta: 3, quando: "encerrada" }, { trabalhoId: "y", pasta: "a/b", quando: "agora" }] };
    const f = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(corpo), { headers: { "x-nod-versao-minima": "0.1.0" } }));
    const novo = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    expect(await novo.ponte.pastasParaLimpar!("p")).toEqual([pasta]);
    expect(JSON.parse(String(f.mock.lastCall?.[1]?.body))).toEqual({});
    await novo.ponte.pastasParaLimpar!("p", { apertado: true });
    expect(JSON.parse(String(f.mock.lastCall?.[1]?.body))).toEqual({ apertado: true });
    // ADR-106: os códigos das pastas do disco vão no corpo, sozinhos ou com o aperto; lista vazia também vai.
    await novo.ponte.pastasParaLimpar!("p", { codigos: ["a".repeat(64)] });
    expect(JSON.parse(String(f.mock.lastCall?.[1]?.body))).toEqual({ codigos: ["a".repeat(64)] });
    await novo.ponte.pastasParaLimpar!("p", { apertado: true, codigos: [] });
    expect(JSON.parse(String(f.mock.lastCall?.[1]?.body))).toEqual({ apertado: true, codigos: [] });
    await novo.ponte.relatarLimpeza!("p", { pastas: 1, removidas: 0, pastasApagadas: 0, liberadoBytes: 0, puladas: {}, orfas: 0, orfasParadas: 0, duracaoMs: 5 });
    expect(f).toHaveBeenLastCalledWith("https://nod.example/api/maquina/limpeza/resultado", expect.objectContaining({ method: "POST" }));
  });

  it("ADR-106: o pedido que falha não vira um 'nada a limpar' calado — fica no log, só com a contagem dos códigos", async () => {
    const saida = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const fora = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")) });
      expect(await fora.ponte.pastasParaLimpar!("p", { codigos: ["b".repeat(64)] })).toEqual([]);
      const linhas = saida.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("limpeza_pedido_falhou"));
      expect(linhas).toHaveLength(1);
      expect(JSON.parse(linhas[0]!)).toMatchObject({ nivel: "aviso", codigos: 1 });
      expect(linhas[0]).not.toContain("b".repeat(64));
    } finally {
      saida.mockRestore();
    }
  });
});

describe("ADR-099 (I5): a frente sem trabalho sai na hora pela resposta do entregar", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const turnoId = "00000000-0000-4000-8000-000000000003";
  const pasta = { trabalhoId: "00000000-0000-4000-8000-000000000009", pasta: "Dev 1/frente-abc123", quando: "sem_trabalho" } as const;
  const entregaDe = { turnoId, machineId: "m1", seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] } };
  const conectar = { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } };

  function montar(limparAgora?: PonteInternaNod["limparAgora"]) {
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar: async () => ({ turnoId } as PlanoTurno), renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null, ...(limparAgora ? { limparAgora } : {}) };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
    });
    return async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
  }

  it("servidor: a pasta da frente vai na resposta (pela pessoa da chave e pelo turno entregue); sem ela, ou com falha, só ok", async () => {
    const limparAgora = vi.fn<NonNullable<PonteInternaNod["limparAgora"]>>().mockResolvedValue(pasta);
    const chamar = montar(limparAgora);
    await chamar("conectar", conectar);
    await chamar("puxar");
    expect(await chamar("entregar", entregaDe)).toEqual({ status: 200, body: { ok: true, limparAgora: [pasta] } });
    expect(limparAgora).toHaveBeenCalledWith(escopo.pessoaId, turnoId);

    limparAgora.mockResolvedValueOnce(null);
    await chamar("puxar");
    expect(await chamar("entregar", { ...entregaDe, seqLocal: 2 })).toEqual({ status: 200, body: { ok: true } });

    limparAgora.mockRejectedValueOnce(new Error("banco fora"));
    await chamar("puxar");
    expect(await chamar("entregar", { ...entregaDe, seqLocal: 3 })).toEqual({ status: 200, body: { ok: true } });

    // Ponte sem o verbo: a entrega segue igual.
    const semVerbo = montar();
    await semVerbo("conectar", conectar);
    await semVerbo("puxar");
    expect(await semVerbo("entregar", entregaDe)).toEqual({ status: 200, body: { ok: true } });
  });

  it("app: só `sem_trabalho` no formato passa, fora da entrega; resposta sem o campo (servidor antigo) ou com lixo não chama nada", async () => {
    vi.useFakeTimers();
    try {
      const resposta = (corpo: unknown) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(corpo), { headers: { "x-nod-versao-minima": "0.1.0" } }));
      const entregar = (f: typeof fetch, aoLimparAgora: (p: unknown) => void) => criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f, aoLimparAgora }).ponte.entregar(entregaDe as Parameters<PonteInternaNod["entregar"]>[0]);
      const aoLimparAgora = vi.fn();
      await entregar(resposta({ ok: true, limparAgora: [pasta, { ...pasta, quando: "encerrada" }, { ...pasta, quando: "agora" }, { trabalhoId: 1, pasta: "a/b", quando: "sem_trabalho" }] }), aoLimparAgora);
      expect(aoLimparAgora).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(aoLimparAgora).toHaveBeenCalledWith([pasta]);

      const antigo = vi.fn();
      await entregar(resposta({ ok: true }), antigo);
      await entregar(resposta({ ok: true, limparAgora: "tudo" }), antigo);
      await entregar(resposta(null), antigo);
      await vi.runAllTimersAsync();
      expect(antigo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("app: a lista da passada normal aceita `sem_trabalho` e descarta valor desconhecido", async () => {
    const f = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ pastas: [pasta, { ...pasta, quando: "um_dia" }] }), { headers: { "x-nod-versao-minima": "0.1.0" } }));
    expect(await criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f }).ponte.pastasParaLimpar!("p")).toEqual([pasta]);
  });
});

describe("validação das contas anunciadas (ADR-102, revisão do PR #306)", () => {
  const AGORA_V = 1_760_000_000_000;
  const imp = "a".repeat(64);
  it("só impressão, IA e estado conhecidos; e-mail não passa; duplicata some; logadaEm ausente ou futuro vira 0 (não ressuscita conta removida)", () => {
    const r = contasAnunciadas([
      { impressao: imp, ia: "claude-cli", estado: "pronta", plano: "x@y.com", apelidoSugerido: "Pessoal", logadaEm: AGORA_V + 3_600_000 },
      { impressao: imp, ia: "claude-cli", estado: "pronta" },
      { impressao: "b".repeat(64), ia: "gemini", estado: "pronta" },
      { impressao: "c".repeat(64), ia: "codex-cli", estado: "sem_login", logadaEm: AGORA_V - 5 },
    ], AGORA_V)!;
    expect(r).toEqual([
      { impressao: imp, ia: "claude-cli", estado: "pronta", plano: null, corporativa: false, logadaEm: 0, apelidoSugerido: "Pessoal" },
      { impressao: "c".repeat(64), ia: "codex-cli", estado: "sem_login", plano: null, corporativa: false, logadaEm: AGORA_V - 5 },
    ]);
    expect(contasAnunciadas("lixo", AGORA_V)).toBeUndefined();
    expect(contasAnunciadas(Array.from({ length: 40 }, (_, i) => ({ impressao: i.toString(16).padStart(64, "0"), ia: "claude-cli", estado: "pronta" })), AGORA_V)).toHaveLength(CONTAS_ANUNCIADAS_MAX);
  });

  it("ADR-105: e-mail e organização passam pelos normalizadores da máquina; fora do formato, o campo some (a conta fica)", () => {
    const r = contasAnunciadas([
      { impressao: imp, ia: "claude-cli", estado: "pronta", email: "  pessoa1@exemplo.com ", organizacao: "Lumen\n  SA" },
      { impressao: "b".repeat(64), ia: "codex-cli", estado: "pronta", email: "sem arroba", organizacao: "x".repeat(81) },
      { impressao: "c".repeat(64), ia: "codex-cli", estado: "pronta", email: `${"a".repeat(250)}@y.com`, organizacao: 42 },
    ], AGORA_V)!;
    expect(r.map((c) => [c.email, c.organizacao])).toEqual([["pessoa1@exemplo.com", "Lumen SA"], [undefined, undefined], [undefined, undefined]]);
    expect(r[1]).not.toHaveProperty("email");
  });

  it("progresso do login e impressões: formato fechado", () => {
    const loginId = "11111111-1111-4111-8111-111111111111";
    expect(progressoDoLogin({ loginId, fase: "pronto", impressao: imp })).toEqual({ loginId, fase: "pronto", impressao: imp });
    expect(() => progressoDoLogin({ loginId, fase: "pronto", erro: "x".repeat(41) })).toThrow();
    expect(() => progressoDoLogin({ loginId: "nao-uuid", fase: "pronto" })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "cancelado" })).toThrow();
    expect(() => impressoes(["nao-hex"])).toThrow();
    expect(impressoes([imp])).toEqual([imp]);
  });

  it("NOD-8: `preparando` e o preparo do passo 1 passam; campo estranho, ação fora da lista ou versão fora do formato = 400", () => {
    const loginId = "11111111-1111-4111-8111-111111111111";
    const preparo = { acao: "atualizar", linha: "Baixando o Claude Code", antes: "2.1.280", depois: "2.1.304" };
    expect(progressoDoLogin({ loginId, fase: "preparando", preparo })).toEqual({ loginId, fase: "preparando", preparo });
    expect(progressoDoLogin({ loginId, fase: "abrindo", preparo: { acao: "instalar", depois: "0.159.0-alpha.2" } })).toEqual({ loginId, fase: "abrindo", preparo: { acao: "instalar", depois: "0.159.0-alpha.2" } });
    expect(progressoDoLogin({ loginId, fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar" } })).toMatchObject({ erro: "preparo_falhou", preparo: { acao: "instalar" } });
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "instalar", sudo: true } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "remover" } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "atualizar", antes: "<b>1</b>" } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "atualizar", linha: "a\nb" } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "atualizar", linha: "x".repeat(81) } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: "instalar" })).toThrow();
  });

  it("NOD-8 passo 9: o preparo traz a atualização do orquestrador (motivo e espaço da J4); fora do formato = 400", () => {
    const loginId = "11111111-1111-4111-8111-111111111111";
    const atualizacao = { fase: "falhou", alvo: "2.1.290", motivo: "sem_espaco", caminho: "npm_local", em: 1_000, espaco: { livreMb: 1_200, precisaMb: 2_048 } };
    expect(progressoDoLogin({ loginId, fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao } })).toEqual({ loginId, fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao } });
    expect(progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "atualizar", atualizacao: { fase: "atualizando", alvo: "2.1.290", antes: "2.1.280", em: 5, lixo: 1 } } }).preparo?.atualizacao).toEqual({ fase: "atualizando", alvo: "2.1.290", antes: "2.1.280", em: 5 });
    expect(progressoDoLogin({ loginId, fase: "falhou", erro: "preparo_falhou", preparo: { acao: "instalar", atualizacao: { fase: "falhou", alvo: "0.159.0", motivo: "sem_internet", em: 9 } } }).preparo?.atualizacao?.motivo).toBe("sem_internet");
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "instalar", atualizacao: { fase: "voando", alvo: "2.1.290", em: 1 } } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "instalar", atualizacao: { fase: "atualizando", alvo: "<b>", em: 1 } } })).toThrow();
    expect(() => progressoDoLogin({ loginId, fase: "preparando", preparo: { acao: "instalar", atualizacao: "falhou" } })).toThrow();
  });
});

describe("NOD-245: a adoção que falha por exceção e a entrega grande", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const TURNO = "00000000-0000-4000-8000-000000000003";
  const plano = { turnoId: TURNO } as PlanoTurno;
  const SINAIS_OK = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const resultado = (n: number) => ({ desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: null, sinais: SINAIS_OK, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: Array.from({ length: n }, (_, i) => `f${i}`), negacoesPermissao: [] });

  function montar(adotar: NonNullable<PonteInternaNod["adotar"]>, entregar: PonteInternaNod["entregar"] = async () => undefined) {
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar: async () => null, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null, adotar };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 50,
    });
    return async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP, "x-nod-token-turno": "tok" };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
  }
  const conectar = { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } };

  it("exceção em `adotar` → 503 adocao_indisponivel no renovar e no entregar (nunca 403 nem {ativo:false})", async () => {
    const adotar = vi.fn<NonNullable<PonteInternaNod["adotar"]>>().mockRejectedValue(new Error("banco fora"));
    const entregar = vi.fn<PonteInternaNod["entregar"]>().mockResolvedValue(undefined);
    const chamar = montar(adotar, entregar);
    await chamar("conectar", conectar);
    expect(await chamar("renovar", { turnoId: TURNO, sinais: SINAIS_OK, eventos: [] })).toEqual({ status: 503, body: { codigo: "adocao_indisponivel" } });
    expect(await chamar("entregar", { turnoId: TURNO, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado(0) })).toEqual({ status: 503, body: { codigo: "adocao_indisponivel" } });
    expect(adotar.mock.calls.map((c) => c[0].para)).toEqual(["rodar", "assentar"]);
    expect(entregar).not.toHaveBeenCalled();
  });

  it("entrega adotada com 2500 ferramentas → 200 e a ponte recebe as últimas 1000", async () => {
    const adotar = vi.fn<NonNullable<PonteInternaNod["adotar"]>>().mockResolvedValue({ tipo: "adotado", plano });
    const entregar = vi.fn<PonteInternaNod["entregar"]>().mockResolvedValue(undefined);
    const chamar = montar(adotar, entregar);
    await chamar("conectar", conectar);
    expect(await chamar("entregar", { turnoId: TURNO, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado(2500) })).toEqual({ status: 200, body: { ok: true } });
    const gravadas = entregar.mock.calls[0]![0].resultado.ferramentasChamadas;
    expect(gravadas).toHaveLength(1000);
    expect(gravadas[0]).toBe("f1500");
    expect(gravadas.at(-1)).toBe("f2499");
  });
});

/**
 * NOD-293 (N18, conferido em 2026-10-20): o Codex é separado por máquina. A ponte guarda as IAs de cada máquina viva da
 * pessoa em memória (`prontosPorMaquinaDaPessoa`, `harnesses`) e é isso que o despacho lê; `inventario_motores` é por
 * pessoa e por motor, só a vitrine (frota, "sua vez") — o `persistir` da ponte recebe um inventário só, o melhor da
 * pessoa, nunca o mapa por máquina.
 */
describe("NOD-293 (N18): as IAs prontas por máquina, não o inventário persistido, decidem o despacho", () => {
  const MAC = "0f0e0d0c-0000-4000-8000-0000000000a1";
  const VM = "0f0e0d0c-0000-4000-8000-0000000000b2";
  const pronto = { estado: "pronto" as const, versao: "fake", em: 0 };
  const semLogin = { estado: "nao_autenticado" as const, motivo: "entre", em: 0 };
  function montar() {
    const maquinas = new Map<string, AnuncioMaquina>();
    const persistidos: unknown[] = [];
    const ponte: PonteInternaNod = { conectar: async (m) => { maquinas.set(m.machineId, m); }, puxar: async () => null, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [...maquinas.values()], escopoDoTurno: () => null };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async (_e, inv) => { persistidos.push(inv); }, autorizar: async () => ({ ...MARLON, chaveId: MAC }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
    });
    const conectar = async (chaveId: string, corpo: unknown) => {
      const rota = p.rotas.find((r) => r.padrao.test("/conectar"));
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { chaveId }, corpo: async () => corpo, json: () => undefined });
    };
    return { p, conectar, persistidos };
  }
  const base = { versaoContrato: 1, inventario: pronto, ligacao: true };

  it("o Codex pronto no Mac e sem login na VM: o mapa separa as duas máquinas e o persistido é um inventário só, sem o Codex", async () => {
    const { p, conectar, persistidos } = montar();
    await conectar(MAC, { ...base, nome: "Mac", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    await conectar(VM, { ...base, nome: "vm-bots", harnesses: { "claude-cli": pronto, "codex-cli": semLogin } });
    expect(p.prontosPorMaquinaDaPessoa(MARLON.pessoaId)).toEqual({ [MAC]: ["claude-cli", "codex-cli"], [VM]: ["claude-cli"] });
    // O plano da VM sai das IAs DELA (compor.ts, planos.emitir: `ponteHttp.harnesses(escopo, machineId)`).
    expect(p.harnesses(MARLON, VM)["codex-cli"]?.estado).toBe("nao_autenticado");
    expect(p.harnesses(MARLON, MAC)["codex-cli"]?.estado).toBe("pronto");
    // Outra pessoa não vê as máquinas desta.
    expect(p.prontosPorMaquinaDaPessoa(ANA.pessoaId)).toEqual({});
    // A vitrine (inventario_motores, gravada pelo `persistir` como "claude-cli" em compor.ts) recebe UM inventário por vez.
    expect(persistidos.length).toBeGreaterThan(0);
    for (const inv of persistidos) expect(inv).toMatchObject({ estado: "pronto" });
    for (const inv of persistidos) expect(inv).not.toHaveProperty("codex-cli");
  });

  it("o bot fixado no Codex: a VM sem o Codex recusa nomeando-o mesmo com a vitrine dizendo pronto, sem ler inventario_motores; o Mac recebe o plano", async () => {
    const { p, conectar } = montar();
    await conectar(MAC, { ...base, nome: "Mac", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    await conectar(VM, { ...base, nome: "vm-bots", harnesses: { "claude-cli": pronto, "codex-cli": semLogin } });
    const { deps } = depsEmMemoria(MARLON);
    // A vitrine mente a favor: o Codex "pronto" para a pessoa.
    await deps.repos.inventario.registrar("codex-cli", pronto);
    await deps.repos.inventario.registrar("claude-cli", pronto);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Eng 1" });
    await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "fixa", fixa: "codex-cli" } });
    const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
    expect(agente.harness).toBe("codex-cli");
    const enfileirar = async () => (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: agente.id, origem: "conversa", prazoEm: Date.now() + 86_400_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local" }))!;
    // A entrada que ponte-interna.ts monta para a máquina que puxa: as IAs DELA, as da pessoa e o mapa por máquina.
    const doPuxar = (machineId: string) => ( { machineId, executor: "local" as const, inventario: pronto, harnessesProntos: p.prontosPorMaquinaDaPessoa(MARLON.pessoaId)[machineId], harnessesDaPessoa: p.harnessesDaPessoa(MARLON.pessoaId), prontosPorMaquina: p.prontosPorMaquinaDaPessoa(MARLON.pessoaId) });
    const buscar = vi.spyOn(deps.repos.inventario, "buscar");

    const naVm = await enfileirar();
    const r = await executar(deps, despacharTurno, doPuxar(VM));
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(r.data.turno?.id).toBe(naVm.id);
    expect(buscar).not.toHaveBeenCalled();

    const noMac = await enfileirar();
    const m = await executar(deps, despacharTurno, doPuxar(MAC));
    expect(m.data.plano?.turnoId).toBe(noMac.id);
    expect(m.data.plano?.machineId).toBe(MAC);
  });
});

describe("NOD-300: a máquina que perde ou recupera o contato avisa a presença, só na transição", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const turnoId = "00000000-0000-4000-8000-000000000003";
  const base = { versaoContrato: 1, nome: "VM-1", inventario: { estado: "pronto", versao: "fake", em: 0 } };
  function montar(puxar: PonteInternaNod["puxar"] = async () => null) {
    const relogio = { agora: 1_800_000_000_000 };
    const maquinas = new Map<string, AnuncioMaquina>();
    const avisos: string[] = [];
    const ponte: PonteInternaNod = {
      conectar: async (m) => { maquinas.set(m.machineId, m); }, puxar, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }),
      entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [...maquinas.values()], escopoDoTurno: () => null,
    };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => relogio.agora, delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
      inventarioMudou: (_e, motivo) => { if (motivo === "presenca") avisos.push(motivo); },
    });
    const chamar = async (nome: string, chaveId = "m1", corpo: unknown = base) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    return { p, chamar, relogio, avisos };
  }

  it("CA6: aos 61 s um aviso; a passada seguinte não repete; a volta pelo conectar avisa de novo", async () => {
    const { p, chamar, relogio, avisos } = montar();
    await chamar("conectar");
    expect(avisos).toHaveLength(1); // a primeira vista avisa (re-QA: depois de um reinício a tela pode mostrar "sem contato")
    await p.varrer();
    expect(avisos).toHaveLength(1);
    avisos.length = 0;
    relogio.agora += 61_000;
    await p.varrer();
    expect(avisos).toHaveLength(1);
    relogio.agora += 15_000;
    await p.varrer();
    expect(avisos).toHaveLength(1);
    await chamar("conectar");
    await p.varrer();
    expect(avisos).toHaveLength(2);
  });

  it("a conexão apagada aos 90 s que reconecta avisa a volta", async () => {
    const { p, chamar, relogio, avisos } = montar();
    await chamar("conectar");
    await p.varrer();
    avisos.length = 0;
    relogio.agora += 95_000;
    await p.varrer();
    await p.varrer();
    expect(avisos).toHaveLength(1);
    await chamar("conectar");
    await p.varrer();
    expect(avisos).toHaveLength(2);
  });

  it("a máquina no meio de um puxar (`puxando`) também avisa", async () => {
    let soltar: ((v: PlanoTurno | null) => void) | null = null;
    const { p, chamar, relogio, avisos } = montar(() => new Promise((r) => { soltar = r; }));
    await chamar("conectar");
    await p.varrer();
    avisos.length = 0;
    const puxada = chamar("puxar", "m1", {});
    await vi.waitFor(() => expect(soltar).not.toBeNull());
    relogio.agora += 61_000;
    await p.varrer();
    expect(avisos).toHaveLength(1);
    soltar!({ turnoId } as PlanoTurno);
    await puxada;
  });

  it("duas máquinas da mesma pessoa caindo na mesma passada dão um aviso só", async () => {
    const { p, chamar, relogio, avisos } = montar();
    await chamar("conectar", "m1");
    await chamar("conectar", "m2");
    await p.varrer();
    avisos.length = 0;
    relogio.agora += 61_000;
    await p.varrer();
    expect(avisos).toHaveLength(1);
  });

  it("o desconectar avisa a máquina que estava viva", async () => {
    const { p, chamar, avisos } = montar();
    await chamar("conectar");
    await p.varrer();
    avisos.length = 0;
    await chamar("desconectar", "m1", {});
    expect(avisos).toHaveLength(1);
    await p.varrer();
    expect(avisos).toHaveLength(1);
  });
  // Re-QA do NOD-300 (SHA ef74069b): a API reiniciou com a VM-1 sem contato; a VM-2 da mesma pessoa já reconectou pronta.
  // A volta da VM-1 não mudava a assinatura das IAs e a memória vazia não via transição: nenhum frame, tela parada.
  it("depois de um reinício, a volta da máquina sem contato avisa mesmo com outra máquina da pessoa pronta", async () => {
    const { p, chamar, avisos } = montar();
    await chamar("conectar", "m2");
    await p.varrer();
    avisos.length = 0;
    await chamar("conectar", "m1");
    expect(avisos).toEqual(["presenca"]);
    await p.varrer();
    await p.varrer();
    expect(avisos).toEqual(["presenca"]);
  });

  it("depois de um reinício, o reanúncio pelo conectar da máquina já vista viva não repete o aviso", async () => {
    const { p, chamar, avisos } = montar();
    await chamar("conectar", "m1");
    await chamar("conectar", "m1");
    await p.varrer();
    expect(avisos).toEqual(["presenca"]);
  });

  it("depois de um reinício, a máquina que reconecta e sai pelo desconectar avisa a saída", async () => {
    const { chamar, avisos } = montar();
    await chamar("conectar", "m1");
    await chamar("desconectar", "m1", {});
    expect(avisos).toEqual(["presenca", "presenca"]);
  });
});
