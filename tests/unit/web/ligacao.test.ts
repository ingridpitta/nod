import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Ligacao } from "../../../src/contracts/ligacao.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { DetectorDeFala, dePcm16, Ganho, paraPcm16, QUADROS_PARA_CALAR, Reamostrador } from "../../../web/lib/ligacao-audio.ts";
import { AMOSTRAS_POR_QUADRO, fechamentoDefinitivo, lerMsgServidor, lerQuadroVoz, quadroMicrofone, rotaPeloNome } from "../../../web/lib/ligacao-protocolo.ts";
import { duracaoRelogio } from "../../../web/lib/relogio.ts";
import { pararNoCampoDaTela, renderCabecalhoConversa, renderMensagem } from "../../../web/telas/conversa.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { avisoDoEstadoLocal, botaoLigar, comLegenda, htmlCardJanela, partesDaLigacao, renderAvaliacao, renderLinhaLigacao, renderTranscricao, textoFase, textoFim, type EstadoTelaLigacao } from "../../../web/telas/ligacao.ts";

/** Modo ligação na web (definido em 2026-10-04, ADR-071): protocolo, áudio, a tela e a linha "Chat de voz". */

describe("protocolo nod-voz/1 no renderer", () => {
  it("rota de saída pelo nome do aparelho (nomes do Chromium no Mac): fone antes de built-in", () => {
    expect(rotaPeloNome("Padrão - AirPods Pro (Bluetooth)")).toBe("fone");
    expect(rotaPeloNome("Default - External Headphones (Built-in)")).toBe("fone");
    expect(rotaPeloNome("Padrão - Fones de ouvido externos (Built-in)")).toBe("fone");
    expect(rotaPeloNome("Galaxy Buds2 Pro")).toBe("fone");
    expect(rotaPeloNome("WH-1000XM5")).toBe("fone");
    expect(rotaPeloNome("Padrão - Alto-falantes (MacBook Pro) (Built-in)")).toBe("alto-falante");
    expect(rotaPeloNome("Default - MacBook Air Speakers (Built-in)")).toBe("alto-falante");
    expect(rotaPeloNome("LG HDR 4K (DisplayPort)")).toBe("alto-falante");
    expect(rotaPeloNome("JBL Flip 6")).toBe("desconhecida");
    expect(rotaPeloNome("")).toBe("desconhecida");
  });

  it("quadro do microfone: tipo 0x01, sequência u32 LE e PCM16LE", () => {
    const pcm = new Int16Array([1, -2, 32767, -32768]);
    const buf = quadroMicrofone(258, pcm);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(5 + 8);
    expect(v.getUint8(0)).toBe(1);
    expect(v.getUint32(1, true)).toBe(258);
    expect(v.getInt16(5, true)).toBe(1);
    expect(v.getInt16(11, true)).toBe(-32768);
    expect(AMOSTRAS_POR_QUADRO).toBe(320);
  });

  it("quadro de voz: lê seq, utt e PCM; recusa tipo errado, tamanho ímpar e cabeçalho curto", () => {
    const buf = new ArrayBuffer(7 + 4);
    const v = new DataView(buf);
    v.setUint8(0, 2);
    v.setUint32(1, 9, true);
    v.setUint16(5, 3, true);
    v.setInt16(7, 100, true);
    v.setInt16(9, -100, true);
    expect(lerQuadroVoz(buf)).toEqual({ seq: 9, utt: 3, pcm: new Int16Array([100, -100]) });
    v.setUint8(0, 1);
    expect(lerQuadroVoz(buf)).toBeNull();
    expect(lerQuadroVoz(new ArrayBuffer(8))).toBeNull();
    expect(lerQuadroVoz(new ArrayBuffer(4))).toBeNull();
  });

  it("mensagens do servidor são conferidas campo a campo", () => {
    expect(lerMsgServidor('{"t":"estado","fase":"trabalhando","rotulo":"Lendo o Gmail"}')).toEqual({ t: "estado", fase: "trabalhando", rotulo: "Lendo o Gmail" });
    expect(lerMsgServidor('{"t":"comando","comandoId":"c1","decisaoId":"d1","acao":"aprovar"}')).toEqual({ t: "comando", comandoId: "c1", decisaoId: "d1", acao: "aprovar" });
    expect(lerMsgServidor('{"t":"bot-fala","utt":2,"tipo":"espera","texto":"Hum, deixa eu ver…"}')).toMatchObject({ tipo: "espera" });
    expect(lerMsgServidor('{"t":"fim","motivo":"pessoa_desligou"}')).toEqual({ t: "fim", motivo: "pessoa_desligou" });
    expect(lerMsgServidor('{"t":"estado","fase":"dançando"}')).toBeNull();
    expect(lerMsgServidor('{"t":"comando","comandoId":"c1","decisaoId":"d1","acao":"sempre"}')).toBeNull();
    expect(lerMsgServidor('{"t":"fim","motivo":"qualquer"}')).toBeNull();
    expect(lerMsgServidor('{"t":"legenda","id":"1","texto":"oi","final":true}')).toBeNull();
    expect(lerMsgServidor("não é json")).toBeNull();
  });

  it("fechamentos definitivos não reconectam; queda comum reconecta", () => {
    expect(fechamentoDefinitivo(4410)).toBe(true);
    expect(fechamentoDefinitivo(4401)).toBe(true);
    expect(fechamentoDefinitivo(4503)).toBe(true);
    expect(fechamentoDefinitivo(1006)).toBe(false);
    expect(fechamentoDefinitivo(1001)).toBe(false);
  });
});

