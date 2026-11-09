/** Subconjunto de JSON Schema que o proxy expõe em tools/list e valida em tools/call. */
export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  enum?: readonly string[];
  items?: JsonSchema;
  minLength?: number;
  /** definido em 2026-09-24 (emenda da ADR-045): o teto das respostas prontas de pedir_a_pessoa chega ao modelo. */
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};
