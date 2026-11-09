import { afterEach, describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { capacidadesDe } from "../../../src/domain/harness.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { IaNoMac } from "../../../src/contracts/onboarding.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { hora } from "../../../web/lib/render.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { situacaoMotorFora, textoInventario } from "../../../web/telas/frota.ts";
import { COMANDO_ATUALIZAR_IA, desatualizado, fraseDesatualizado, pedeInstalar, prontaDepois, versaoLegivel } from "../../../web/telas/ia-fora.ts";
import { motivoDoInventario, renderLinhaInteligencia } from "../../../web/telas/inteligencia.ts";
import { UI_IAS_INICIAL } from "../../../web/telas/cartao-ia.ts";
import { estadoDoCardIa, situacaoDaIa } from "../../../web/telas/onboarding.ts";

/**
 * NOD-171, fatia (d): a UI do CLI abaixo do piso, do harness fixado indisponível e do limite do plano (protótipo do Gil,
 * docs do Linear "NOD-171 · protótipo"). O CLI desatualizado ESTÁ no Mac: nenhuma tela diz "não está neste Mac" nem
 * "Instalar"; todas dizem a versão instalada, a mínima e "Atualizar".
 */
const ANTIGO: Inventario = { estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0", motivo: "O Codex deste Mac (0.147.0) é mais antigo que o testado pelo nod. Atualize para a versão 0.159.0 ou mais nova.", em: 0 };
const PRONTO: Inventario = { estado: "pronto", versao: "2.1.300", em: 0 };
const AUSENTE: Inventario = { estado: "ausente", motivo: "binario_nao_encontrado", em: 0 };
const SEM_LOGIN: Inventario = { estado: "nao_autenticado", motivo: "x", em: 0 };

describe("as funções de base", () => {
  it("desatualizado só com cli_antigo, versão e mínima", () => {
    expect(desatualizado(ANTIGO)).toEqual({ versao: "0.147.0", minima: "0.159.0" });
    expect(desatualizado({ ...ANTIGO, minima: undefined } as Inventario)).toBeNull();
    expect(desatualizado(AUSENTE)).toBeNull();
    expect(desatualizado(PRONTO)).toBeNull();
    expect(desatualizado(null)).toBeNull();
  });

  it("o CLI desatualizado não pede instalação; o ausente de verdade pede", () => {
    expect(pedeInstalar(ANTIGO)).toBe(false);
    expect(pedeInstalar(AUSENTE)).toBe(true);
    // NOD-9: o CLI que o nod está atualizando está lá; nunca "Instalar".
    expect(pedeInstalar({ estado: "ausente", causa: "atualizando", motivo: "x", em: 0 })).toBe(false);
  });

  it("a mínima como a pessoa lê: 0.159.0 vira 0.159; 2.1.290 fica", () => {
    expect(versaoLegivel("0.159.0")).toBe("0.159");
    expect(versaoLegivel("0.159.2")).toBe("0.159.2");
    expect(versaoLegivel("2.1.290")).toBe("2.1.290");
    expect(fraseDesatualizado("codex-cli", { versao: "0.147.0", minima: "0.159.0" })).toBe("Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova.");
  });

  it("um comando de atualizar por IA", () => {
    expect(COMANDO_ATUALIZAR_IA["codex-cli"]).toBe("npm install -g @openai/codex@latest");
    expect(COMANDO_ATUALIZAR_IA["claude-cli"]).toBe("claude update");
  });
});

describe("rodapé, menu da conta e Conexão", () => {
  it("a faixa diz a versão e a mínima da IA em uso, nunca 'não foi encontrada'", () => {
    expect(situacaoMotorFora(ANTIGO as Exclude<Inventario, { estado: "pronto" }>, "codex-cli")).toBe("Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova.");
    expect(situacaoMotorFora(ANTIGO as Exclude<Inventario, { estado: "pronto" }>, "catcher")).toBe("Sua IA está desatualizada");
    expect(situacaoMotorFora(AUSENTE as Exclude<Inventario, { estado: "pronto" }>, "codex-cli")).toBe("Sua IA não foi encontrada");
  });

  it("o texto do inventário diz 'desatualizado', não 'ausente'", () => {
    const texto = textoInventario(ANTIGO, 0);
    expect(texto).toContain("0.147.0 desatualizado");
    expect(texto).toContain("0.159 ou mais nova");
    expect(texto).not.toContain("ausente");
  });
});

describe("onboarding: o card da IA desatualizada", () => {
  const ias: IaNoMac[] = [
    { id: "claude-cli", estado: "pronto" },
    { id: "codex-cli", estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0" },
  ];

  it("diz a versão, a mínima e 'Atualizar' (que abre a página oficial), com o comando para copiar", () => {
    expect(situacaoDaIa("codex-cli", ias, null).situacao).toBe("desatualizado");
    const card = estadoDoCardIa("codex-cli", ias, null);
    expect(card.estado).toBe("Codex 0.147.0 · o nod precisa da 0.159 ou mais nova");
    expect(card.tom).toBe("aviso");
    expect(card.acao).toBe("Atualizar");
    expect(card.act).toBe("onboarding-ia-instalar");
    expect(card.comando).toBe("npm install -g @openai/codex@latest");
    expect(card.estado).not.toContain("não está neste Mac");
  });

  it("com o teste rodando e veredito 'ausente' do Mac, o servidor que viu a versão antiga manda", () => {
    const teste = { rodando: false, testando: [], vereditos: { "codex-cli": { ia: "codex-cli" as const, estado: "ausente" as const } } };
    expect(situacaoDaIa("codex-cli", ias, null, teste).situacao).toBe("desatualizado");
  });

  it("NOD-9: `atualizando` nunca vira a causa de um card sem conta (é o app que atualiza, não um veredito)", () => {
    expect(situacaoDaIa("claude-cli", [{ id: "claude-cli", estado: "nao_autenticado", causa: "atualizando" }], null).situacao).toBe("falta_entrar");
  });

  it("o CLI de fato ausente continua 'Instalar e entrar'", () => {
    const card = estadoDoCardIa("codex-cli", [{ id: "codex-cli", estado: "ausente" }], null);
    expect(card.acao).toBe("Instalar e entrar");
    expect(card.comando).toBeNull();
  });
});

const autoria = { autor_tipo: "agente" as const, autor_id: "gil", sob_procuracao_de: null, conta_de_execucao: "marcelo", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const negacao = (nome: string): Mensagem => ({ tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "negacao", texto: "Nenhum trabalho começa: executor indisponível (codex-cli: desatualizado).", payload: { kind: "negacao", classe: "plano_ausente", nome, motivo: "plano_ausente", terminal: true }, confianca: "confiavel", parcial: false, criadoEm: 0 });
const gil = (harness: string) => ({ id: "gil", nome: "Gil", harness, modelo: "auto", conversaId: "c1", ownerId: "marcelo", excluidoEm: null }) as unknown as FrotaDto["agentes"][number];

function com(p: { claude: Inventario; codex: Inventario; harnessDoGil?: string }): Estado {
  const opcoes = HARNESSES.map((h) => ({ ...h, capacidades: capacidadesDe(h.id), inventario: h.id === "claude-cli" ? p.claude : h.id === "codex-cli" ? p.codex : AUSENTE }));
  return {
    ...estadoInicial,
    agora: Date.UTC(2026, 9, 6, 12, 0),
    sessao: { tenantId: "t", pessoaId: "marcelo" },
    inventario: p.claude,
    frota: { agentes: [gil(p.harnessDoGil ?? "codex-cli")], negacoes: [] } as unknown as Estado["frota"],
    executor: { atual: "claude-cli", opcoes: [], recusa: null, harnesses: { padrao: null, simulacao: false, legado: "claude-cli", opcoes } },
  };
}
const noApp = (sim: boolean) => { if (sim) (globalThis as Record<string, unknown>).nodDesktop = {}; else delete (globalThis as Record<string, unknown>).nodDesktop; };
afterEach(() => noApp(false));

describe("conversa: o bot fixado numa IA que não está pronta", () => {
  it("desatualizada (NOD-8 J3, protótipo v2.2): a pílula com 1 frase e 'Atualizar', sem cartão, terminal nem troca", () => {
    noApp(true);
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: ANTIGO }));
    expect(html).toContain('class="linha-centro-wrap linha-espera linha-ia-atualizar"');
    expect(html).toContain("Gil precisa do Codex mais novo.");
    expect(html).toMatch(/data-act="ia-atualizar" data-ia="codex-cli" data-agora="1">Atualizar</);
    expect(html).not.toContain("aviso-estado");
    expect(html).not.toContain("<code>"); // o comando do terminal só depois de uma falha
    expect(html).not.toContain('data-act="inteligencia"'); // trocar a IA fica para quando o clique não resolve
    expect(html).not.toContain("Instalar");
    // QA #511 (protótipo v2.2, j3-1): a pílula do Atualizar leva o cadeado, não o relógio da fila.
    expect(html).toContain('<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>');
    expect(html).not.toContain('<path d="M12 7.5V12l3 2"/>');
  });

  it("NOD-8 J2: na fase esperando, o chip 'Na fila'; sem comando do terminal", () => {
    noApp(true);
    const codex: Inventario = { ...ANTIGO, atualizacao: { fase: "esperando", alvo: "0.159.0", em: 1 } } as Inventario;
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex }));
    expect(html).toContain("linha-espera");
    expect(html).toContain("Na fila · Vamos atualizar o Codex quando seus bots terminarem.");
    expect(html).toContain('<path d="M12 7.5V12l3 2"/>'); // a fila segue com o relógio
    expect(html).not.toContain('data-act="ia-atualizar"');
    expect(html).not.toContain("<code>");
  });

  it("NOD-8 J3: depois de uma falha no app, a frase do motivo, 'Tentar de novo' e só então o comando", () => {
    noApp(true);
    const codex: Inventario = { ...ANTIGO, atualizacao: { fase: "falhou", alvo: "0.159.0", motivo: "sem_internet", em: 1 } } as Inventario;
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex }));
    expect(html).toContain("tom-erro");
    expect(html).toMatch(/data-act="ia-atualizar" data-ia="codex-cli" data-agora="1">Tentar de novo</);
    expect(html).toContain("Não deu para atualizar o Codex: sem conexão com a internet.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
    // O terminal num link discreto embaixo do motivo (protótipo v2.2, "Prefere o terminal?").
    expect(html).toMatch(/<details class="ia-terminal"[^>]*><summary class="cl-terminal-link">Prefere o terminal\?<\/summary>.*<code>/s);
  });

  it("NOD-8: a IA que o nod está atualizando: o chip em curso, sem botão de atualizar", () => {
    noApp(true);
    const codex: Inventario = { estado: "ausente", causa: "atualizando", versao: "0.147.0", minima: "0.159.0", motivo: "x", atualizacao: { fase: "atualizando", alvo: "0.159.0", em: 1 }, em: 0 } as Inventario;
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex }));
    expect(html).toContain("linha-espera");
    expect(html).toContain("Atualizando o Codex…");
    expect(html).toContain("ob-gira");
    expect(html).not.toContain('data-act="ia-atualizar"');
  });

  it("revisão: desatualizada fora do app, o próprio aviso traz o comando com 'Copiar' (a Conexão só fala da IA em uso)", () => {
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: ANTIGO }));
    expect(html).toContain("<code>npm install -g @openai/codex@latest</code>");
    expect(html).toContain('data-act="copiar-texto"');
    expect(html).toMatch(/data-act="copiar-texto"[^>]*aria-live="polite"/); // NOD-8: o "✓ Copiado" é lido.
    expect(html).not.toContain('data-act="ia-atualizar"');
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
  });

  it("QA: conta sem acesso no Claude com o Codex desatualizado: a outra IA pede 'Atualizar o Codex', nunca 'Conectar' nem 'Instalar'", () => {
    noApp(true);
    const m = negacao("claude-cli");
    const semAcesso: Mensagem = { ...m, payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true, causa: "conta_sem_acesso" } };
    const html = renderMensagem(semAcesso, com({ claude: { ...SEM_LOGIN, causa: "conta_sem_acesso" }, codex: ANTIGO, harnessDoGil: "auto" }));
    expect(html).toMatch(/data-act="ia-atualizar" data-ia="codex-cli">.*Atualizar o Codex</);
    expect(html).not.toMatch(/data-act="ia-conectar" data-ia="codex-cli"/);
    expect(html).not.toContain("Instalar");
  });

  it("sem login: 'falta entrar no Claude Code' e o botão de entrar", () => {
    noApp(true);
    const html = renderMensagem(negacao("claude-cli"), com({ claude: SEM_LOGIN, codex: PRONTO, harnessDoGil: "claude-cli" }));
    expect(html).toContain("Gil não começou: falta entrar no Claude Code.");
    expect(html).toContain("Ele está instalado neste Mac, mas sem conta conectada.");
    expect(html).toContain('data-act="ia-entrar"');
    expect(html).toContain("Entrar no Claude");
  });

  it("fora do app do Mac, o botão de resolver leva à Conexão", () => {
    const html = renderMensagem(negacao("claude-cli"), com({ claude: SEM_LOGIN, codex: PRONTO, harnessDoGil: "claude-cli" }));
    expect(html).toContain('data-act="secao-espaco"');
    expect(html).not.toContain('data-act="ia-entrar"');
  });

  // NOD-220: o motor do executor se chama "claude-cli" (motorDe); "codex-cli" no nome só sai do harness recusado.
  it("bot no automático: o nome da negação é só o motor; fica o aviso de sempre", () => {
    const html = renderMensagem(negacao("claude-cli"), com({ claude: SEM_LOGIN, codex: ANTIGO, harnessDoGil: "auto" }));
    expect(html).toContain("Nenhum trabalho começou.");
    expect(html).not.toContain("deste Mac está desatualizado");
    expect(html).not.toContain('data-act="ia-atualizar"');
  });

  it("NOD-8: a IA do bot já voltou (sonda mais nova que a negação): o aviso some e fica a linha de sistema ('mande de novo')", () => {
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: { ...PRONTO, em: 1 } }));
    expect(html).not.toContain("Nenhum trabalho começou.");
    expect(html).not.toContain("aviso-estado");
    expect(html).toContain('class="linha-centro-wrap linha-ia linha-ia-voltou"');
    expect(html).toContain("O Codex já voltou ·");
    expect(html).toContain("mande a mensagem de novo");
  });

  it("NOD-8 passo 11: voltou porque o nod atualizou: a linha de sistema diz de qual versão para qual", () => {
    const codex: Inventario = { ...PRONTO, versao: "0.160.0", em: 2, atualizacao: { fase: "sucesso", alvo: "0.159.0", antes: "0.147.0", depois: "0.160.0", em: 2 } };
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex }));
    expect(html).toContain('<span class="linha-ok" aria-hidden="true">✓</span><span>Codex atualizado: 0.147.0 → 0.160.0 ·');
    expect(html).toContain("mande a mensagem de novo");
    // Um sucesso de antes da negação não é o que trouxe a IA de volta: fica a linha de sempre.
    const velho: Inventario = { ...codex, atualizacao: { fase: "sucesso", alvo: "0.159.0", antes: "0.147.0", depois: "0.160.0", em: -1 } } as Inventario;
    expect(renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: velho }))).toContain("O Codex já voltou ·");
  });

  it("revisão: fixado no Codex sem catálogo ou só lento, com o Claude pronto, nunca diz que a IA 'já voltou'", () => {
    const semCatalogo = { ...com({ claude: PRONTO, codex: PRONTO }), executor: { atual: "claude-cli", opcoes: [], recusa: null } } as Estado;
    const lento = com({ claude: PRONTO, codex: { estado: "ausente", motivo: "a sonda demorou", em: 0, causa: "sonda_lenta" } as Inventario });
    for (const estado of [semCatalogo, lento]) {
      const html = renderMensagem(negacao("codex-cli"), estado);
      expect(html).toContain("Nenhum trabalho começou.");
      expect(html).not.toContain("já voltou");
      expect(html).toContain("Sua mensagem fica guardada");
    }
  });

  it("revisão: modelo recusado pela IA pronta pede outro modelo, nunca 'já voltou' nem 'conectar'", () => {
    const m = negacao("codex-cli");
    const comModelo: Mensagem = { ...m, payload: { kind: "negacao", classe: "plano_ausente", nome: "codex-cli", motivo: "plano_ausente", terminal: true, modelo: "gpt-<b>x</b>" } };
    const html = renderMensagem(comModelo, com({ claude: PRONTO, codex: PRONTO }));
    expect(html).toContain("Gil não começou: o Codex não aceita o modelo gpt-&lt;b&gt;x&lt;/b&gt;.");
    expect(html).toContain("Escolha outro modelo para Gil e mande a mensagem de novo.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar o modelo de Gil</);
    expect(html).not.toContain("já voltou");
    expect(html).not.toContain("Conectar IA");
  });
});

