import assert from "node:assert/strict";
import { test } from "node:test";
import { getCopy, interpolate, isLanguage, LANGUAGES, roleLabel } from "@/lib/i18n";
import { EVENT_KEYS, translateEvent } from "@/lib/game/events";
import { ERROR_MESSAGE_KEYS } from "@/lib/api/errors";

/* -------------------------------------------------------------------------- */
/* translation completeness                                                   */
/* -------------------------------------------------------------------------- */

test("every language exposes exactly the same set of keys", () => {
  const reference = Object.keys(getCopy("uz")).sort();
  for (const language of LANGUAGES) {
    assert.deepEqual(Object.keys(getCopy(language)).sort(), reference, `keys differ for ${language}`);
  }
});

test("no translation value is empty or an ellipsis placeholder", () => {
  for (const language of LANGUAGES) {
    const copy = getCopy(language) as Record<string, string>;
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(value.length > 0, `${language}.${key} is empty`);
      assert.notEqual(value, "…", `${language}.${key} is an ellipsis placeholder`);
      assert.notEqual(value, "...", `${language}.${key} is an ellipsis placeholder`);
      // placeholders must be single-word identifiers so `interpolate` can fill them
      for (const match of value.matchAll(/\{([^}]*)\}/g)) {
        assert.match(match[1], /^\w+$/, `${language}.${key} has a malformed slot {${match[1]}}`);
      }
    }
  }
});

test("template placeholders match across languages", () => {
  const reference = getCopy("uz") as Record<string, string>;
  for (const language of LANGUAGES) {
    const copy = getCopy(language) as Record<string, string>;
    for (const [key, value] of Object.entries(reference)) {
      const slots = (text: string) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      // every language may add slots, but must not drop the base ones
      for (const slot of slots(value)) {
        assert.ok(slots(copy[key]).includes(slot), `${language}.${key} is missing {${slot}}`);
      }
    }
  }
});

test("interpolate fills slots and leaves unknown ones alone", () => {
  assert.equal(interpolate("Kamida {n} o‘yinchi", { n: 5 }), "Kamida 5 o‘yinchi");
  assert.equal(interpolate("Kamida {n} o‘yinchi"), "Kamida {n} o‘yinchi");
  assert.equal(interpolate("{a}/{b}", { a: 3, b: 8 }), "3/8");
});

test("language guard accepts only supported codes", () => {
  assert.equal(isLanguage("uz"), true);
  assert.equal(isLanguage("ru"), true);
  assert.equal(isLanguage("en"), true);
  assert.equal(isLanguage("kk"), false);
  assert.equal(isLanguage(undefined), false);
});

test("role labels exist in every language", () => {
  for (const language of LANGUAGES) {
    const copy = getCopy(language);
    for (const role of ["mafia", "doctor", "detective", "citizen"] as const) {
      assert.ok(roleLabel(role, copy).length > 0, `${language}.${role}`);
    }
    assert.equal(roleLabel(undefined, copy), "");
  }
});

/* -------------------------------------------------------------------------- */
/* multilingual layout guard                                                  */
/* -------------------------------------------------------------------------- */

test("no translation contains markup that could break flex layouts", () => {
  const forbidden = /<[^>]+>/;
  for (const language of LANGUAGES) {
    const copy = getCopy(language) as Record<string, string>;
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(!forbidden.test(value), `${language}.${key} contains markup`);
    }
  }
});

test("the longest strings are still reasonable for narrow mobile cards", () => {
  // Russian is typically the longest translation; guard against runaway strings
  for (const language of LANGUAGES) {
    const copy = getCopy(language) as Record<string, string>;
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(value.length <= 120, `${language}.${key} is unusually long (${value.length})`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* event catalogue                                                            */
/* -------------------------------------------------------------------------- */

test("every event key has a translation in all three languages", () => {
  for (const key of EVENT_KEYS) {
    for (const language of LANGUAGES) {
      const text = translateEvent(key, {}, language);
      assert.ok(text.length > 0, `${key} missing ${language}`);
    }
  }
});

test("event params are interpolated", () => {
  const text = translateEvent("event.mafiaKill", { player: "Alisher" }, "en");
  assert.match(text, /Alisher/);
});

test("unknown event keys degrade to an empty string rather than throwing", () => {
  assert.equal(translateEvent("event.doesNotExist", {}, "en"), "");
});

/* -------------------------------------------------------------------------- */
/* error catalogue                                                            */
/* -------------------------------------------------------------------------- */

test("every mapped error code resolves to a real translation", () => {
  for (const language of LANGUAGES) {
    const copy = getCopy(language) as Record<string, string>;
    for (const key of Object.values(ERROR_MESSAGE_KEYS)) {
      assert.ok(copy[key] && copy[key].length > 0, `${language} is missing "${key}"`);
    }
  }
});

test("error codes are deduplicated to a small set", () => {
  const unique = new Set(Object.values(ERROR_MESSAGE_KEYS));
  assert.ok(unique.size < 40);
  for (const key of unique) assert.equal(typeof key, "string");
});
