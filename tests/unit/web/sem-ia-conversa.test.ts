import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { FALA_SEM_IA_PRIMEIRA, FALA_SEM_IA_SEGUINTE } from "../../../src/domain/sem-ia.ts";
import { botaoDaBarraSemIa, cardDaConversa, cardSemIa, sequenciaSemIa, FALA_ONBOARDING_SO_CHIPS, pensaCom, dicaDoComposerSemIa, linhaConectada, conversaAguardandoIa, falaSemIaHtml, iaConectadaDepois, iasNoCard, idDoCardSemIa, situacaoDaIa, ultimaFalaSemIa, type IaNoCard } from "../../../web/telas/sem-ia-conversa.ts";
import { UI_IAS_INICIAL } from "../../../web/telas/cartao-ia.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";

const fala = (id: string, texto: string, criadoEm: number, aguardaIa = true): Mensagem => ({
  id,
  turnoId: `t-${id}`,
  conversaId: "c1",
  kind: "negacao",
  texto,
  criadoEm,
  autoria: { autor_tipo: "agente", autor_id: "a1" },
  payload: { kind: "negacao", classe: "plano_ausente", nome: "claude", motivo: "plano_ausente", terminal: false, ...(aguardaIa ? { aguardaIa: true } : {}) },
} as unknown as Mensagem);
const pessoa = (id: string, criadoEm: number): Mensagem => ({ id, turnoId: null, conversaId: "c1", kind: "texto", texto: "oi", criadoEm, autoria: { autor_tipo: "pessoa", autor_id: "p" }, payload: null } as unknown as Mensagem);

const SEM: IaNoCard[] = [
  { ia: "claude-cli", inventario: { estado: "ausente", motivo: "x", em: 1 } },
  { ia: "codex-cli", inventario: { estado: "nao_autenticado", motivo: "x", em: 1 } },
];

