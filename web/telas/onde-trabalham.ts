import { esc } from "../lib/render.ts";

/**
 * Tela B da jornada B, "Onde os bots trabalham" (definido em 2026-11-07, ADA-243; spec docs/specs/onboarding-jornada-b.md,
 * prancha-b.html). Depois de conectar a IA num computador novo, quando a máquina padrão é outra (ou nenhuma, ou está
 * desligada): "Trabalhar neste computador" usa o MESMO PUT /maquinas/padrao do seletor "Máquina padrão" (o executor
 * `maquinas.definir_padrao`, ADR-135); "Manter" não cria estado novo — só não muda a padrão (a tela não volta porque o
 * "já vi" desta máquina fica gravado).
 */

export type PadraoDaTelaB = { id: string; nome: string; conectada: boolean } | null;

/** Pura: a tela B aparece? Só com a IA pronta aqui e esta máquina conhecida; não aparece com a padrão = esta, ligada. */
export function mostrarTelaB(o: { estaMaquinaId: string | null; padrao: PadraoDaTelaB; iaProntaAqui: boolean }): boolean {
  if (!o.iaProntaAqui || !o.estaMaquinaId) return false;
  if (!o.padrao) return true;
  return o.padrao.id !== o.estaMaquinaId || !o.padrao.conectada;
}

/** Pura: o miolo da tela B (o diálogo põe em volta). Os botões levam `data-b="aqui"` e `data-b="manter"`. */
export function htmlTelaB(o: { padrao: PadraoDaTelaB; estaMaquinaNome: string }): string {
  const hoje = o.padrao
    ? `Hoje seus bots trabalham no <b>${esc(o.padrao.nome)}</b>${o.padrao.conectada ? "" : ", que está desligado"}.`
    : "Hoje seus bots trabalham em qualquer computador conectado.";
  const manter = o.padrao ? `Manter no ${esc(o.padrao.nome)}` : "Manter como está";
  const nota = o.padrao
    ? `Se mantiver, os bots ficam no ${esc(o.padrao.nome)} e esperam por ele; aqui você só conversa.`
    : "Se mantiver, os bots continuam rodando no computador que estiver conectado.";
  return `<h2 id="b-titulo">Onde os bots trabalham</h2>
    <p>${hoje}</p>
    <p>Com <b>Trabalhar neste computador</b>, o ${esc(o.estaMaquinaNome)} vira o computador padrão e os bots sem computador próprio trabalham aqui.</p>
    <p class="mudo sm">${nota} Dá para mudar depois em Configurações › Computadores.</p>
    <p data-estado class="dialogo-erro" role="status"></p>
    <div class="acoes"><button class="bt" data-b="manter" type="button">${manter}</button> <button class="bt pri" data-b="aqui" type="button">Trabalhar neste computador</button></div>`;
}
