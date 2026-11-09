/**
 * NOD-367 (revisão 2): um controle que salva ao mudar (o seletor de máquina) já mostra o valor novo antes de o servidor
 * aceitar. Se salvar falha, `repor` (reporSeletor) volta o elemento ao valor salvo, em vez de o seletor ficar mostrando o
 * que não foi gravado. Puro, para o teste.
 */
export function salvarOuRepor(repor: () => void, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try { await fn(); } catch (e) { repor(); throw e; }
  };
}

/**
 * NOD-367 (revisão 3): o valor salvo de um seletor é a opção que o render marcou `selected` (defaultSelected). Repor
 * direto no elemento serve a qualquer região — a máquina padrão mora no Seu espaço e a do bot, na gaveta (#detalhes),
 * cujo cache esquecer o Seu espaço não alcançava.
 */
export function reporSeletor(el: { value: string; options: ArrayLike<{ value: string; defaultSelected: boolean }> }): void {
  const salvo = Array.from(el.options).find((o) => o.defaultSelected) ?? el.options[0];
  if (salvo) el.value = salvo.value;
}

/**
 * NOD-367 (revisão 4): mexer num campo da gaveta a deixa "suja" (o redesenho espera e o ‹ pergunta se descarta). O seletor
 * que salva ao mudar (`data-act-change`) não: o select dispara `input` antes do `change`, e a gaveta congelava.
 */
export function mudancaSujaAGaveta(el: { matches?(seletor: string): boolean }): boolean {
  return !el.matches?.("[data-act-change]");
}
