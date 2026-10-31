import { test, describe } from "node:test";
import assert from "node:assert";
import { scrubPhi, REDACTION } from "./scrubClient.ts";

describe("scrubPhi multilingual adversarial stress tests", () => {
  test("Spanish patient identifiers are redacted", () => {
    const tests = [
      { input: "Paciente: Juan Perez", expected: `Paciente: ${REDACTION}` },
      { input: "paciente Juan Perez", expected: `paciente ${REDACTION}` },
      { input: "Historial Medico: 9876543", expected: `${REDACTION}` },
      { input: "Historial Médico: 123-456-78", expected: `${REDACTION}` },
      { input: "Fecha de nacimiento: 01/01/2000", expected: `${REDACTION}` },
      { input: "Nacido el 12 de octubre de 1990", expected: `${REDACTION}` },
      { input: "paciente llamado Carlos Santana", expected: `paciente llamado ${REDACTION}` }
    ];

    for (const { input, expected } of tests) {
      assert.strictEqual(scrubPhi(input).text, expected);
    }
  });

  test("zero medical terminology in Spanish is falsely redacted", () => {
    const clinicalTerms = [
      "paciente posicionado",
      "paciente estable",
      "paciente transferido",
      "paciente calentando",
      "paciente en posicion",
      "paciente preparado",
      "paciente identificado",
      "paciente cubierto",
      "Necesitamos hilo 3-0",
      "Bisturí #10 por favor"
    ];

    for (const term of clinicalTerms) {
      assert.strictEqual(scrubPhi(term).text, term, `Term "${term}" should not be scrubbed`);
    }
  });
});
