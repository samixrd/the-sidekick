// Compile GuardRouter with via-ir to avoid "stack too deep", using solc standard JSON.
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "contracts", "GuardRouter.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "GuardRouter.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
let hasError = false;
for (const f in (out.errors || [])) {
  const err = out.errors[f];
  if (err.severity === "error") { hasError = true; console.log("ERR:", err.formattedMessage); }
}
if (hasError) process.exit(1);

const build = path.join(__dirname, "..", "contracts", "build");
fs.mkdirSync(build, { recursive: true });
const c = out.contracts["GuardRouter.sol"].GuardRouter;
fs.writeFileSync(path.join(build, "contracts_GuardRouter_sol_GuardRouter.abi"), JSON.stringify(c.abi));
fs.writeFileSync(path.join(build, "contracts_GuardRouter_sol_GuardRouter.bin"), c.evm.bytecode.object);
console.log("compiled OK | ABI entries:", c.abi.length, "| bytecode bytes:", (c.evm.bytecode.object.length - 2) / 2);