describe("jornada C na tela: a fala do bot e o card na conversa", () => {
  it("critério 1: o card tem o título, Claude e ChatGPT com o botão certo e o rodapé; nada de 'Turno interrompido' nem 'Mac'", () => {
    const html = cardSemIa("c1", SEM, 10);
    expect(html).toContain('class="cp cp-sem-ia"');
    expect(html).toContain(`id="${idDoCardSemIa("c1")}"`);
    expect(html).toContain("Conectar uma IA neste computador");
    expect(html).toMatch(/Claude<\/b> <span class="cp-rot">· instala em menos de um minuto/);
    expect(html).toMatch(/ChatGPT<\/b> <span class="cp-rot">· instalado, falta entrar/);
    expect(html).toContain(">Instalar<");
    expect(html).toContain(">Entrar<");
    expect(html).toContain("Outras IAs · Grok e Gemini em breve");
    expect(html).not.toMatch(/Turno interrompido|\bMac\b/);
  });

  it("critério 2: três falas guardadas, um card só — na PRIMEIRA, e as seguintes ('card acima') ficam embaixo dele", () => {
    const msgs = [pessoa("p1", 1), fala("f1", FALA_SEM_IA_PRIMEIRA, 2), pessoa("p2", 3), fala("f2", FALA_SEM_IA_SEGUINTE, 4), pessoa("p3", 5), fala("f3", FALA_SEM_IA_SEGUINTE, 6)];
    expect(ultimaFalaSemIa(msgs)?.id).toBe("f3");
    const vivos = new Set(["t-f1", "t-f2", "t-f3"]);
    const card = cardDaConversa(msgs, vivos);
    expect(card).toEqual({ falaId: "f1", falaEm: 2, vivo: true });
    const html = msgs.filter((m) => m.kind === "negacao").map((m) => falaSemIaHtml({ mensagem: m, balao: `<b>${m.texto}</b>`, comCard: m.id === card?.falaId, vivo: card?.vivo ?? false, ias: SEM })).join("");
    expect(html.match(/class="cp cp-sem-ia"/g)).toHaveLength(1);
    const posCard = html.indexOf('class="cp cp-sem-ia"');
    expect(posCard).toBeGreaterThan(html.indexOf(FALA_SEM_IA_PRIMEIRA));
    expect(posCard).toBeLessThan(html.indexOf(FALA_SEM_IA_SEGUINTE));
  });

  it("a sequência recomeça depois que a IA respondeu: a fala nova leva o card, não a antiga", () => {
    const resposta = { ...pessoa("r1", 4), autoria: { autor_tipo: "agente", autor_id: "a1" } } as Mensagem;
    const msgs = [pessoa("p1", 1), fala("f1", FALA_SEM_IA_PRIMEIRA, 2), pessoa("p2", 3), resposta, pessoa("p3", 5), fala("f3", FALA_SEM_IA_PRIMEIRA, 6)];
    expect(sequenciaSemIa(msgs).map((m) => m.id)).toEqual(["f3"]);
    expect(cardDaConversa(msgs, new Set(["t-f3"]))?.falaId).toBe("f3");
  });

  it("a fala antiga cuja mensagem já rodou (turno fora da fila) não volta a pedir para conectar quando a IA cai de novo", () => {
    const msgs = [pessoa("p1", 1), fala("f1", FALA_SEM_IA_PRIMEIRA, 2)];
    const card = cardDaConversa(msgs, new Set());
    expect(card).toEqual({ falaId: "f1", falaEm: 2, vivo: false });
    // Sem IA e sem turno vivo: só o balão, sem card.
    expect(falaSemIaHtml({ mensagem: msgs[1]!, balao: "B", comCard: true, vivo: false, ias: SEM })).toBe("B");
    // Com a IA que conectou depois: a linha "… conectado" fica.
    expect(falaSemIaHtml({ mensagem: msgs[1]!, balao: "B", comCard: true, vivo: false, ias: [{ ia: "claude-cli", app: "pronta" }] })).toContain("Claude conectado");
    // Barra e composer: nada.
    expect(conversaAguardandoIa({ c1: { mensagens: msgs } }, SEM, new Set())).toBeNull();
    expect(conversaAguardandoIa({ c1: { mensagens: msgs } }, SEM, new Set(["t-f1"]))).toEqual({ conversaId: "c1" });
  });

  it("a negação comum (sem aguardaIa) não é fala guardada", () => {
    expect(ultimaFalaSemIa([fala("x", "Turno interrompido", 1, false)])).toBeNull();
  });

  it("critério 3: a IA conecta depois da fala e o card vira a linha com o e-mail (sem e-mail quando não se sabe)", () => {
    const comApp: IaNoCard[] = [{ ia: "claude-cli", app: "pronta", email: "ana@exemplo.com" }, SEM[1]!];
    expect(cardSemIa("c1", comApp, 10)).toBe(`<div class="cp-linha cp-ok" id="${idDoCardSemIa("c1")}" role="status">Claude conectado como ana@exemplo.com</div>`);
    const servidor: IaNoCard[] = [SEM[0]!, { ia: "codex-cli", inventario: { estado: "pronto", versao: "1", em: 20 } }];
    expect(cardSemIa("c1", servidor, 10)).toContain("ChatGPT conectado<");
    // A sonda pronta mais VELHA que a fala não conta como "conectou".
    expect(iaConectadaDepois([{ ia: "claude-cli", inventario: { estado: "pronto", versao: "1", em: 5 } }], 10)).toBeNull();
  });

  it("o estado do app do Mac manda no do servidor", () => {
    expect(situacaoDaIa({ ia: "claude-cli", app: "falta_entrar", inventario: { estado: "pronto", versao: "1", em: 1 } })).toBe("falta_entrar");
    expect(situacaoDaIa({ ia: "claude-cli", app: "nao_instalada" })).toBe("instalar");
    expect(situacaoDaIa({ ia: "claude-cli" })).toBe("instalar");
    const ias = iasNoCard({ iasMac: { ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": { estado: "pronta", mensagem: "", em: 1, conta: { email: "a@b.c", organizacao: null, plano: null } } as never } }, ias: undefined, executor: null, inventario: null });
    expect(ias[0]).toMatchObject({ ia: "claude-cli", app: "pronta", email: "a@b.c" });
    expect(ias[1]).toMatchObject({ ia: "codex-cli", app: undefined, inventario: null });
  });

  it("critério 4: com fala guardada e sem IA, a barra tem um botão focável que leva ao card; conectou, o botão some", () => {
    const conversas = { c1: { mensagens: [pessoa("p1", 1), fala("f1", FALA_SEM_IA_PRIMEIRA, 2)] }, c2: { mensagens: [pessoa("p9", 1)] } };
    const vivos = new Set(["t-f1"]);
    expect(conversaAguardandoIa(conversas, SEM, vivos)).toEqual({ conversaId: "c1" });
    expect(conversaAguardandoIa(conversas, [{ ia: "claude-cli", app: "pronta" }], vivos)).toBeNull();
    expect(conversaAguardandoIa({ c2: conversas.c2 }, SEM, vivos)).toBeNull();
    const bt = botaoDaBarraSemIa("c1", "a1");
    expect(bt).toMatch(/^<button type="button"/);
    expect(bt).toContain('data-act="ir-card-sem-ia"');
    expect(bt).toContain('data-conversa="c1"');
    expect(bt).toContain("Sem IA neste computador");
    expect(bt).not.toContain("disabled");
  });

  it("a linha conectada só mostra o e-mail quando a conta é conhecida; a dica do composer nomeia o bot", () => {
    expect(linhaConectada("Claude", "ana@exemplo.com")).toBe("Claude conectado como ana@exemplo.com");
    expect(linhaConectada("Claude", null)).toBe("Claude conectado");
    expect(linhaConectada("ChatGPT", "  ")).toBe("ChatGPT conectado");
    expect(dicaDoComposerSemIa("Bruna")).toBe("Bruna responde quando uma IA estiver conectada aqui");
  });

  it("critério 5 (peças para a jornada A): o card de proposta sem IA não cita o Claude; texto livre recebe a fala dos chips", () => {
    expect(pensaCom(null)).toBe("Pensa com: a IA que você conectar");
    expect(pensaCom(null)).not.toContain("Claude");
    expect(pensaCom("ChatGPT")).toBe("Pensa com: ChatGPT");
    expect(FALA_ONBOARDING_SO_CHIPS).toBe("Sem IA aqui eu só consigo seguir pelas opções.");
  });

  // Regression: QA do PR #693 — o fio de renderMensagem (conversa.ts) não tinha teste: com `comCard: true` cada fala
  // levava um card e os testes acima, que montam `comCard` à mão, seguiam verdes.
  // Found by /qa on 2026-11-08
  it("critério 2 na tela de verdade: renderMensagem desenha as três falas como balão do bot e um card só, na primeira", () => {
    const msgs = [pessoa("p1", 1), fala("f1", FALA_SEM_IA_PRIMEIRA, 2), pessoa("p2", 3), fala("f2", FALA_SEM_IA_SEGUINTE, 4), pessoa("p3", 5), fala("f3", FALA_SEM_IA_SEGUINTE, 6)];
    const conversa = { conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: msgs, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 } as unknown as ConversaEstado;
    const vivos = Object.fromEntries(["t-f1", "t-f2", "t-f3"].map((id) => [id, { turnoId: id, conversaId: "c1", estado: "na_fila" }]));
    const estado = { ...estadoInicial, agora: 10, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [{ id: "a1", nome: "Bruna", ownerId: "p", conversaId: "c1" }] }, conversas: { c1: conversa }, turnosVivos: vivos } as unknown as Estado;
    const porFala = msgs.filter((m) => m.kind === "negacao").map((m) => renderMensagem(m, estado));
    expect(porFala.map((h) => (h.match(/class="cp cp-sem-ia"/g) ?? []).length)).toEqual([1, 0, 0]);
    for (const h of porFala) {
      expect(h).toContain('class="message bot');
      expect(h).not.toMatch(/Turno interrompido|class="negacao/);
    }
    // A espera acabou (nenhum turno vivo) e nenhuma IA conectou: nem card.
    const semVivos = { ...estado, turnosVivos: {} } as Estado;
    expect(renderMensagem(msgs[1]!, semVivos)).not.toContain("cp-sem-ia");
  });
});
