import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrabalhoDto, TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, secaoDoPedido, type Estado } from "../../../web/estado/reducer.ts";
import { pilulaMac, seguradoPeloMac, situacaoDe, textoDaEspera } from "../../../web/lib/trabalhos.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { discoLegivel, renderEsteMac, USOS } from "../../../web/telas/este-mac.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";
import { itensDoUso } from "../../../web/telas/maquinas.ts";
import { renderTodosOsTrabalhos } from "../../../web/telas/trabalhos.ts";

/** ADR-085 (definido em 2026-10-08): Seu espaço › Este Mac, a pílula do Mac ocupado e "esperando o Mac aliviar". */

const AGORA = new Date(2026, 9, 8, 15, 0).getTime();
const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "cec", conversaId: "c-cec", titulo: id, origem: "rotina", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 600_000, iniciadoEm: AGORA - 600_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<TrabalhosDto> = {}, resto: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "cec", nome: "Cecília", conversaId: "c-cec", cor: "c-amber", forma: "shape-capsule", ownerId: "p", titulo: "PM", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: "verde", memoriaTotalMb: 1700, processador: "verde", cargaProcessador: 0.4, segurando: false, ...extra },
    ...resto,
  };
}

const rodando = trabalho("Orquestrar a etapa de engenharia", { turnoVivoId: "turno-1", memoriaMb: 420 });
// `seguravel` vem do servidor (seguravelPeloMac, tests/unit/domain/memoria-mac.test.ts).
const rotinaNova = trabalho("Verificar o Slack", { estado: "na_fila", iniciadoEm: null, seguravel: true });
const daPessoaNova = trabalho("Liberar espaço", { estado: "na_fila", iniciadoEm: null, origem: "pessoa", seguravel: false });

describe("quem espera o Mac aliviar", () => {
  it("o que o servidor marca como seguravel, na fila, e só com o Mac segurando", () => {
    expect(seguradoPeloMac(rotinaNova, true)).toBe(true);
    expect(seguradoPeloMac(daPessoaNova, true)).toBe(false);
    expect(seguradoPeloMac(trabalho("sem a marca (servidor antigo)", { estado: "na_fila", iniciadoEm: null }), true)).toBe(false);
    expect(seguradoPeloMac({ ...rotinaNova, estado: "rodando" }, true)).toBe(false);
    expect(seguradoPeloMac(rotinaNova, false)).toBe(false);
  });

  it("a linha diz o porquê: 'esperando o Mac aliviar' em vez de 'na fila'", () => {
    expect(situacaoDe(rotinaNova, [], true)).toBe("esperando o Mac aliviar");
    expect(situacaoDe(rotinaNova, [], false)).toBe("na fila");
    expect(situacaoDe(daPessoaNova, [], true)).toBe("na fila");
  });

  it("a pílula: nada sem segurar; com o Ver levando a Este Mac; a de memória, quando existe, fica sozinha", () => {
    expect(pilulaMac(false, 2)).toBe("");
    const p = pilulaMac(true, 2);
    expect(p).toContain("Seu Mac está ocupado");
    expect(p).toContain("2 trabalhos esperam o Mac aliviar");
    expect(p).toContain('data-act="secao-espaco" data-secao="este-mac"');
    expect(pilulaMac(true, 0, false)).toContain("trabalho novo espera o Mac aliviar");
    const todos = renderTodosOsTrabalhos(estadoCom([rodando, rotinaNova], { segurando: true }));
    expect(todos).toContain("Seu Mac está ocupado");
    expect(todos).toContain("esperando o Mac aliviar");
    expect(renderTodosOsTrabalhos(estadoCom([rodando, rotinaNova], { segurando: true, pressao: "amarela" }, { pressao: "amarela" }), "todos")).not.toContain("Seu Mac está ocupado");
  });
});