describe("áudio da ligação", () => {
  it("reamostra 48 kHz → 16 kHz em blocos de 128 sem perder nem sobrar amostra", () => {
    const r = new Reamostrador(48_000, 16_000);
    let total = 0;
    for (let i = 0; i < 375; i++) total += r.processar(new Float32Array(128)).length;
    expect(total).toBe(16_000);
  });

  it("reamostra 24 kHz → 48 kHz dobrando as amostras", () => {
    const r = new Reamostrador(24_000, 48_000);
    expect(r.processar(new Float32Array(480)).length).toBe(960);
  });

  it("PCM16 vai e volta sem passar do limite", () => {
    const f = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
    const s = paraPcm16(f);
    expect(Array.from(s)).toEqual([0, 16384, -16384, 32767, -32768, 32767]);
    expect(dePcm16(s)[1]).toBeCloseTo(0.5, 3);
  });

  it("três quadros com energia disparam o começo uma vez; o limiar sobe com o bot falando; o silêncio fecha", () => {
    const d = new DetectorDeFala();
    expect([d.quadro(0.02, false), d.quadro(0.02, false), d.quadro(0.02, false), d.quadro(0.02, false)]).toEqual([null, null, "inicio", null]);
    const comBot = new DetectorDeFala();
    expect([comBot.quadro(0.02, true), comBot.quadro(0.02, true), comBot.quadro(0.02, true)]).toEqual([null, null, null]);
    const fim = Array.from({ length: QUADROS_PARA_CALAR }, () => d.quadro(0, false));
    expect(fim.at(-1)).toBe("fim");
    expect(fim.slice(0, -1).every((x) => x === null)).toBe(true);
  });

  it("o ganho chega a 30% no prazo pedido (≤50 ms a 48 kHz)", () => {
    const g = new Ganho();
    g.rumo(0.3, 40, 48_000);
    for (let i = 0; i < 48 * 40; i++) g.proximo();
    expect(g.atual).toBeCloseTo(0.3, 5);
    expect(g.chegou()).toBe(true);
  });
});

describe("cronômetro", () => {
  it("mm:ss e h:mm:ss", () => {
    expect(duracaoRelogio(0)).toBe("00:00");
    expect(duracaoRelogio(192_400)).toBe("03:12");
    expect(duracaoRelogio(3_725_000)).toBe("1:02:05");
    expect(duracaoRelogio(-500)).toBe("00:00");
  });
});

const ligacao = (extra: Partial<Ligacao> = {}): Ligacao => ({
  id: "l1", agenteId: "a", conversaId: "c1", estado: "em_curso", iniciadaPor: "pessoa", harness: "claude-cli", modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "bento",
  mensagemId: null, iniciadaEm: 1_000, atendidaEm: 2_000, encerradaEm: null, motivoFim: null, duracaoMs: null, religacoes: 0, trocas: 0, interrupcoes: 0, sttSegundos: 0, ttsCaracteres: 0,
  custoEstimadoUsd: null, latenciaP50Ms: null, latenciaP95Ms: null, avaliacao: null, transcricaoApagadaEm: null, resumida: false, ...extra,
});

