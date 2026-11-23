import { describe, expect, it } from "vitest";
import { rawJsonMember, stringifyWithRawMembers } from "../src/rawJson.js";

describe("rawJsonMember", () => {
  it.each([
    ['{"filter":{"n":9007199254740993}}', '{"n":9007199254740993}'],
    ['{ "a" : 1 , "filter" :\n 0.30000000000000000001 }', "0.30000000000000000001"],
    ['{"a":"x\\"filter\\":2","filter":[1,{"b":"]}"}]}', '[1,{"b":"]}"}]'],
    ['{"filter":null}', "null"],
    ['{"filter":"s\\\\"}', '"s\\\\"'],
    ['{"filter":1,"filter":-2e5}', "-2e5"],
    ['{"\\u0066ilter":true}', "true"],
    ['{"nested":{"filter":1}}', undefined],
    ["{}", undefined],
    ["[1]", undefined],
    ['{"filter":', undefined],
    ['{"filter":{"a":1}', undefined],
    ["not json", undefined],
  ])("%s", (json, expected) => {
    expect(rawJsonMember(json, "filter")).toBe(expected);
  });
});

describe("stringifyWithRawMembers", () => {
  it("appends raw members verbatim", () => {
    expect(stringifyWithRawMembers({}, { filter: "1e400" })).toBe('{"filter":1e400}');
    expect(stringifyWithRawMembers({ a: 1 }, { filter: '{"n":9007199254740993}' })).toBe(
      '{"a":1,"filter":{"n":9007199254740993}}',
    );
  });
});