describe("Configurações › Máquinas › Este Mac", () => {
  // NOD-367: Este Mac mora dentro de Máquinas; o pedido antigo cai lá e o menu da conta não lista máquinas.
  it("o pedido 'este-mac' abre Máquinas e o menu da conta não tem o item", () => {
    expect(SECOES_ESPACO.map((s) => s.id)).not.toContain("este-mac");
    expect(secaoDoPedido("este-mac")).toBe("maquinas");
    expect(htmlMenuConta({ faixa: null, conexao: "Conectada" })).not.toContain('data-secao="este-mac"');
  });

  it("o resumo, a memória e o processador, quem trabalha (com a memória) e o uso escolhido", () => {
    const html = renderEsteMac(estadoCom([rodando, rotinaNova]));
    expect(html).toContain("1 trabalhando");
    expect(html).toContain("usa 1,7 GB do seu Mac");
    expect(html).toContain("Nada esperando");
    expect(html).toMatch(/<b>Memória<\/b>.*folgada/);
    expect(html).toMatch(/<b>Processador<\/b><span class="mac-barra nivel-verde" aria-hidden="true"><i style="width: 40%"><\/i><\/span><span>folgado<\/span>/);
    expect(html).toContain("Cecília");
    expect(html).toContain("420 MB");
    // NOD-367: o uso escolhido mora no "…" do Mac, em itens de rádio
    const uso = itensDoUso(estadoCom([]));
    expect(uso).toMatch(/role="menuitemradio" aria-checked="true" data-act="uso-do-mac" data-uso="equilibrado"/);
    expect(uso).toContain(USOS[1]!.explicacao);
  });

  it("com o Mac segurando: quem espera aparece, com a pílula; sem leitura do Mac, o texto diz isso", () => {
    const segurando = renderEsteMac(estadoCom([rodando, rotinaNova], { segurando: true, processador: "vermelha", cargaProcessador: 1.3 }));
    expect(segurando).toContain("1 esperando o Mac aliviar");
    expect(segurando).toContain("Esperando o Mac aliviar · 1");
    expect(segurando).toContain("Seu Mac está ocupado");
    expect(segurando).toContain('mac-barra nivel-vermelha" aria-hidden="true"><i style="width: 100%">');
    const semLeitura = renderEsteMac(estadoCom([], { pressao: null, processador: null, cargaProcessador: null, memoriaTotalMb: null }));
    expect(semLeitura).toContain("O Mac ainda não mandou leitura");
    const nadaAinda = renderEsteMac(estadoCom([rodando], { segurando: true, processador: "vermelha" }));
    expect(nadaAinda).toContain("Nada esperando ainda");
    expect(nadaAinda).not.toContain("0 esperando");
    const doisSemMemoria = renderEsteMac(estadoCom([rodando, { ...rodando, id: "outro", turnoVivoId: "turno-2" }], { memoriaTotalMb: null }));
    expect(doisSemMemoria).toContain("2 trabalhando");
    expect(doisSemMemoria).toContain("sem leitura de memória");
  });

  it("ADR-091: com o uso da CPU, a barra é a CPU (com o porquê no clique) e a fila só aparece quando aperta", () => {
    // 09/10: núcleos a 75%, 3,0 processos por núcleo.
    const html = renderEsteMac(estadoCom([rodando], { processador: "amarela", usoProcessador: 0.75, cargaProcessador: 3, fila: "vermelha", segurando: true }));
    expect(html).toMatch(/<summary class="mac-medidor"><b>Processador<\/b><span class="mac-barra nivel-amarela" aria-hidden="true"><i style="width: 75%"><\/i><\/span><span>apertando<\/span><\/summary>/);
    expect(html).toContain("Os núcleos passaram 75% do tempo ocupados no último meio minuto.");
    expect(html).toMatch(/<b>Fila<\/b><span class="mac-barra nivel-vermelha" aria-hidden="true"><i style="width: 100%"><\/i><\/span><span>engarrafada<\/span>/);
    expect(html).toContain("quase sempre esperando o disco");
    expect(html).toContain("Há 3 processos por núcleo querendo a vez.");
    // Fila andando: a linha some (status curto à vista, detalhe escondido).
    const folgado = renderEsteMac(estadoCom([rodando], { processador: "verde", usoProcessador: 0.3, cargaProcessador: 0.4, fila: "verde" }));
    expect(folgado).not.toContain("<b>Fila</b>");
    expect(folgado).toMatch(/<b>Processador<\/b><span class="mac-barra nivel-verde" aria-hidden="true"><i style="width: 30%">/);
    // App anterior (sem o uso): a barra continua a carga, sem detalhe e sem fila.
    const antigo = renderEsteMac(estadoCom([rodando], { processador: "vermelha", cargaProcessador: 1.3 }));
    expect(antigo).toMatch(/<div class="mac-medidor"><b>Processador<\/b>/);
    expect(antigo).not.toContain("<b>Fila</b>");
  });

  it("ADR-097: no Equilibrado o processador cheio não segura nada, e a tela diz isso; no Pouco, segura", () => {
    const cheio = { processador: "vermelha" as const, usoProcessador: 0.95, cargaProcessador: 1.2, fila: "vermelha" as const };
    const equilibrado = renderEsteMac(estadoCom([rodando], cheio));
    expect(equilibrado).toContain("nada espera por isso: no Equilibrado, só a memória e o disco seguram trabalho novo.");
    expect(equilibrado).not.toContain("esperam a fila baixar");
    expect(itensDoUso(estadoCom([], cheio))).toContain("Processador cheio só deixa tudo mais lento");
    const pouco = renderEsteMac({ ...estadoCom([rodando], cheio), usoDoMac: "pouco" });
    expect(pouco).toContain("Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa.");
    expect(pouco).toContain("esperam a fila baixar");
  });

  it("o uso escolhido muda pela ação do reducer; o padrão é equilibrado", () => {
    expect(estadoInicial.usoDoMac).toBe("equilibrado");
    const e = reduzir(estadoCom([]), { tipo: "uso-do-mac", uso: "pouco" });
    expect(e.usoDoMac).toBe("pouco");
    expect(itensDoUso(e)).toMatch(/aria-checked="true" data-act="uso-do-mac" data-uso="pouco"/);
  });

  it("o CSS da seção existe e usa só tokens", () => {
    const css = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    const bloco = css.slice(css.indexOf("Seu espaço › Este Mac"), css.indexOf("@media (max-width: 760px)", css.indexOf("Seu espaço › Este Mac")));
    expect(bloco).toContain(".mac-barra.nivel-vermelha i { background: var(--danger); }");
    expect(bloco).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

/** #219 (emenda à ADR-085, definido em 2026-10-09): o motivo da espera na linha, a pílula do disco e Este Mac com memória e disco. */
describe("espera por memória e disco", () => {
  const GB = 1024;
  // O disco vem do servidor com o nível e os limites (domain/memoria-mac.ts, `DISCO_*_MB`): a web só mostra.
  const limites = { alertaMb: 10 * GB, criticoMb: 3 * GB };
  const critico = { livreMb: 2 * GB, totalMb: 466 * GB, nivel: "vermelha" as const, ...limites };
  const emAlerta = { livreMb: 8.4 * GB, totalMb: 466 * GB, nivel: "amarela" as const, ...limites };
  // `esperaDoMac` vem do servidor (esperaDoMac, tests/unit/domain/memoria-mac.test.ts): com o disco crítico, até a task da pessoa.
  const pessoaPorDisco = { ...daPessoaNova, esperaDoMac: "disco" as const };
  const rotinaPorMemoria = { ...rotinaNova, esperaDoMac: "memoria" as const };

  it("a frase base 'esperando…' diz o motivo; sem motivo (processador, servidor anterior), 'o Mac aliviar'", () => {
    expect(textoDaEspera("memoria")).toBe("esperando o Mac liberar memória");
    expect(textoDaEspera("disco")).toBe("esperando espaço no disco");
    expect(textoDaEspera("processador")).toBe("esperando o Mac aliviar");
    expect(textoDaEspera(undefined)).toBe("esperando o Mac aliviar");
    expect(situacaoDe(rotinaPorMemoria, [], true)).toBe("esperando o Mac liberar memória");
    expect(situacaoDe(pessoaPorDisco, [], true)).toBe("esperando espaço no disco");
    expect(seguradoPeloMac(pessoaPorDisco, true)).toBe(true);
    // Revisto em 2026-10-09 (a tela fala por máquina): o motivo do servidor já é o da máquina do trabalho — o `segurando`
    // (o pior entre as máquinas) não o desliga; só vale para o trabalho que veio sem motivo (servidor anterior).
    expect(situacaoDe(pessoaPorDisco, [], false)).toBe("esperando espaço no disco");
    expect(situacaoDe({ ...pessoaPorDisco, esperaDoMac: null }, [], true)).toBe("na fila");
    // "começa depois da …" continua na frente (ela esperaria de qualquer jeito).
    const antes = trabalho("Migrar", { estado: "rodando" });
    expect(situacaoDe({ ...pessoaPorDisco, depoisDeTrabalhoId: antes.id }, [antes], true)).toBe("começa depois da Migrar");
  });

  it("a pílula do disco: 'Pouco espaço no disco', com o Ver para Este Mac; em Todos os trabalhos ela vem antes da de memória", () => {
    const p = pilulaMac(true, 1, true, "disco");
    expect(p).toContain("<b>Pouco espaço no disco</b>");
    expect(p).toContain("1 trabalho espera espaço no disco");
    expect(p).toContain('data-secao="este-mac"');
    expect(pilulaMac(true, 0, false, "disco")).toContain("trabalho novo espera espaço no disco");
    const todos = renderTodosOsTrabalhos(estadoCom([rodando, pessoaPorDisco], { segurando: true, motivoEspera: "disco", seguraTudoNovo: true, pressao: "amarela", disco: critico }, { pressao: "amarela" }));
    expect(todos).toContain("Pouco espaço no disco");
    expect(todos).not.toContain("Pouca memória no seu Mac");
    expect(todos).toContain("esperando espaço no disco");
    expect(todos.match(/pilula-memoria/g)).toHaveLength(1);
    // Memória crítica sem disco: a pílula de memória, que já existia, fica sozinha.
    const critica = renderTodosOsTrabalhos(estadoCom([rodando, rotinaPorMemoria], { segurando: true, motivoEspera: "memoria", seguraTudoNovo: false, pressao: "vermelha" }, { pressao: "vermelha" }));
    expect(critica).toContain("Seu Mac está quase sem memória");
    expect(critica).not.toContain("Seu Mac está ocupado");
    expect(critica).toContain("esperando o Mac liberar memória");
  });

  it("Este Mac: o disco com o livre à vista e o porquê atrás do clique, com os limites do servidor; crítico, vermelho e quem espera", () => {
    const html = renderEsteMac(estadoCom([rodando, pessoaPorDisco], { segurando: true, motivoEspera: "disco", seguraTudoNovo: true, disco: critico }));
    expect(html).toContain('<details class="mac-det" data-disclosure="mac-Disco"><summary class="mac-medidor"><b>Disco</b><span class="mac-barra nivel-vermelha" aria-hidden="true"><i style="width: 100%"></i></span><span>2 GB livres</span></summary>');
    expect(html).toContain("2 GB livres de 466 GB. Com menos de 10 GB livres, rotinas e pedidos entre bots esperam; com menos de 3 GB, nenhuma task nova começa, em qualquer opção. As que já rodam continuam. É o espaço livre que o macOS informa aos apps; pode ser um pouco menor que o do Finder. As pastas dos bots ficam em ~/nod.");
    expect(html).toContain("1 esperando espaço no disco");
    expect(html).toContain("Esperando espaço no disco · 1");
    expect(html).toContain("Pouco espaço no disco");
    expect(html).toContain("Liberar espaço · esperando espaço no disco");
    expect(renderEsteMac(estadoCom([rodando, rotinaNova], { segurando: true, motivoEspera: "disco", disco: emAlerta }))).toContain('<span class="mac-barra nivel-amarela" aria-hidden="true"><i style="width: 98%"></i></span><span>8,4 GB livres</span>');
    const folgado = renderEsteMac(estadoCom([rodando], { disco: { livreMb: 200 * GB, totalMb: 500 * GB, nivel: "verde", ...limites } }));
    expect(folgado).toContain('<b>Disco</b><span class="mac-barra nivel-verde" aria-hidden="true"><i style="width: 60%"></i></span><span>200 GB livres</span>');
    expect(folgado).not.toContain("As pastas dos bots");
    expect(folgado).toContain("pode ser um pouco menor que o do Finder");
    // Revisão do #224: "atualize o app" só com app anterior; o app novo que não conseguiu medir diz só "sem leitura".
    expect(renderEsteMac(estadoCom([rodando]))).toMatch(/<div class="mac-medidor"><b>Disco<\/b>.*<span>sem leitura \(atualize o app\)<\/span>/);
    expect(renderEsteMac(estadoCom([rodando], { disco: null, discoSuportado: true }))).toMatch(/<div class="mac-medidor"><b>Disco<\/b>.*<span>sem leitura<\/span><\/div>/);
  });

  it("Este Mac: a memória com o status curto e o porquê atrás do clique, pelo nível e pelo uso", () => {
    const critica = renderEsteMac(estadoCom([rodando, rotinaPorMemoria], { pressao: "vermelha", segurando: true, motivoEspera: "memoria" }));
    expect(critica).toMatch(/<details class="mac-det" data-disclosure="mac-Memória"><summary class="mac-medidor"><b>Memória<\/b>.*<span>crítica<\/span><\/summary>/);
    expect(critica).toContain("esperam até ele liberar memória, mesmo os que já esperam há mais de 1 hora; o que você pede começa");
    expect(renderEsteMac(estadoCom([rodando], { pressao: "vermelha" }, { usoDoMac: "livre" }))).toContain("nada espera por isso");
    expect(critica).toContain("Esperando o Mac liberar memória · 1");
    const alerta = renderEsteMac(estadoCom([rodando], { pressao: "amarela" }));
    expect(alerta).toContain("Rotinas e pedidos entre bots que ainda não começaram esperam");
    const alertaLivre = renderEsteMac(estadoCom([rodando], { pressao: "amarela" }, { usoDoMac: "livre" }));
    expect(alertaLivre).toContain("nada espera por isso");
    expect(renderEsteMac(estadoCom([rodando]))).toContain("Os bots usam 1,7 GB agora.");
  });

  it("o disco em números redondos", () => {
    expect(discoLegivel(900)).toBe("900 MB");
    expect(discoLegivel(8.4 * GB)).toBe("8,4 GB");
    expect(discoLegivel(17.4 * GB)).toBe("17 GB");
  });

  it("revisão do #224: a volta marcada vencida que o Mac segura diz por quê, em vez de 'volta às …' já passado", () => {
    const volta = trabalho("Acompanhar o CI", { estado: "rodando", acordaEm: AGORA - 60_000, esperaDoMac: "disco" });
    expect(situacaoDe(volta, [], true, AGORA)).toBe("esperando espaço no disco");
    expect(situacaoDe({ ...volta, esperaDoMac: null }, [], true, AGORA)).toMatch(/^volta /);
    // Revisto em 2026-10-09: o motivo vem da máquina do trabalho; o `segurando` do pior não o desliga.
    expect(situacaoDe(volta, [], false, AGORA)).toBe("esperando espaço no disco");
  });

  it("o CSS do detalhe usa só tokens e some a seta nativa; a barra não some no hover da linha", () => {
    const css = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    expect(css).toContain(".mac-det > summary:hover .mac-barra, .mac-det > summary:focus-visible .mac-barra { background: var(--line); }");
    expect(css).toContain(".mac-det > summary::-webkit-details-marker { display: none; }");
    expect(css).toContain(".mac-det[open] > summary::after { transform: rotate(90deg); }");
  });
});