const tela = (extra: Partial<EstadoTelaLigacao> = {}): EstadoTelaLigacao => ({
  ligacao: ligacao(), agente: { id: "a", nome: "Nina", cor: "c-blue", forma: "shape-square" }, modo: "cheia", fase: "ouvindo", rotulo: null, desde: 0, agora: 192_000,
  legendas: [], janela: null, mudo: false, teclado: false, voz: "bento", velocidade: 1, aviso: null, quemFala: null, audioSuspenso: false, sugestoes: [], ...extra,
});

describe("a tela da ligação", () => {
  it("tela cheia: diálogo modal, mascote xxl, nome, cronômetro, estado e os cinco controles", () => {
    const p = partesDaLigacao(tela(), null);
    expect(p.esqueleto).toContain('role="dialog"');
    expect(p.esqueleto).toContain('aria-modal="true"');
    expect(p.esqueleto).toContain('data-act="ligacao-encolher"');
    expect(p.mascote).toContain("xxl");
    expect(p.info).toContain("Nina");
    expect(p.info).toContain("03:12");
    expect(p.info).toContain("Ouvindo");
    for (const act of ["ligacao-mudo", "ligacao-teclado", "ligacao-ajustes", "ligacao-desligar"]) expect(p.controles).toContain(`data-act="${act}"`);
  });

  it("pílula: região (não modal), mascote pequeno, quem fala, Mudo, Expandir e Desligar", () => {
    const p = partesDaLigacao(tela({ modo: "pilula", quemFala: "bot" }), null);
    expect(p.esqueleto).toContain('role="region"');
    expect(p.esqueleto).not.toContain("aria-modal");
    expect(p.mascote).toContain(" sm");
    expect(p.info).toContain("03:12");
    expect(p.info).toContain("fala-bot");
    expect(p.info).toContain("Nina falando");
    for (const act of ["ligacao-mudo", "ligacao-expandir", "ligacao-desligar"]) expect(p.controles).toContain(`data-act="${act}"`);
    expect(p.controles).not.toContain("ligacao-teclado");
  });

  it("mudo aparece pressionado e o estado de trabalho leva o rótulo da ferramenta", () => {
    const p = partesDaLigacao(tela({ mudo: true, fase: "trabalhando", rotulo: "Lendo o Gmail" }), null);
    expect(p.controles).toContain('aria-pressed="true"');
    expect(p.info).toContain("Trabalhando · Lendo o Gmail");
    expect(textoFase("reconectando", null)).toBe("Reconectando…");
    expect(textoFase("chamando", null)).toBe("Chamando…");
  });

  it("legenda: a fala de espera vai em itálico apagado e a parcial da pessoa é trocada pela final", () => {
    let l = comLegenda([], { chave: "b:1", autor: "bot", texto: "Hum, deixa eu ver…", final: true, espera: true });
    l = comLegenda(l, { chave: "p:1", autor: "pessoa", texto: "manda o", final: false, espera: false });
    l = comLegenda(l, { chave: "p:1", autor: "pessoa", texto: "manda o relatório", final: true, espera: false });
    expect(l).toHaveLength(2);
    const html = partesDaLigacao(tela({ legendas: l }), null).legenda;
    expect(html).toContain('class="lc-fala lc-bot lc-espera"');
    expect(html).toContain("manda o relatório");
    expect(html).not.toContain("lc-parcial");
  });

  it("card da janela: frase, contagem e Aprovar/Recusar; pergunta sem botões", () => {
    const decisao = { id: "d1", tipo: "aprovacao", frase: "Enviar o e-mail para a Ana" } as never;
    const html = htmlCardJanela({ decisao, restanteS: 14 }, "Nina");
    expect(html).toContain("Enviar o e-mail para a Ana");
    expect(html).toContain("14s");
    expect(html).toContain('data-act="ligacao-aprovar"');
    expect(html).toContain('data-act="ligacao-recusar"');
    const pergunta = htmlCardJanela({ decisao: { id: "d2", tipo: "pergunta", frase: "Qual planilha?" } as never, restanteS: 5 }, "Nina");
    expect(pergunta).not.toContain("ligacao-aprovar");
  });

  it("erros com texto claro: microfone negado diz onde liberar, no app e no navegador", () => {
    expect(avisoDoEstadoLocal("microfone-negado", true)?.texto).toContain("Ajustes do Sistema › Privacidade › Microfone");
    expect(avisoDoEstadoLocal("microfone-negado", false)?.texto).toContain("navegador");
    expect(avisoDoEstadoLocal("voz-fora", true)?.tom).toBe("erro");
    expect(textoFim("cerebro_caiu", "Nina")).toContain("Mac");
    expect(textoFim("pessoa_desligou", "Nina")).toBeNull();
  });

  it("'Como foi a ligação?': 👍/👎 e, no 👎, os motivos", () => {
    const a = { ligacaoId: "l1", agenteNome: "Nina", duracaoMs: 192_000, motivoFim: null, passo: "nota" as const };
    expect(renderAvaliacao(a)).toContain("Como foi a ligação?");
    expect(renderAvaliacao(a)).toContain('data-nota="ruim"');
    const motivos = renderAvaliacao({ ...a, passo: "motivo" });
    for (const m of ["demorou", "nao_entendeu", "interrompeu", "voz", "outro"]) expect(motivos).toContain(`data-motivo="${m}"`);
  });
});

