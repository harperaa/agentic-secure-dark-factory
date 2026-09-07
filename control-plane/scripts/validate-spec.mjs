#!/usr/bin/env node
// Validate factory-spec documents against the schema. Usage: validate-spec.mjs <schema> <spec...>
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const [schemaPath, ...specPaths] = process.argv.slice(2);
if (!schemaPath || specPaths.length === 0) {
  console.error('usage: validate-spec.mjs <schema.json> <spec.json> [...]');
  process.exit(2);
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

let failed = 0;
for (const specPath of specPaths) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  if (validate(spec)) {
    console.log(`SPEC ${specPath} outcome=valid`);
  } else {
    failed += 1;
    console.error(`SPEC ${specPath} outcome=invalid`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || '/'} ${err.message ?? ''} ${JSON.stringify(err.params)}`);
    }
  }
}
process.exit(failed === 0 ? 0 : 1);
