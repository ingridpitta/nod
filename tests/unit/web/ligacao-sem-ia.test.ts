import { describe, expect, it } from "vitest";
import type { Ligacao } from "../../../src/contracts/ligacao.ts";
import { lerMsgServidor } from "../../../web/lib/ligacao-protocolo.ts";
import { partesDaLigacao, textoFase, textoFim, type EstadoTelaLigacao } from "../../../web/telas/ligacao.ts";
import { htmlIaVoltou, htmlSemIa, iasQuePodemAssumir, motivoSemIa, notaNoTerminal, type EstadoSemIa } from "../../../web/telas/ligacao-sem-ia.ts";

/**
 * A rede de segurança da ligação na tela (definido em 2026-10-05; protótipos 2A, 2B e 2C): as frases, o desenho do
 * aviso e a leitura das mensagens novas da mídia.
 */
const NINA = { nome: "Nina", genero: "feminina" } as const;
const semIa = (extra: Partial<EstadoSemIa> = {}): EstadoSemIa => ({
  causa: "conta_sem_acesso", ia: "claude-cli", ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }], ate: 0,
  entrando: null, nota: null, ocupado: false, ponte: { entrar: true, instalar: true }, onboarding: true, ...extra,
});
const acts = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1] ?? "");
const botoes = (html: string): { act: string; ia: string | null; texto: string }[] =>
  [...html.matchAll(/<button[^>]*data-act="([^"]+)"([^>]*)>(.*?)<\/button>/gs)].map((m) => ({ act: m[1] ?? "", ia: /data-ia="([^"]+)"/.exec(m[2] ?? "")?.[1] ?? null, texto: (m[3] ?? "").replace(/<svg.*?<\/svg>/gs, "").replace(/<[^>]+>/g, "").trim() }));

describe("o motivo, com o que se sabe", () => {
  it("conta sem acesso: nomeia o programa do Mac (Claude Code ou Codex)", () => {
    expect(motivoSemIa("conta_sem_acesso", "claude-cli")).toBe("A conta do Claude Code deste Mac está sem acesso: a organização dela desativou o uso por assinatura.");
    expect(motivoSemIa("conta_sem_acesso", "codex-cli")).toBe("A conta do Codex deste Mac está sem acesso: a organização dela desativou o uso por assinatura.");
  });

  it("qualquer outra falha (ou sem saber qual IA): o texto genérico, sem palpite", () => {
    expect(motivoSemIa("falhou", "claude-cli")).toBe("A IA deste Mac parou de responder.");
    expect(motivoSemIa("falhou", null)).toBe("A IA deste Mac parou de responder.");
    expect(motivoSemIa("conta_sem_acesso", null)).toBe("A IA deste Mac parou de responder.");
  });

  it("NOD-168: limite da assinatura é dito como é (nomeia o programa quando se sabe qual)", () => {
    expect(motivoSemIa("limite", "claude-cli")).toBe("A assinatura do Claude Code deste Mac chegou ao limite.");
    expect(motivoSemIa("limite", null)).toBe("A assinatura de IA deste Mac chegou ao limite.");
  });
});