describe("o botão Ligar", () => {
  const agente = { id: "a", ownerId: "p" };
  const disponivel = { disponivel: true as const, consentimentoNecessario: false, versaoConsentimento: 1, provedor: "google" };

  it("só no bot da pessoa e só com a disponibilidade lida", () => {
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: disponivel, ligacao: null })).toBe("ligar");
    expect(botaoLigar({ agente: { id: "a", ownerId: "outra" }, pessoaId: "p", disponibilidade: disponivel, ligacao: null })).toBeNull();
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: undefined, ligacao: null })).toBeNull();
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: null, ligacao: null })).toBeNull();
  });

  it("recurso desligado ou sem permissão esconde; sem Mac ou no limite mostra (o clique explica)", () => {
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: { disponivel: false, motivo: "desligada", texto: "x" }, ligacao: null })).toBeNull();
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: { disponivel: false, motivo: "sem_permissao", texto: "x" }, ligacao: null })).toBeNull();
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: { disponivel: false, motivo: "sem_mac", texto: "Abra o nod no Mac" }, ligacao: null })).toBe("ligar");
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: { disponivel: false, motivo: "limite_diario", texto: "x" }, ligacao: null })).toBe("ligar");
  });

  it("com a ligação deste bot aberta aqui vira 'Em ligação'; aberta noutra janela ou com outro bot, some", () => {
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: disponivel, ligacao: { agenteId: "a", local: true } })).toBe("em-ligacao");
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: disponivel, ligacao: { agenteId: "a", local: false } })).toBeNull();
    expect(botaoLigar({ agente, pessoaId: "p", disponibilidade: disponivel, ligacao: { agenteId: "b", local: true } })).toBeNull();
  });
});

const C = "c1";
function cenario(): Estado {
  const conversa: ConversaDto = { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never, mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [] };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
  return { ...base, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C, cor: "c-blue", forma: "shape-square", ownerId: "p" }] } as never };
}
const linha = (estado: PayloadEstado, duracaoMs: number | null = 192_000): Mensagem => ({
  tenantId: "t", id: "m1", conversaId: C, turnoId: null, autoria: { autor_tipo: "agente", autor_id: "a" }, kind: "sistema", texto: "Chat de voz", payload: { kind: "ligacao", ligacaoId: "l1", duracaoMs, estado }, confianca: "confiavel", parcial: false, criadoEm: Date.UTC(2026, 9, 4, 14, 0),
} as Mensagem);
type PayloadEstado = "chamando" | "em_curso" | "encerrada" | "nao_atendida";