// NOD-285 (revisão do Gil no #345): a negação por anexo tem aviso próprio; a frase não fica escondida em "Detalhes técnicos".
describe("conversa: nenhuma IA pronta lê o arquivo (anexo_nao_lido)", () => {
  const porAnexo = (anexo: "pdf" | "imagem"): Mensagem => {
    const m = negacao("codex-cli");
    return { ...m, texto: "Nenhum trabalho começa: nenhuma IA pronta agora lê PDF; deixe o Claude Code pronto ou cole o conteúdo como texto.", payload: { kind: "negacao", classe: "plano_ausente", nome: "codex-cli", motivo: "plano_ausente", terminal: true, anexo } };
  };

  for (const [caso, estado] of [["sonda do Codex mais antiga que a negação", com({ claude: SEM_LOGIN, codex: PRONTO, harnessDoGil: "auto" })], ["Codex com sonda nova", com({ claude: SEM_LOGIN, codex: { ...PRONTO, em: 1 }, harnessDoGil: "auto" })]] as const) {
    it(`${caso}: diz que não lê PDF, sem 'nenhuma IA está pronta agora', 'já voltou' ou 'fica guardada'`, () => {
      const html = renderMensagem(porAnexo("pdf"), estado);
      expect(html).toContain("Nenhum trabalho começou.");
      expect(html).toContain("Gil não consegue ler PDF com as IAs prontas agora. Deixe o Claude Code pronto e mande o arquivo de novo, ou cole o conteúdo como texto.");
      expect(html).not.toContain("nenhuma IA está pronta agora");
      expect(html).not.toContain("já voltou");
      expect(html).not.toContain("fica guardada");
      expect(html).toContain("Conectar IA");
      expect(html).toContain("Detalhes técnicos");
    });
  }

  it("imagem usa o nome do tipo e as IAs que leem", () => {
    const html = renderMensagem(porAnexo("imagem"), com({ claude: SEM_LOGIN, codex: PRONTO, harnessDoGil: "auto" }));
    expect(html).toContain("Gil não consegue ler imagem com as IAs prontas agora. Deixe o Claude Code ou o Codex pronto e mande o arquivo de novo");
  });
});

