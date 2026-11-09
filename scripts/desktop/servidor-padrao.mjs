// NOD-203: a regra do endereço embutido (ADR-069), num lugar só. O build.mjs aceita vazio (dev e job verify);
// o release-preflight.mjs exige o valor. Só JavaScript puro: o preflight roda antes do `npm ci`.
export const FORMATO_SERVIDOR_PADRAO = /^https:\/\/[^/]+$/;
