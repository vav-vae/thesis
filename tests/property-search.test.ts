import test from "node:test";
import assert from "node:assert/strict";
import { matchesLocation, matchesPropertySearch } from "../src/lib/property-search.ts";

test("La Paz spelling, case, punctuation and spacing match the same location", () => {
  for (const query of ["lapaz", "La Paz", " LA   PAZ ", "la-paz", "lapaz iloilo"]) {
    assert.equal(matchesLocation("La Paz, Iloilo City", query), true, query);
  }
});

test("district searches exclude other districts, even when mentioned in the title", () => {
  const property = { title: "Home near La Paz", location: "Jaro, Iloilo City" };
  assert.equal(matchesPropertySearch(property, "lapaz"), false);
  assert.equal(matchesPropertySearch(property, "La Paz"), false);
  assert.equal(matchesLocation(property.location, "lapaz"), false);
  assert.equal(matchesPropertySearch(property, "jaro"), true);
});

test("queries require every word and do not match partial district names", () => {
  const property = { title: "Modern home", location: "La Paz, Iloilo City" };
  assert.equal(matchesPropertySearch(property, "modern lapaz"), true);
  assert.equal(matchesPropertySearch(property, "modern jaro"), false);
  assert.equal(matchesLocation("Lapazville, Jaro", "lapaz"), false);
  assert.equal(matchesPropertySearch(property, ""), true);
  assert.equal(matchesLocation(undefined, "lapaz"), false);
});