describe("2A · há outra IA pronta no Mac", () => {
  it("título, motivo, 'pode assumir agora' e os três botões do protótipo, com o logo no principal", () => {
    const html = htmlSemIa(semIa(), NINA);
    expect(html).toContain('role="alert"');
    expect(html).toContain("tom-alerta");
    expect(html).toContain("<b>A Nina não conseguiu responder</b>");
    expect(html).toContain("A conta do Claude Code deste Mac está sem acesso: a organização dela desativou o uso por assinatura. O ChatGPT está pronto neste Mac e pode assumir agora.");
    expect(botoes(html)).toEqual([
      { act: "ligacao-continuar-ia", ia: "codex-cli", texto: "Continuar com o ChatGPT" },
      { act: "ligacao-ia-entrar", ia: "claude-cli", texto: "Entrar com outra conta do Claude" },
      { act: "ligacao-sem-voz", ia: null, texto: "Configurar sem voz" },
    ]);
    // O principal leva o logo da IA que assume (o mesmo dos cards do onboarding).
    expect(html).toMatch(/class="bt pri sm lsi-continuar"[^>]*><span class="lsi-logo" aria-hidden="true"><svg/);
  });

  it("numa ligação comum, a terceira saída é Desligar (o botão que já existe)", () => {
    const b = botoes(htmlSemIa(semIa({ onboarding: false }), NINA));
    expect(b.at(-1)).toEqual({ act: "ligacao-desligar", ia: null, texto: "Desligar" });
    expect(b.map((x) => x.act)).not.toContain("ligacao-sem-voz");
  });

  it("caiu o Codex e o Claude está pronto: os nomes trocam; bot com voz masculina leva 'O'", () => {
    const html = htmlSemIa(semIa({ ia: "codex-cli" }), { nome: "Bento", genero: "masculina" });
    expect(html).toContain("<b>O Bento não conseguiu responder</b>");
    expect(html).toContain("A conta do Codex deste Mac está sem acesso");
    expect(html).toContain("O Claude está pronto neste Mac e pode assumir agora.");
    expect(botoes(html).slice(0, 2)).toEqual([
      { act: "ligacao-continuar-ia", ia: "claude-cli", texto: "Continuar com o Claude" },
      { act: "ligacao-ia-entrar", ia: "codex-cli", texto: "Entrar com outra conta do ChatGPT" },
    ]);
  });

  it("falha sem causa conhecida: no lugar de trocar de conta, tentar de novo com a mesma IA", () => {
    const html = htmlSemIa(semIa({ causa: "falhou" }), NINA);
    expect(html).toContain("A IA deste Mac parou de responder. O ChatGPT está pronto neste Mac e pode assumir agora.");
    expect(botoes(html).slice(0, 2)).toEqual([
      { act: "ligacao-continuar-ia", ia: "codex-cli", texto: "Continuar com o ChatGPT" },
      { act: "ligacao-continuar-ia", ia: "claude-cli", texto: "Tentar de novo com o Claude" },
    ]);
  });

  it("depois de abrir o login pelo app, 'Entrar com outra conta' vira 'Tentar de novo', e a nota diz o que houve", () => {
    const html = htmlSemIa(semIa({ entrando: "claude-cli", nota: "Abrimos o navegador. Entre no Claude e volte aqui para tentar de novo." }), NINA);
    expect(botoes(html)[1]).toEqual({ act: "ligacao-continuar-ia", ia: "claude-cli", texto: "Tentar de novo com o Claude" });
    expect(html).toContain('<p class="lsi-nota" role="status">Abrimos o navegador. Entre no Claude e volte aqui para tentar de novo.</p>');
  });

  it("fora do app (sem a ponte): o botão de entrar não aparece e o texto diz o que fazer no Terminal", () => {
    const html = htmlSemIa(semIa({ ponte: { entrar: false, instalar: false } }), NINA);
    expect(acts(html)).not.toContain("ligacao-ia-entrar");
    expect(html).toContain("No Terminal deste Mac, rode “claude auth login” e entre na conta. Depois, tente de novo com o Claude.");
    // Sem o botão de entrar, o caminho de volta para a mesma IA é tentar de novo.
    expect(botoes(html)[1]).toEqual({ act: "ligacao-continuar-ia", ia: "claude-cli", texto: "Tentar de novo com o Claude" });
  });

  it("com um clique em curso, os botões que agem ficam desabilitados (o Desligar, nunca)", () => {
    const html = htmlSemIa(semIa({ ocupado: true, onboarding: false }), NINA);
    expect(html.match(/data-act="ligacao-continuar-ia"[^>]*disabled/g)).toHaveLength(1);
    expect(html).toMatch(/data-act="ligacao-ia-entrar"[^>]*disabled/);
    expect(html).not.toMatch(/data-act="ligacao-desligar"[^>]*disabled/);
  });

  it("sem saber qual IA caiu: oferece as que estão prontas, sem inventar de quem é a culpa", () => {
    const html = htmlSemIa(semIa({ causa: "falhou", ia: null }), NINA);
    expect(html).toContain("A IA deste Mac parou de responder. Há outra IA pronta neste Mac, que pode assumir agora.");
    expect(botoes(html).map((b) => b.texto)).toEqual(["Continuar com o Claude", "Continuar com o ChatGPT", "Configurar sem voz"]);
    expect(iasQuePodemAssumir({ ia: null, ias: [{ id: "codex-cli", estado: "pronto" }] })).toEqual(["codex-cli"]);
  });

  it("o nome do bot é escapado", () => {
    expect(htmlSemIa(semIa(), { nome: "<img src=x>", genero: "feminina" })).toContain("A &lt;img src=x&gt; não conseguiu responder");
  });
});

