const fs = require('fs');
const path = require('path');
const solc = require('solc');

function findImports(importPath) {
  const p = path.join(__dirname, '..', 'contracts', importPath);
  if (fs.existsSync(p)) return { contents: fs.readFileSync(p, 'utf8') };
  return { error: 'File not found: ' + importPath };
}

const source = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'BuilderBounties.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'BuilderBounties.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  let hasError = false;
  for (const err of output.errors) {
    console.log(err.severity.toUpperCase() + ':', err.formattedMessage);
    if (err.severity === 'error') hasError = true;
  }
  if (hasError) process.exit(1);
}

const contract = output.contracts['BuilderBounties.sol']['BuilderBounties'];
fs.writeFileSync(path.join(__dirname, '..', 'artifact.json'), JSON.stringify({
  abi: contract.abi,
  bytecode: '0x' + contract.evm.bytecode.object,
}, null, 2));

console.log('Compiled OK. ABI entries:', contract.abi.length, 'Bytecode length:', contract.evm.bytecode.object.length);
