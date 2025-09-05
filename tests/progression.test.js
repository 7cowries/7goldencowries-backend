import { deriveLevel } from "../config/progression.js";

test("unranked to Shellborn at 10k", () => {
  const a = deriveLevel(0);
  expect(a.levelName).toBe("Unranked");
  const b = deriveLevel(10000);
  expect(b.levelName).toBe("Shellborn");
});

test("cap at 250k", () => {
  const z = deriveLevel(250000);
  expect(z.levelName).toBe("Cowrie Ascendant");
  expect(z.progress).toBe(1);
});