describe("2C · nenhuma outra IA pronta no Mac", () => {
  const semOutra = (extra: Partial<EstadoSemIa> = {}) => semIa({ ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "ausente" }], ...extra });

  it("o motivo, um card por IA (entrar com outra conta; instalar e entrar) e 'Configurar sem voz'", () => {
    const html = htmlSemIa(semOutra(), NINA);
    expect(html).toContain("A conta do Claude Code deste Mac está sem acesso: a organização dela desativou o uso por assinatura. Não há outra IA pronta neste Mac.");
    expect(html.match(/class="lsi-card"/g)).toHaveLength(2);
    expect(html).toContain("Entre com uma conta que tenha acesso, ou peça ao administrador da organização para liberar o Claude Code.");
    expect(html).toContain("O Codex não está neste Mac.");
    expect(botoes(html)).toEqual([
      { act: "ligacao-ia-entrar", ia: "claude-cli", texto: "Entrar com outra conta" },
      { act: "ligacao-ia-instalar", ia: "codex-cli", texto: "Instalar e entrar" },
      { act: "ligacao-sem-voz", ia: null, texto: "Configurar sem voz" },
    ]);
    expect(html).toContain("A ligação espera enquanto você resolve.");
    expect(acts(html)).not.toContain("ligacao-continuar-ia");
  });

  it("a outra IA instalada e sem login: o card pede só para entrar", () => {
    const html = htmlSemIa(semOutra({ ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "nao_autenticado" }] }), NINA);
    expect(html).toContain("O Codex está neste Mac; falta entrar na conta.");
    expect(botoes(html)[1]).toEqual({ act: "ligacao-ia-entrar", ia: "codex-cli", texto: "Entrar" });
  });

  it("fora do app: os cards dizem o que fazer no Terminal, e a IA que caiu ganha 'Tentar de novo'", () => {
    const html = htmlSemIa(semOutra({ ponte: { entrar: false, instalar: false }, onboarding: false }), NINA);
    expect(html).toContain(notaNoTerminal("codex-cli", "instalar"));
    expect(html).toContain("rode “codex login”");
    // A que caiu por conta sem acesso: trocar de conta é no Terminal, e depois tentar de novo.
    expect(html).toContain(notaNoTerminal("claude-cli", "entrar"));
    // O texto do card não repete o que a nota do Terminal já diz.
    expect(html.match(/a ligação percebe quando ficar pronto/gi)).toHaveLength(1);
    expect(botoes(html)).toEqual([
      { act: "ligacao-continuar-ia", ia: "claude-cli", texto: "Tentar de novo" },
      { act: "ligacao-desligar", ia: null, texto: "Desligar" },
    ]);
  });

  it("NOD-178: a outra IA só demorou para responder: nem 'Instalar' nem 'não está neste Mac', e nenhum botão", () => {
    for (const estado of ["ausente", "nao_autenticado"] as const) {
      for (const ponte of [{ entrar: true, instalar: true }, { entrar: false, instalar: false }]) {
        const html = htmlSemIa(semOutra({ ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado, causa: "sonda_lenta" }], ponte }), NINA);
        expect(html).toContain("O Codex demorou para responder; o Mac está carregado. A ligação percebe quando ficar pronto.");
        expect(html).not.toMatch(/Instal|não está neste Mac|falta entrar/);
        expect(botoes(html).map((b) => b.ia)).not.toContain("codex-cli");
      }
    }
  });

  it("NOD-171 (QA): a outra IA está desatualizada: a versão, a mínima e o comando; nem 'Instalar' nem 'não está neste Mac'", () => {
    const antigo = { id: "codex-cli", estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0" } as const;
    for (const ponte of [{ entrar: true, instalar: true }, { entrar: false, instalar: false }]) {
      const html = htmlSemIa(semOutra({ ias: [{ id: "claude-cli", estado: "pronto" }, antigo], ponte }), NINA);
      expect(html).toContain("O Codex deste Mac está na versão 0.147.0; o nod precisa da 0.159 ou mais nova. A ligação percebe quando ficar pronto.");
      expect(html).toContain("No Terminal deste Mac, rode “npm install -g @openai/codex@latest”.");
      expect(html).not.toMatch(/Instal|não está neste Mac|não foi encontrado/);
      expect(botoes(html).map((b) => b.ia)).not.toContain("codex-cli");
    }
  });

  it("uma IA que o servidor não listou (não atende ligação neste nod) não ganha card", () => {
    const html = htmlSemIa(semOutra({ ias: [{ id: "claude-cli", estado: "pronto" }] }), NINA);
    expect(html.match(/class="lsi-card"/g)).toHaveLength(1);
    expect(html).not.toContain("Codex");
    expect(botoes(html).map((b) => b.act)).toEqual(["ligacao-ia-entrar", "ligacao-sem-voz"]);
  });

  it("quando a outra IA fica pronta (o servidor reenvia o aviso), a tela passa ao 2A", () => {
    const html = htmlSemIa(semOutra({ ias: [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "pronto" }] }), NINA);
    expect(botoes(html)[0]).toEqual({ act: "ligacao-continuar-ia", ia: "codex-cli", texto: "Continuar com o ChatGPT" });
    expect(html).not.toContain("lsi-card");
  });
});