describe("conversa: o limite do plano sem outra IA (tela 4 do plano das IAs)", () => {
  const limite = (harness: "claude-cli" | "codex-cli", voltaEm: number | null, criadoEm = 0): Mensagem => ({ ...negacao("x"), kind: "sistema", criadoEm, texto: "Turno interrompido: seu plano do Claude Code atingiu o limite de uso; volta a funcionar às 14:00. O que já saiu fica marcado como parcial; nada foi reenviado.", payload: { kind: "limite_do_plano", harness, voltaEm } });

  it("uma linha centralizada com acento âmbar, não um cartão: diz até quando, na hora local", () => {
    const estado = com({ claude: PRONTO, codex: AUSENTE });
    const voltaEm = estado.agora + 5 * 3_600_000;
    const html = renderMensagem(limite("claude-cli", voltaEm), estado);
    expect(html).toContain("linha-centro-wrap linha-espera");
    expect(html).toContain(`Claude no limite até ${hora(voltaEm)}`);
    expect(html).not.toContain("tom-alerta");
    expect(html).not.toContain("aviso-estado");
  });

  it("fora do app do Mac, o passo é conectar a outra IA em Provedores de IA", () => {
    const estado = com({ claude: PRONTO, codex: SEM_LOGIN });
    const html = renderMensagem(limite("claude-cli", estado.agora + 3_600_000), estado);
    expect(html).toMatch(/data-act="secao-espaco" data-secao="conexao">Conectar o ChatGPT</);
  });

  it("no app do Mac: a outra instalada sem login vira 'Continuar pelo ChatGPT'; ausente, 'Instalar o ChatGPT'", () => {
    const base = com({ claude: PRONTO, codex: SEM_LOGIN });
    const mac = (estadoCodex: "falta_entrar" | "nao_instalada"): Estado => ({ ...base, iasMac: { ...base.iasMac, noApp: true, estados: { "codex-cli": { ia: "codex-cli", estado: estadoCodex, mensagem: "", em: 0 } } } });
    const voltaEm = base.agora + 3_600_000;
    expect(renderMensagem(limite("claude-cli", voltaEm), mac("falta_entrar"))).toMatch(/data-act="ia-entrar" data-ia="codex-cli">Continuar pelo ChatGPT</);
    expect(renderMensagem(limite("claude-cli", voltaEm), mac("nao_instalada"))).toMatch(/data-act="ia-instalar" data-ia="codex-cli">Instalar o ChatGPT</);
  });

  it("NOD-424: no app do Mac, a outra pronta numa máquina da pessoa (não no Mac) não pede login neste Mac", () => {
    const base = com({ claude: PRONTO, codex: PRONTO });
    const semCodexNoMac: Estado = { ...base, iasMac: { ...base.iasMac, noApp: true, estados: { "codex-cli": { ia: "codex-cli", estado: "falta_entrar", mensagem: "", em: 0 } } } };
    const html = renderMensagem(limite("claude-cli", base.agora + 3_600_000), semCodexNoMac);
    expect(html).not.toContain("Continuar pelo ChatGPT");
    expect(html).toContain('data-act="inteligencia" data-id="gil">Usar o ChatGPT</button>');
  });

  it("o Codex no limite sem hora: 'chegou ao limite'; passada uma hora, vira registro sem cor", () => {
    const estado = com({ claude: AUSENTE, codex: PRONTO });
    expect(renderMensagem(limite("codex-cli", null, estado.agora - 60_000), estado)).toContain("ChatGPT chegou ao limite");
    const antigo = renderMensagem(limite("codex-cli", null, estado.agora - 2 * 3_600_000), estado);
    expect(antigo).toContain("ChatGPT esteve no limite");
    expect(antigo).not.toContain("linha-espera");
  });

  it("uma hora que já passou não fica âmbar", () => {
    const estado = com({ claude: PRONTO, codex: PRONTO });
    const html = renderMensagem(limite("claude-cli", estado.agora - 60_000), estado);
    expect(html).toContain("Claude esteve no limite até");
    expect(html).not.toContain("linha-espera");
  });
});

