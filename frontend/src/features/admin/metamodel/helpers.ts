import type { FieldDef } from "@/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function emptyField(): FieldDef {
  // weight 1 ("Normal") so newly created fields count toward data quality by
  // default — admins opt out via the importance picker, not by accident.
  return { key: "", label: "", type: "text", required: false, weight: 1 };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}