describe("2B · depois de escolher", () => {
  it("outra IA assumiu: aviso neutro com o logo dela, sem prometer mais que esta ligação", () => {
    const html = htmlIaVoltou({ ia: "codex-cli", trocou: true }, NINA);
    expect(html).toContain('role="status"');
    expect(html).toContain("tom-info");
    expect(html).toContain("A Nina agora usa o ChatGPT neste Mac. Vale para esta ligação.");
    expect(html).toContain('class="lsi-logo"');
    expect(html).not.toContain("data-act");
  });

  it("a mesma IA voltou (outra conta, ou tentar de novo): diz que voltou, não que trocou", () => {
    expect(htmlIaVoltou({ ia: "claude-cli", trocou: false }, NINA)).toContain("A Nina voltou a responder pelo Claude.");
    expect(htmlIaVoltou({ ia: null, trocou: false }, { nome: "Bento", genero: "masculina" })).toContain("O Bento voltou a responder.");
  });
});

describe("na tela da ligação", () => {
  const ligacao = { id: "l1", agenteId: "a", conversaId: "c1", estado: "em_curso", iniciadaPor: "produto", voz: "clara" } as Ligacao;
  const tela = (extra: Partial<EstadoTelaLigacao> = {}): EstadoTelaLigacao => ({
    ligacao, agente: { id: "a", nome: "Nina", cor: "c-blue", forma: "shape-square" }, modo: "cheia", fase: "aguardando_escolha", rotulo: null, desde: 0, agora: 12_000,
    legendas: [], janela: null, mudo: false, teclado: true, voz: "clara", velocidade: 1, aviso: { tom: "info", texto: "um aviso antigo" }, quemFala: null, audioSuspenso: false, sugestoes: ["Me chama de Ana"], ...extra,
  });

  it("o estado sob o nome vira 'Esperando você escolher'", () => {
    expect(textoFase("aguardando_escolha", null)).toBe("Esperando você escolher");
    expect(partesDaLigacao(tela({ semIa: semIa() }), null).info).toContain("Esperando você escolher");
  });

  it("esperando a escolha, só o aviso da rede de segurança aparece; teclado e chips somem (não haveria resposta)", () => {
    const p = partesDaLigacao(tela({ semIa: semIa() }), null);
    expect(p.aviso).toContain("A Nina não conseguiu responder");
    expect(p.aviso).not.toContain("um aviso antigo");
    expect(p.teclado).toBe("");
    expect(p.legenda).not.toContain("Diga algo como");
    // Na pílula o mesmo aviso vai embaixo dela.
    expect(partesDaLigacao(tela({ modo: "pilula", semIa: semIa() }), null).aviso).toContain("Continuar com o ChatGPT");
  });

  it("depois da escolha, o aviso neutro fica junto dos outros avisos e a ligação volta ao normal", () => {
    const p = partesDaLigacao(tela({ fase: "ouvindo", semIa: null, iaVoltou: { ia: "codex-cli", trocou: true } }), null);
    expect(p.aviso).toContain("A Nina agora usa o ChatGPT neste Mac.");
    expect(p.aviso).toContain("um aviso antigo");
    expect(p.teclado).toContain("ligacao-texto");
    expect(p.legenda).toContain("Diga algo como");
    expect(p.info).toContain("Ouvindo");
  });

  it("o fim sem escolha diz por quê", () => {
    expect(textoFim("sem_ia", "Nina")).toBe("A ligação foi encerrada: a IA deste Mac parou de responder e nenhuma saída foi escolhida em 2 minutos.");
  });
});

