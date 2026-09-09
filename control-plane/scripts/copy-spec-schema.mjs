#!/usr/bin/env node
// Copy the factory-spec schema from the repository root into the app so the Spec screen
// validates against the single source of truth (spec/factory-spec.schema.json).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', '..', 'spec', 'factory-spec.schema.json');
const dest = path.resolve(here, '..', 'lib', 'factory', 'factory-spec.schema.json');
if (!existsSync(src)) {
  console.error(`copy-spec-schema: source not found at ${src}`);
  process.exit(1);
}
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`copy-spec-schema: ${path.relative(process.cwd(), dest)} updated`);
