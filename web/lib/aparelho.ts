import { ehCelular } from "./celular.ts";

/**
 * NOD-383: no celular, o "computador" e o "Mac" de que a interface falava não são o aparelho na mão da pessoa. Os textos que
 * falam do próprio aparelho dizem "aparelho"; o Mac do servidor (ADR-092) vira "Seu Mac", porque "Este Mac" lido no celular
 * aponta para o celular. No desktop (e sem `matchMedia`, nos testes) tudo fica como era.
 */
export function nesteAparelho(celular = ehCelular()): string {
  return celular ? "neste aparelho" : "neste computador";
}

/** O Mac onde o servidor roda, visto de onde a pessoa está. */
export function rotuloDoMac(celular = ehCelular()): string {
  return celular ? "Seu Mac" : "Este Mac";
}

/** O detalhe do Tema: no celular, o sistema é o do aparelho, não o macOS. */
export function detalheDoTema(celular = ehCelular()): string {
  return celular ? "Sistema segue o modo claro ou escuro do aparelho" : "Sistema acompanha o modo claro ou escuro do macOS. Vale para este computador.";
}