describe("a linha 'Chat de voz' na conversa", () => {
  it("encerrada: fone, duração e as duas ações da transcrição", () => {
    const html = renderMensagem(linha("encerrada"), cenario());
    expect(html).toContain("linha-ligacao");
    expect(html).toContain("Chat de voz · 03:12");
    expect(html).toContain('data-act="ver-transcricao"');
    expect(html).toContain('data-act="apagar-transcricao"');
    expect(html).toContain('data-id="l1"');
  });

  it("não atendida: só a linha, sem transcrição", () => {
    const html = renderLinhaLigacao({ criadoEm: 1 }, { kind: "ligacao", ligacaoId: "l1", duracaoMs: null, estado: "nao_atendida" }, false);
    expect(html).toContain("Ligação não atendida");
    expect(html).not.toContain("ver-transcricao");
  });

  it("em andamento: a desta página oferece voltar", () => {
    const e = { ...cenario(), ligacaoViva: { ligacaoId: "l1", agenteId: "a", conversaId: C, local: true } };
    expect(renderMensagem(linha("em_curso", null), e)).toContain('data-act="ligacao-expandir"');
    expect(renderMensagem(linha("em_curso", null), cenario())).not.toContain("ligacao-expandir");
  });

  it("transcrição: pessoa e bot alternados, a interrompida marcada; vazia diz por quê", () => {
    const html = renderTranscricao([
      { seq: 1, autor: "pessoa", tipo: "fala", texto: "Oi, Nina", inicioMs: 0, fimMs: 900, interrompida: false },
      { seq: 2, autor: "bot", tipo: "fala", texto: "Oi! Vou olhar", inicioMs: 1_000, fimMs: 2_000, interrompida: true },
    ], "Nina");
    expect(html).toContain("<b>Você</b>");
    expect(html).toContain("<b>Nina</b>");
    expect(html).toContain("interrompida");
    expect(renderTranscricao([], "Nina")).toContain("apagada");
  });
});

describe("cabeçalho e turnos da ligação", () => {
  // Plano "tela limpa" (2026-10-16, T2): o Ligar saiu do topo e é o primeiro atalho da gaveta do bot.
  it("a gaveta mostra Ligar com a disponibilidade lida e 'Em ligação' durante a ligação; o topo não tem mais o botão", () => {
    const e: Estado = { ...cenario(), tela: { tipo: "conversa", conversaId: C, agenteId: "a" }, disponibilidadeLigacao: { a: { disponivel: true as const, consentimentoNecessario: false, versaoConsentimento: 1, provedor: "google" } }, gaveta: { agenteId: "a", nivel: { tipo: "ajustes" } } };
    // ADR-125: Ligar é o primeiro dos Atalhos, no nível Ajustes.
    expect(renderDetalhes(e)).toContain('data-act="iniciar-ligacao"');
    expect(renderDetalhes(e)).toContain("Ligar para Nina");
    expect(renderCabecalhoConversa(e, "a")).not.toContain("iniciar-ligacao");
    const emLigacao: Estado = { ...e, ligacaoViva: { ligacaoId: "l1", agenteId: "a", conversaId: C, local: true } };
    const html = renderDetalhes(emLigacao);
    expect(html).toContain('data-act="ligacao-expandir"');
    expect(html).not.toContain("iniciar-ligacao");
    // A pílula do topo diz que ele está em ligação.
    expect(renderCabecalhoConversa(emLigacao, "a")).toContain("Em ligação");
  });

  it("o turno do cérebro da ligação não vira 'trabalhando', fila nem Parar", () => {
    const e = cenario();
    const frame = (dados: Record<string, unknown>) => ({ tipo: "frame" as const, agora: 5, frame: { streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado" as const, dados: { turnoId: "t1", conversaId: C, kind: "turno_despachado", ...dados } } });
    expect(reduzir(e, frame({ modo: "ligacao" })).turnosVivos).toEqual({});
    expect(reduzir(e, frame({ origem: "ligacao" })).turnosVivos).toEqual({});
    expect(Object.keys(reduzir(e, frame({})).turnosVivos)).toEqual(["t1"]);
    const naTela = (x: Estado): Estado => ({ ...x, tela: { tipo: "conversa" as const, conversaId: C, agenteId: "a" } });
    expect(pararNoCampoDaTela(naTela(reduzir(e, frame({ modo: "ligacao" }))))).toBe(false);
    expect(pararNoCampoDaTela(naTela(reduzir(e, frame({}))))).toBe(true);
  });

  it("o frame ligacao.mudou relê a conversa e a ligação viva", () => {
    const e = reduzir(cenario(), { tipo: "frame", agora: 5, frame: { streamId: "s", seq: 1, pessoaId: "p", tipo: "ligacao.mudou", dados: { conversaId: C } } });
    expect(e.invalidacoes).toEqual(expect.arrayContaining([`conversa:${C}`, "ligacao"]));
  });
});