describe("Inteligência (2A): a IA desatualizada", () => {
  const ias = HARNESSES.map((h) => ({ id: h.id, nome: h.nome, integrado: h.integrado, inventario: h.id === "codex-cli" ? ANTIGO : PRONTO, limite: null, recomendado: "recomendado" in h ? h.recomendado : null, modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })) }));
  const ctx = { ias, ui: UI_IAS_INICIAL, agora: 0 };

  it("o grupo da IA desatualizada diz 'não conectado', com as opções desabilitadas e o 'Conectar'", () => {
    const html = renderLinhaInteligencia({ id: "gil", nome: "Gil", modelo: "auto", harness: "auto" }, ctx, true);
    expect(html).toContain("· não conectado");
    expect(html).toMatch(/data-ia="codex-cli" data-modelo="gpt-5.6-sol" disabled/);
    expect(html).toContain('data-act="secao-espaco" data-secao="conexao">Conectar ›');
  });

  it("o motivo diz 'Atualize', nunca 'Instale'", () => {
    const motivo = motivoDoInventario("Codex", ANTIGO);
    expect(motivo).toBe("O Codex deste Mac está na versão 0.147.0. Atualize para a 0.159 ou mais nova para usá-lo no nod.");
    expect(motivo).not.toContain("Instale");
  });

  it("o modelo gravado que saiu da lista continua escolhido (o nome é o id)", () => {
    const ctxPronto = { ...ctx, ias: ias.map((i) => ({ ...i, inventario: PRONTO })) };
    const html = renderLinhaInteligencia({ id: "gil", nome: "Gil", modelo: "gpt-antigo", harness: "codex-cli" }, ctxPronto, true);
    expect(html).toContain('<span class="ia-atual">');
    expect(html).toContain("gpt-antigo");
  });
});

