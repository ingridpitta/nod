import { describe, expect, it } from "vitest";
import { criarTrabalhosVivos, VALIDADE_LEITURA_MS } from "../../../src/adapters/fundo/trabalhos-vivos.ts";
import { FECHAR_OCIOSA_SOB_PRESSAO_MS, soltarPorMemoria } from "../../../src/domain/trabalho.ts";

const leitura = (nivel: "verde" | "amarela" | "vermelha", totalMb = 1000) => ({ nivel, totalMb, porTurno: [] });

describe("trabalhos vivos: memória do Mac (#194)", () => {
  it("o nível que a pessoa vê muda uma vez por transição; a primeira leitura (mesmo verde) avisa a tela", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    // Corrigido em 2026-10-09: a tela aberta antes da primeira leitura ficava em "O Mac ainda não mandou leitura".
    expect(v.registrarMemoria("p", "mac", leitura("verde")).mudou).toBe(true);
    expect(v.registrarMemoria("p", "mac", leitura("verde")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", leitura("amarela"))).toMatchObject({ mudou: true, nivel: "amarela", anterior: "verde" });
    expect(v.registrarMemoria("p", "mac", leitura("amarela")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", leitura("vermelha")).mudou).toBe(true);
    expect(v.memoria("p")).toEqual({ nivel: "vermelha", totalMb: 1000, processador: null, carga: null, uso: null, fila: null, disco: null, discoNivel: null, discoSuportado: false, discoAcabaEmMs: null });
    expect(v.memoria("outra")).toBeNull();
    agora += VALIDADE_LEITURA_MS + 1;
    expect(v.memoria("p")).toBeNull();
    // Depois de 2 min sem leitura, a próxima é a primeira de novo: avisa a tela.
    expect(v.registrarMemoria("p", "mac", leitura("vermelha")).mudou).toBe(true);
  });

  it("corrigido em 2026-10-09: duas pessoas no mesmo Mac (modo local) — as duas veem a leitura, nenhuma apaga a da outra", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("marlon", "mac", leitura("verde", 600));
    agora += 1_000;
    v.registrarMemoria("ana", "mac", leitura("verde", 600));
    // Antes, a leitura ficava com o dono de quem puxou por último, e a tela do Marlon dizia "sem leitura".
    expect(v.memoria("marlon")).toMatchObject({ nivel: "verde", totalMb: 600 });
    expect(v.memoria("ana")).toMatchObject({ nivel: "verde", totalMb: 600 });
    expect(v.memoria("outra")).toBeNull();
    // Quem parou de mandar por 2 min sai do Mac; quem continua, não.
    agora += VALIDADE_LEITURA_MS;
    v.registrarMemoria("ana", "mac", leitura("amarela", 600));
    expect(v.memoria("marlon")).toBeNull();
    expect(v.memoria("ana")).toMatchObject({ nivel: "amarela" });
    // E volta a ver quando volta a mandar (a primeira leitura dele de novo avisa a tela).
    expect(v.registrarMemoria("marlon", "mac", leitura("amarela", 600)).mudou).toBe(true);
    expect(v.memoria("marlon")).toMatchObject({ nivel: "amarela" });
  });

  it("revisão do #209: a mudança só do processador também vira frame (a pílula do Mac ocupado depende dele)", () => {
    const v = criarTrabalhosVivos(() => 0);
    const comCpu = (nivel: "verde" | "amarela" | "vermelha") => ({ ...leitura("verde"), processador: { nivel, carga: nivel === "verde" ? 0.2 : 1.4 } });
    expect(v.registrarMemoria("p", "mac", comCpu("verde")).mudou).toBe(true);
    expect(v.registrarMemoria("p", "mac", comCpu("verde")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", comCpu("vermelha"))).toMatchObject({ mudou: true, nivel: "verde", processador: "vermelha" });
    expect(v.registrarMemoria("p", "mac", comCpu("vermelha")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", comCpu("verde"))).toMatchObject({ mudou: true, processador: "verde" });
  });

  it("revisão do #209: desfazer devolve o 'visto' (o evento não foi gravado) e a próxima leitura refaz o frame", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.registrarMemoria("p", "mac", leitura("verde"));
    const m = v.registrarMemoria("p", "mac", leitura("amarela"));
    expect(m.mudou).toBe(true);
    v.desfazer("p", m);
    expect(v.registrarMemoria("p", "mac", leitura("amarela")).mudou).toBe(true);
    // Sem nada visto antes: o primeiro aviso também volta.
    const w = criarTrabalhosVivos(() => 0);
    const primeiro = w.registrarMemoria("q", "mac", leitura("vermelha"));
    w.desfazer("q", primeiro);
    expect(w.registrarMemoria("q", "mac", leitura("vermelha")).mudou).toBe(true);
  });

  it("revisão do #209: o Mac que desconectou sai na hora; leitura vencida sai do mapa na próxima leitura", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("p", "mac-a", leitura("vermelha"));
    v.esquecerMaquina("mac-a");
    expect(v.daMaquina("mac-a")).toBeNull();
    expect(v.memoria("p")).toBeNull();
    v.registrarMemoria("p", "mac-b", leitura("amarela"));
    agora += VALIDADE_LEITURA_MS + 1;
    v.registrarMemoria("p", "mac-c", leitura("verde"));
    agora -= VALIDADE_LEITURA_MS + 1; // mesmo voltando o relógio, o mac-b já foi podado
    expect(v.daMaquina("mac-b")).toBeNull();
  });

  it("dois Macs da mesma pessoa: vale o pior, e o total soma", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.registrarMemoria("p", "mac-a", leitura("verde", 400));
    expect(v.registrarMemoria("p", "mac-b", leitura("amarela", 600))).toMatchObject({ mudou: true, nivel: "amarela" });
    expect(v.registrarMemoria("p", "mac-a", leitura("verde", 400)).mudou).toBe(false);
    expect(v.memoria("p")).toEqual({ nivel: "amarela", totalMb: 1000, processador: null, carga: null, uso: null, fila: null, disco: null, discoNivel: null, discoSuportado: false, discoAcabaEmMs: null });
  });

  it("ADR-085: o processador de cada Mac — o pior para a pessoa, a leitura de um Mac para o puxar dele; leitura velha some", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("p", "mac-a", { ...leitura("verde", 400), processador: { nivel: "amarela", carga: 0.8 } });
    v.registrarMemoria("p", "mac-b", { ...leitura("verde", 300), processador: { nivel: "vermelha", carga: 1.6 } });
    v.registrarMemoria("p", "mac-c", leitura("verde", 100));
    expect(v.memoria("p")).toEqual({ nivel: "verde", totalMb: 800, processador: "vermelha", carga: 1.6, uso: null, fila: null, disco: null, discoNivel: null, discoSuportado: false, discoAcabaEmMs: null });
    expect(v.daMaquina("mac-a")).toEqual({ memoria: "verde", processador: "amarela", uso: null, carga: 0.8, disco: null, discoNivel: null });
    expect(v.daMaquina("mac-c")).toEqual({ memoria: "verde", processador: null, uso: null, carga: null, disco: null, discoNivel: null });
    expect(v.daMaquina("mac-x")).toBeNull();
    agora = VALIDADE_LEITURA_MS + 1;
    expect(v.daMaquina("mac-a")).toBeNull();
  });

  it("#219: o disco de cada Mac vai no daMaquina; a pessoa vê o pior (o de menos espaço livre); mudar de nível vira frame", () => {
    const v = criarTrabalhosVivos(() => 0);
    const comDisco = (livreGb: number, totalGb = 500) => ({ ...leitura("verde"), disco: { livreMb: livreGb * 1024, totalMb: totalGb * 1024 } });
    expect(v.registrarMemoria("p", "mac-a", comDisco(200)).mudou).toBe(true);
    expect(v.daMaquina("mac-a")).toEqual({ memoria: "verde", processador: null, uso: null, carga: null, disco: { livreMb: 200 * 1024, totalMb: 500 * 1024 }, discoNivel: "verde" });
    expect(v.registrarMemoria("p", "mac-b", comDisco(8, 1000))).toMatchObject({ mudou: true, disco: "amarela" });
    expect(v.memoria("p")?.disco).toEqual({ livreMb: 8 * 1024, totalMb: 1000 * 1024 });
    expect(v.registrarMemoria("p", "mac-a", comDisco(190))).toMatchObject({ mudou: false, disco: "amarela" });
    expect(v.registrarMemoria("p", "mac-b", comDisco(2, 1000))).toMatchObject({ mudou: true, disco: "vermelha" });
    expect(v.registrarMemoria("p", "mac-b", comDisco(300, 1000))).toMatchObject({ mudou: true, disco: "verde" });
    // Os dois folgados: o de menos espaço livre (os limites são absolutos).
    expect(v.memoria("p")?.disco).toEqual({ livreMb: 190 * 1024, totalMb: 500 * 1024 });
    expect(v.memoria("p")).toMatchObject({ discoNivel: "verde", discoSuportado: true });
    // Mac sem disco (app anterior) não apaga o dos outros nem segura nada.
    v.registrarMemoria("p", "mac-c", leitura("verde"));
    expect(v.daMaquina("mac-c")?.disco).toBeNull();
    expect(v.memoria("p")?.disco).toEqual({ livreMb: 190 * 1024, totalMb: 500 * 1024 });
  });

  it("revisão do #224: histerese por Mac — perto do limite o nível não pisca, e o frame sai uma vez", () => {
    const v = criarTrabalhosVivos(() => 0);
    const comDisco = (livreGb: number) => ({ ...leitura("verde"), disco: { livreMb: livreGb * 1024, totalMb: 500 * 1024 } });
    expect(v.registrarMemoria("p", "mac", comDisco(2.9))).toMatchObject({ mudou: true, disco: "vermelha" });
    expect(v.registrarMemoria("p", "mac", comDisco(3.2))).toMatchObject({ mudou: false, disco: "vermelha" });
    expect(v.daMaquina("mac")?.discoNivel).toBe("vermelha");
    expect(v.registrarMemoria("p", "mac", comDisco(3.6))).toMatchObject({ mudou: true, disco: "amarela" });
    expect(v.registrarMemoria("p", "mac", comDisco(10.8))).toMatchObject({ mudou: false, disco: "amarela" });
    expect(v.registrarMemoria("p", "mac", comDisco(11.2))).toMatchObject({ mudou: true, disco: "verde" });
    expect(v.registrarMemoria("p", "mac", comDisco(10.8))).toMatchObject({ mudou: false, disco: "verde" });
    // O app novo que não conseguiu medir (null) conta como suportado: a tela diz "sem leitura", não "atualize o app".
    const w = criarTrabalhosVivos(() => 0);
    w.registrarMemoria("q", "mac", { ...leitura("verde"), disco: null });
    expect(w.memoria("q")).toMatchObject({ disco: null, discoNivel: null, discoSuportado: true });
  });

  it("ADR-091: com o uso, o servidor recalcula — CPU com histerese, fila à parte, o portão pelo pior dos dois", () => {
    const v = criarTrabalhosVivos(() => 0);
    // O app manda o nível (o pior, para um servidor anterior); este recalcula dos números crus.
    const comCpu = (uso: number, carga: number) => ({ ...leitura("verde"), processador: { nivel: "verde" as const, carga, uso } });
    v.registrarMemoria("p", "mac", comCpu(0.92, 0.9));
    expect(v.memoria("p")).toMatchObject({ processador: "vermelha", fila: "verde", uso: 0.92, carga: 0.9 });
    // 87% não sai do vermelho (histerese de 5 pontos); 84% sai para o amarelo.
    expect(v.registrarMemoria("p", "mac", comCpu(0.87, 0.9)).mudou).toBe(false);
    expect(v.memoria("p")?.processador).toBe("vermelha");
    expect(v.registrarMemoria("p", "mac", comCpu(0.84, 0.9))).toMatchObject({ mudou: true, processador: "amarela" });
    // O caso de 09/10: núcleos a 75% e 3,0 por núcleo — processador apertando, fila engarrafada; o portão vê vermelho.
    expect(v.registrarMemoria("p", "mac", comCpu(0.75, 3))).toMatchObject({ mudou: true, processador: "amarela", fila: "vermelha" });
    expect(v.daMaquina("mac")).toMatchObject({ processador: "vermelha", uso: 0.75, carga: 3 });
    // A fila só mudando de nível também vira frame.
    expect(v.registrarMemoria("p", "mac", comCpu(0.75, 1))).toMatchObject({ mudou: true, fila: "verde" });
    expect(v.daMaquina("mac")?.processador).toBe("amarela");
  });

  it("a última ferramenta do turno vivo (o último passo da faixa) some quando o turno acaba", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.ferramenta("t1", "Rodou um comando");
    v.ferramenta("t1", "Leu um arquivo");
    expect(v.ultimaFerramenta("t1")).toBe("Leu um arquivo");
    v.esquecerTurno("t1");
    expect(v.ultimaFerramenta("t1")).toBeNull();
  });

  it("NOD-350: o resumo dos subagentes que trabalham fica por turno; null o apaga, e some quando o turno acaba", () => {
    const v = criarTrabalhosVivos(() => 0);
    expect(v.resumoSubagentes("t1")).toBeNull();
    v.subagentes("t1", "2 subagentes trabalhando");
    v.subagentes("t2", "1 comando rodando");
    v.ferramenta("t1", "Leu um arquivo");
    expect(v.resumoSubagentes("t1")).toBe("2 subagentes trabalhando");
    v.subagentes("t1", null);
    expect(v.resumoSubagentes("t1")).toBeNull();
    // A ferramenta não some junto: o "fez ferramenta" do turno depende dela.
    expect(v.ultimaFerramenta("t1")).toBe("Leu um arquivo");
    v.esquecerTurno("t2");
    expect(v.resumoSubagentes("t2")).toBeNull();
  });

  it("NOD-350 (QA): com todos de volta a linha fica até o bot usar outra ferramenta; enquanto trabalham, a ferramenta não a tira", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.ferramenta("t1", "Chamou um subagente");
    v.subagentes("t1", "Os 2 subagentes voltaram · 1 não terminou", false);
    expect(v.resumoSubagentes("t1")).toBe("Os 2 subagentes voltaram · 1 não terminou");
    v.ferramenta("t1", "Leu um arquivo");
    expect(v.resumoSubagentes("t1")).toBeNull();
    v.subagentes("t1", "1 subagente trabalhando", true);
    v.ferramenta("t1", "Editou um arquivo");
    expect(v.resumoSubagentes("t1")).toBe("1 subagente trabalhando");
  });

  it("soltar a espera por memória: só sob amarela ou vermelha, e só passados 5 min", () => {
    const desde = 0;
    expect(soltarPorMemoria({ nivel: "amarela", esperandoDesde: desde, agora: FECHAR_OCIOSA_SOB_PRESSAO_MS + 1 })).toBe(true);
    expect(soltarPorMemoria({ nivel: "vermelha", esperandoDesde: desde, agora: FECHAR_OCIOSA_SOB_PRESSAO_MS + 1 })).toBe(true);
    expect(soltarPorMemoria({ nivel: "amarela", esperandoDesde: desde, agora: FECHAR_OCIOSA_SOB_PRESSAO_MS })).toBe(false);
    expect(soltarPorMemoria({ nivel: "verde", esperandoDesde: desde, agora: 10 * FECHAR_OCIOSA_SOB_PRESSAO_MS })).toBe(false);
    expect(soltarPorMemoria({ nivel: null, esperandoDesde: desde, agora: 10 * FECHAR_OCIOSA_SOB_PRESSAO_MS })).toBe(false);
  });
});