describe("as mensagens novas da mídia, conferidas campo a campo", () => {
  const ias = [{ id: "claude-cli", estado: "pronto" }, { id: "codex-cli", estado: "ausente" }];

  it("`sem-ia`: causa, IA (ou null), estado das IAs e o prazo", () => {
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "conta_sem_acesso", ia: "claude-cli", ias, ate: 123 }))).toEqual({ t: "sem-ia", causa: "conta_sem_acesso", ia: "claude-cli", ias, ate: 123 });
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: [], ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: [], ate: 1 });
    // Campos a mais (um texto do fornecedor, por exemplo) nunca passam.
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: [], ate: 1, erro: "Your organization has disabled…" }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: [], ate: 1 });
    // NOD-178: a causa de lentidão passa; qualquer outra causa na linha da IA é descartada.
    const lenta = [{ id: "codex-cli", estado: "ausente", causa: "sonda_lenta" }];
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: lenta, ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: lenta, ate: 1 });
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: [{ id: "codex-cli", estado: "ausente", causa: "binario_nao_encontrado" }], ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: [{ id: "codex-cli", estado: "ausente" }], ate: 1 });
    // NOD-171: o CLI desatualizado passa com as duas versões; versão fora do formato derruba só a causa.
    const antiga = [{ id: "codex-cli", estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0" }];
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: antiga, ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: antiga, ate: 1 });
    expect(lerMsgServidor(JSON.stringify({ t: "sem-ia", causa: "falhou", ia: null, ias: [{ ...antiga[0], versao: "<b>x</b>" }], ate: 1 }))).toEqual({ t: "sem-ia", causa: "falhou", ia: null, ias: [{ id: "codex-cli", estado: "ausente" }], ate: 1 });
  });

  it("`sem-ia` fora do formato é ignorada", () => {
    const base = { t: "sem-ia", causa: "falhou", ia: "claude-cli", ias, ate: 1 };
    for (const ruim of [
      { ...base, causa: "outra" },
      { ...base, ia: "catcher" },
      { ...base, ate: "já" },
      { ...base, ias: "nenhuma" },
      { ...base, ias: [{ id: "cursor-cli", estado: "pronto" }] },
      { ...base, ias: [{ id: "claude-cli", estado: "talvez" }] },
      { ...base, ias: [{ id: "claude-cli", estado: "pronto" }, { id: "claude-cli", estado: "ausente" }] },
      { ...base, ias: [...ias, { id: "codex-cli", estado: "pronto" }] },
    ]) expect(lerMsgServidor(JSON.stringify(ruim)), JSON.stringify(ruim)).toBeNull();
  });

  it("`ia-voltou`, a fase `aguardando_escolha` e o fim `sem_ia`", () => {
    expect(lerMsgServidor(JSON.stringify({ t: "ia-voltou", ia: "codex-cli", trocou: true }))).toEqual({ t: "ia-voltou", ia: "codex-cli", trocou: true });
    expect(lerMsgServidor(JSON.stringify({ t: "ia-voltou", ia: null, trocou: false }))).toEqual({ t: "ia-voltou", ia: null, trocou: false });
    expect(lerMsgServidor(JSON.stringify({ t: "ia-voltou", ia: "hermes", trocou: true }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "ia-voltou", ia: "codex-cli" }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "estado", fase: "aguardando_escolha" }))).toEqual({ t: "estado", fase: "aguardando_escolha" });
    expect(lerMsgServidor(JSON.stringify({ t: "fim", motivo: "sem_ia" }))).toEqual({ t: "fim", motivo: "sem_ia" });
  });
});