/**
 * NOD-213: o Chico em GPT/Codex mostrava "Nenhum trabalho começou" em laço, e o aviso dizia que a IA "já voltou" — o bot
 * com modelo GPT era lido como fixado no Claude Code (pronto). A IA do bot vem agora da `inteligencia` que o servidor
 * calcula pelo domínio (iaDoModelo), e "já voltou" só com a IA DO BOT pronta numa sonda posterior à negação.
 */
describe("NOD-213: bot no GPT/Codex nunca ouve que a IA 'já voltou' sem ela ter voltado", () => {
  // Como o servidor manda o Chico: gravado antes da 0068 como harness "auto" + modelo GPT; a inteligencia diz Codex.
  const chico = { id: "gil", nome: "Gil", harness: "auto", modelo: "gpt-5.6-sol", conversaId: "c1", ownerId: "marcelo", excluidoEm: null,
    inteligencia: { modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: { "codex-cli": { modelo: "gpt-5.6-sol" } } } } as unknown as FrotaDto["agentes"][number];
  const comChico = (p: { claude: Inventario; codex: Inventario }): Estado => ({ ...com(p), frota: { agentes: [chico], negacoes: [] } as unknown as Estado["frota"] });
  const NOVO: Inventario = { ...PRONTO, em: 1 };
  const LIMITE: Inventario = { estado: "nao_autenticado", causa: "limite", motivo: "limite de uso", em: 1 };
  const comCausa = (nome: string): Mensagem => {
    const m = negacao(nome);
    return { ...m, payload: { kind: "negacao", classe: "plano_ausente", nome, motivo: "plano_ausente", terminal: true, causa: "conta_sem_acesso" } };
  };

  it("regressão: Codex fora e Claude pronto — o aviso nomeia o Codex, não diz 'já voltou' (falha na main af5962a)", () => {
    for (const nome of ["claude-cli", "codex-cli"]) {
      const html = renderMensagem(negacao(nome), comChico({ claude: NOVO, codex: SEM_LOGIN }));
      expect(html).not.toContain("já voltou");
      expect(html).toContain("Codex");
      expect(html).toContain("Sua mensagem fica guardada");
    }
  });

  it("negação do assentamento sem IA no nome ('ia') e com causa: o aviso é da IA do bot, nunca 'já voltou'", () => {
    const html = renderMensagem(comCausa("ia"), comChico({ claude: NOVO, codex: { ...SEM_LOGIN, causa: "conta_sem_acesso" } }));
    expect(html).not.toContain("já voltou");
    expect(html).toContain("Codex");
    expect(html).not.toContain("Já há uma IA pronta");
  });

  it("Codex no limite da assinatura: o aviso diz o limite e oferece trocar a IA, nunca 'já voltou'", () => {
    const html = renderMensagem(negacao("codex-cli"), comChico({ claude: NOVO, codex: LIMITE }));
    expect(html).toContain("Gil não começou: a conta do ChatGPT chegou ao limite da assinatura.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
    expect(html).not.toContain("já voltou");
  });

  it("o laço: sonda 'pronto' ANTERIOR à negação não prova que a IA voltou", () => {
    const depois = { ...negacao("claude-cli"), criadoEm: 5 };
    for (const estado of [com({ claude: PRONTO, codex: PRONTO, harnessDoGil: "auto" }), comChico({ claude: PRONTO, codex: PRONTO })]) {
      const html = renderMensagem(depois, estado);
      expect(html).not.toContain("já voltou");
      expect(html).toContain("Sua mensagem fica guardada");
    }
  });

  it("nenhum caso de IA fora ou modelo inválido diz 'já voltou'", () => {
    const foras: Inventario[] = [SEM_LOGIN, LIMITE, ANTIGO, AUSENTE, { ...SEM_LOGIN, causa: "conta_sem_acesso" }];
    const comModelo: Mensagem = { ...negacao("codex-cli"), payload: { kind: "negacao", classe: "plano_ausente", nome: "codex-cli", motivo: "plano_ausente", terminal: true, modelo: "gpt-zz" } };
    for (const codex of foras) for (const m of [negacao("claude-cli"), negacao("codex-cli"), negacao("ia"), comCausa("ia"), comCausa("codex-cli")]) {
      expect(renderMensagem(m, comChico({ claude: NOVO, codex }))).not.toContain("já voltou");
    }
    expect(renderMensagem(comModelo, comChico({ claude: NOVO, codex: NOVO }))).not.toContain("já voltou");
  });

  // QA (Teodora): o bot que a 0068 (passo 3) deixaria em `claude-cli` + GPT — a negação traz o modelo recusado. O aviso
  // diz que o Claude Code não aceita o modelo e oferece trocar; nunca "já voltou", mesmo com as duas IAs prontas.
  it("bot `claude-cli` + GPT (saído da 0068): aviso de modelo recusado com botão, nunca 'já voltou'", () => {
    const daMigracao = { ...chico, harness: "claude-cli", inteligencia: { modo: "fixa", fixa: "claude-cli", ordem: null, escolhas: { "claude-cli": { modelo: "gpt-5.6-sol" } } } } as unknown as FrotaDto["agentes"][number];
    const estado: Estado = { ...com({ claude: NOVO, codex: NOVO }), frota: { agentes: [daMigracao], negacoes: [] } as unknown as Estado["frota"] };
    const m: Mensagem = { ...negacao("claude-cli"), payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true, modelo: "gpt-5.6-sol" } };
    const html = renderMensagem(m, estado);
    expect(html).toContain("Gil não começou: o Claude Code não aceita o modelo gpt-5.6-sol.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar o modelo de Gil</);
    expect(html).not.toContain("já voltou");
  });

  it("com o Codex de volta (sonda nova), o aviso de sempre pode dizer que voltou", () => {
    const html = renderMensagem(negacao("codex-cli"), comChico({ claude: NOVO, codex: NOVO }));
    expect(html).toContain("mande a mensagem de novo");
  });
});

/**
 * NOD-220 (regressão da NOD-213): em 13/10 às 09:45 a Ada (no Automático, turno roteado ao Codex) mostrou "Ela já voltou"
 * com o Codex indisponível desde 05:05. O bot não fixado olhava o motor em uso (Claude, pronto). Agora a IA que negou
 * (payload `ia`; nas antigas, "codex-cli" no nome) decide o "já voltou" e é a que o aviso nomeia.
 */
describe("NOD-220: o bot no Automático com o Codex fora nunca ouve 'já voltou'", () => {
  const NEGADA_EM = 5;
  const daAda = (payload: Partial<Extract<NonNullable<Mensagem["payload"]>, { kind: "negacao" }>>): Mensagem => {
    const m = negacao("codex-cli");
    return { ...m, criadoEm: NEGADA_EM, texto: "Nenhum trabalho começa: executor indisponível (Codex indisponível) desde 05:05.", payload: { kind: "negacao", classe: "plano_ausente", nome: "codex-cli", motivo: "plano_ausente", terminal: true, ...payload } };
  };
  const auto = (p: { claude: Inventario; codex: Inventario }) => com({ ...p, harnessDoGil: "auto" });
  const CLAUDE_NOVO: Inventario = { ...PRONTO, em: 10 };
  const CODEX_DE_ANTES: Inventario = { ...PRONTO, em: 0 };

  it("regressão: bot não fixado + negação 'Codex indisponível' + Claude pronto — nomeia o Codex, com botão; nunca 'já voltou'", () => {
    const html = renderMensagem(daAda({ ia: "codex-cli" }), auto({ claude: CLAUDE_NOVO, codex: CODEX_DE_ANTES }));
    expect(html).not.toContain("já voltou");
    expect(html).toContain("Gil não pôde começar: o Codex (ChatGPT) estava indisponível.");
    expect(html).toContain("Sua mensagem fica guardada: quando o Codex estiver pronto, Gil responde sozinho.");
    expect(html).toMatch(/data-act="secao-espaco" data-secao="conexao">Conectar IA</);
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
  });

  // Revisão do #303 (a): a negação antiga (sem `ia`) não nomeia a IA no aviso — o `nome` mistura motor e harness —, mas
  // segue legível e decide pela sonda da IA do nome, nunca pela do Claude pronto.
  it("negação antiga sem `ia` com o Codex fora: aviso de sempre, legível, sem 'já voltou'", () => {
    const html = renderMensagem(daAda({}), auto({ claude: CLAUDE_NOVO, codex: CODEX_DE_ANTES }));
    expect(html).not.toContain("já voltou");
    expect(html).toContain("Gil não pôde começar: nenhuma IA está pronta agora.");
    expect(html).toContain("Sua mensagem fica guardada");
    expect(html).toMatch(/data-act="secao-espaco" data-secao="conexao">Conectar IA</);
  });

  it("com o Codex sem login, no limite ou desatualizado, o aviso é o da IA que negou (o estado dela), nunca 'já voltou'", () => {
    const LIMITE: Inventario = { estado: "nao_autenticado", causa: "limite", motivo: "limite de uso", em: 10 };
    const casos: [Inventario, string][] = [[SEM_LOGIN, "Gil não começou: falta entrar no Codex."], [LIMITE, "Gil não começou: a conta do ChatGPT chegou ao limite da assinatura."], [ANTIGO, "Gil precisa do Codex mais novo."]];
    for (const [codex, titulo] of casos) {
      const html = renderMensagem(daAda({ ia: "codex-cli" }), auto({ claude: CLAUDE_NOVO, codex }));
      expect(html).toContain(titulo);
      expect(html).not.toContain("já voltou");
    }
  });

  it("'já voltou' só com a IA QUE NEGOU pronta numa sonda posterior à negação", () => {
    const voltou = renderMensagem(daAda({ ia: "codex-cli" }), auto({ claude: SEM_LOGIN, codex: { ...PRONTO, em: NEGADA_EM + 1 } }));
    expect(voltou).toContain("O Codex já voltou ·</span><span>se a resposta não chegou, mande a mensagem de novo.");
    // A sonda da mesma hora (ou anterior) não prova a volta; a do Claude, mais nova, também não.
    for (const estado of [auto({ claude: CLAUDE_NOVO, codex: { ...PRONTO, em: NEGADA_EM } }), auto({ claude: CLAUDE_NOVO, codex: CODEX_DE_ANTES })]) {
      expect(renderMensagem(daAda({ ia: "codex-cli" }), estado)).not.toContain("já voltou");
    }
  });

  it("negação antiga sem `ia` e sem IA no nome ('catcher', 'ia'): nunca 'já voltou' pela sonda de outra IA", () => {
    for (const nome of ["catcher", "ia"]) {
      const html = renderMensagem({ ...negacao(nome), criadoEm: NEGADA_EM }, auto({ claude: CLAUDE_NOVO, codex: CLAUDE_NOVO }));
      expect(html).not.toContain("já voltou");
      expect(html).toContain("Sua mensagem fica guardada");
    }
  });

  it("negação antiga com o Codex no nome (sem `ia`): a IA é o Codex, e o Claude pronto não a faz 'voltar'", () => {
    const antiga = { ...negacao("codex-cli"), criadoEm: NEGADA_EM };
    expect(renderMensagem(antiga, auto({ claude: CLAUDE_NOVO, codex: CODEX_DE_ANTES }))).not.toContain("já voltou");
    expect(renderMensagem(antiga, auto({ claude: SEM_LOGIN, codex: { ...PRONTO, em: NEGADA_EM + 1 } }))).toContain("O Codex já voltou");
  });

  it("bot fixado no Claude (sem regressão): Claude de volta depois da negação diz que voltou", () => {
    const html = renderMensagem(daAda({ nome: "claude-cli", ia: "claude-cli" }), com({ claude: CLAUDE_NOVO, codex: SEM_LOGIN, harnessDoGil: "claude-cli" }));
    expect(html).toContain("O Claude Code já voltou");
  });

  // Revisão do #303 (b): a negação do Claude no bot fixado nele segue nomeando o Claude Code e o estado dele.
  it("bot fixado no Claude com o Claude ainda fora: o aviso é do Claude Code, nunca 'já voltou'", () => {
    const fixadoClaude = (claude: Inventario) => com({ claude, codex: CLAUDE_NOVO, harnessDoGil: "claude-cli" });
    const semLogin = renderMensagem(daAda({ nome: "claude-cli", ia: "claude-cli" }), fixadoClaude({ ...SEM_LOGIN, em: 10 }));
    expect(semLogin).toContain("Gil não começou: falta entrar no Claude Code.");
    expect(semLogin).not.toContain("já voltou");
    const deAntes = renderMensagem(daAda({ nome: "claude-cli", ia: "claude-cli" }), fixadoClaude({ ...PRONTO, em: NEGADA_EM }));
    expect(deAntes).toContain("o Claude Code (Claude) estava indisponível");
    expect(deAntes).not.toContain("já voltou");
  });

  // Revisão do #303, achado 2: o executor fora (sem harness) grava nome "claude-cli" sem `ia`; o bot fixado no Codex
  // depende só do Codex. Antes o PR exigia o Claude Code também e o aviso nunca dizia que o Codex voltou.
  it("bot fixado no Codex + negação do executor (nome claude-cli, sem `ia`): Codex de volta diz 'O Codex já voltou'", () => {
    const m = { ...negacao("claude-cli"), criadoEm: NEGADA_EM };
    const html = renderMensagem(m, com({ claude: AUSENTE, codex: { ...PRONTO, em: NEGADA_EM + 1 }, harnessDoGil: "codex-cli" }));
    expect(html).toContain("O Codex já voltou ·</span><span>se a resposta não chegou, mande a mensagem de novo.");
  });

  // Achado 3: o bot que antes negou no Codex e foi fixado no Claude depende só do Claude (NOD-171: a IA DELE).
  it("bot fixado no Claude + negação antiga do Codex: decide e nomeia pelo Claude, nunca pelo Codex", () => {
    const estado = com({ claude: CLAUDE_NOVO, codex: SEM_LOGIN, harnessDoGil: "claude-cli" });
    const html = renderMensagem(daAda({ ia: "codex-cli" }), estado);
    // NOD-8: a IA do bot foi trocada depois da recusa e a nova está pronta — o aviso some e fica a linha da troca.
    expect(html).toContain("IA de Gil trocada ·</span><b>respondendo pelo Claude</b>");
    expect(html).not.toContain("aviso-estado");
    expect(html).not.toContain("falta entrar no Codex");
    // A nova IA ainda fora: o aviso é dela (o de sempre), nunca da antiga.
    const claudeFora = renderMensagem(daAda({ ia: "codex-cli" }), com({ claude: SEM_LOGIN, codex: SEM_LOGIN, harnessDoGil: "claude-cli" }));
    expect(claudeFora).toContain("falta entrar no Claude Code");
    expect(claudeFora).not.toContain("trocada");
  });

  // Achado 5: no Automático, o turno roteado ao Claude Code que recusou grava ia = claude-cli e o aviso o nomeia (a web não
  // repete mais a regra do motorDe para adivinhar se foi o executor ou a IA).
  it("Automático + `ia` claude-cli (o harness Claude recusou): o aviso nomeia o Claude Code", () => {
    const html = renderMensagem(daAda({ nome: "claude-cli", ia: "claude-cli" }), auto({ claude: { ...SEM_LOGIN, em: 10 }, codex: CLAUDE_NOVO }));
    expect(html).toContain("Gil não começou: falta entrar no Claude Code.");
    expect(html).not.toContain("já voltou");
  });

  // Validação do campo novo: `ia` fora do catálogo da web não vale nem cai para o `nome`.
  it("`ia` desconhecida: nada se infere — nunca 'já voltou', aviso de sempre legível", () => {
    for (const ia of ["gemini-cli", "", 42, null]) {
      const m = daAda({ ia: ia as never });
      const html = renderMensagem(m, auto({ claude: CLAUDE_NOVO, codex: CLAUDE_NOVO }));
      expect(html).not.toContain("já voltou");
      expect(html).toContain("Gil não pôde começar: nenhuma IA está pronta agora.");
    }
  });

  // Achado 4: a negação do catcher (o executor que faltou) volta pela sonda DO CATCHER, nunca pela de uma IA.
  it("negação do catcher: 'já voltou' só com o catcher pronto depois; Claude pronto não basta", () => {
    const comCatcher = (catcher: Inventario): Estado => {
      const e = auto({ claude: CLAUDE_NOVO, codex: CLAUDE_NOVO });
      return { ...e, executor: { ...e.executor!, atual: "catcher", opcoes: [{ id: "catcher", inventario: catcher }] as unknown as NonNullable<Estado["executor"]>["opcoes"] } };
    };
    const m = { ...negacao("catcher"), criadoEm: NEGADA_EM };
    expect(renderMensagem(m, comCatcher({ ...PRONTO, em: NEGADA_EM + 1 }))).toContain("A IA já voltou");
    expect(renderMensagem(m, comCatcher({ ...PRONTO, em: NEGADA_EM }))).not.toContain("já voltou");
    expect(renderMensagem(m, comCatcher({ ...AUSENTE, em: 10 }))).not.toContain("já voltou");
  });

  // Achado 7: o aviso nomeado sem estado que o catálogo explique sai do avisoHarnessFora (um só lugar), também sem catálogo.
  it("bot fixado no Codex, servidor sem catálogo: o aviso ainda nomeia o Codex, com os botões", () => {
    const e = com({ claude: CLAUDE_NOVO, codex: SEM_LOGIN, harnessDoGil: "codex-cli" });
    const html = renderMensagem(daAda({ ia: "codex-cli" }), { ...e, executor: { ...e.executor!, harnesses: undefined } as unknown as Estado["executor"] });
    expect(html).toContain("Gil não pôde começar: o Codex (ChatGPT) estava indisponível.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
    expect(html).not.toContain("já voltou");
  });
});

/** Revisão do #303 (c): a sonda tem de ser posterior à negação, comparada de forma robusta. */
describe("prontaDepois: sonda posterior à negação", () => {
  it("pronto e mais nova: voltou; igual, anterior ou não pronto: não", () => {
    expect(prontaDepois({ ...PRONTO, em: 6 }, 5)).toBe(true);
    expect(prontaDepois({ ...PRONTO, em: 5 }, 5)).toBe(false);
    expect(prontaDepois({ ...PRONTO, em: 4 }, 5)).toBe(false);
    expect(prontaDepois({ ...SEM_LOGIN, em: 6 }, 5)).toBe(false);
  });

  it("sonda ausente ou sem data válida (null, undefined, NaN, string ISO): não voltou", () => {
    expect(prontaDepois(null, 5)).toBe(false);
    expect(prontaDepois(undefined, 5)).toBe(false);
    for (const em of [undefined, Number.NaN, Number.POSITIVE_INFINITY, "2026-10-13T12:00:00Z"]) {
      expect(prontaDepois({ ...PRONTO, em } as unknown as Inventario, 5)).toBe(false);
    }
    expect(prontaDepois({ ...PRONTO, em: 6 }, Number.NaN)).toBe(false);
  });

  it("epoch ms não depende de fuso: o mesmo instante em fusos diferentes é o mesmo número", () => {
    const negada = Date.parse("2026-10-13T09:45:00-03:00");
    expect(prontaDepois({ ...PRONTO, em: Date.parse("2026-10-13T12:46:00Z") }, negada)).toBe(true);
    expect(prontaDepois({ ...PRONTO, em: Date.parse("2026-10-13T12:45:00Z") }, negada)).toBe(false);
  });
});
