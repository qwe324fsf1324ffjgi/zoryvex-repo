#!/usr/bin/env node
import SwaggerParser from '@apidevtools/swagger-parser';
import { join } from 'node:path';

const specPath = join(import.meta.dirname, '..', 'packages/contracts/openapi.yaml');

try {
  await SwaggerParser.validate(specPath);
  console.log(`OpenAPI contract valid: ${specPath}`);
} catch (error) {
  console.error('OpenAPI contract invalid:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
