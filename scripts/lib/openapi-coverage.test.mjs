import { describe, expect, it } from 'vitest';
import {
  compareRoutes,
  describeCoverage,
  routesFromSpec,
  routesFromTerraform,
} from './openapi-coverage.mjs';
import { auditCoverage } from '../check-openapi-coverage.mjs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

describe('routesFromTerraform', () => {
  it('reads every route_key, method and path', () => {
    const source = `
module "roles_get_route" {
  route_key = "GET /roles/{roleId}"
}

module "roles_update_route" {
  route_key = "PATCH /roles/{roleId}"
}`;
    expect(routesFromTerraform(source)).toEqual([
      { method: 'get', path: '/roles/{roleId}' },
      { method: 'patch', path: '/roles/{roleId}' },
    ]);
  });

  it('finds nothing in a file with no routes', () => {
    expect(routesFromTerraform('module "core_table" {}')).toEqual([]);
  });
});

describe('routesFromSpec', () => {
  const spec = `
openapi: 3.1.0
paths:
  /health:
    get:
      operationId: getHealth
  /roles/{roleId}:
    get:
      operationId: getOwnRole
    patch:
      operationId: updateOwnRole
components:
  schemas:
    Thing:
      type: object
`;

  it('reads path and method keys by indentation', () => {
    expect(routesFromSpec(spec)).toEqual([
      { method: 'get', path: '/health' },
      { method: 'get', path: '/roles/{roleId}' },
      { method: 'patch', path: '/roles/{roleId}' },
    ]);
  });

  it('stops at the end of the paths block', () => {
    // `schemas:` sits at two spaces under `components:`, the same depth as a
    // path key. Reading past `paths:` would turn it into a route.
    expect(routesFromSpec(spec).map((r) => r.path)).not.toContain('schemas');
  });

  it('does not read a shared `parameters:` key as an operation', () => {
    const withParams = `
paths:
  /roles/{roleId}:
    parameters:
      - name: roleId
    get:
      operationId: getOwnRole
`;
    expect(routesFromSpec(withParams)).toEqual([{ method: 'get', path: '/roles/{roleId}' }]);
  });

  it('refuses a file with no paths block rather than reporting zero routes', () => {
    // Reporting zero would make the coverage check pass loudly and wrongly
    // the moment somebody restructured the file.
    expect(() => routesFromSpec('openapi: 3.1.0\n')).toThrow(/no top-level `paths:` block/);
  });
});

describe('compareRoutes', () => {
  it('reports a route that exists but is not documented', () => {
    const result = compareRoutes({
      deployed: [
        { method: 'get', path: '/health' },
        { method: 'get', path: '/roles' },
      ],
      documented: [{ method: 'get', path: '/health' }],
    });
    expect(result.undocumented).toEqual(['GET /roles']);
    expect(result.imaginary).toEqual([]);
  });

  it('reports a documented route that does not exist', () => {
    const result = compareRoutes({
      deployed: [{ method: 'get', path: '/health' }],
      documented: [
        { method: 'get', path: '/health' },
        { method: 'delete', path: '/roles/{roleId}' },
      ],
    });
    expect(result.imaginary).toEqual(['DELETE /roles/{roleId}']);
  });

  it('treats method and path together, not separately', () => {
    const result = compareRoutes({
      deployed: [{ method: 'patch', path: '/roles/{roleId}' }],
      documented: [{ method: 'get', path: '/roles/{roleId}' }],
    });
    expect(result.undocumented).toEqual(['PATCH /roles/{roleId}']);
    expect(result.imaginary).toEqual(['GET /roles/{roleId}']);
  });
});

describe('the real contract', () => {
  it('documents every route the test environment declares, and nothing else', () => {
    const result = auditCoverage({ root });
    expect(result.undocumented).toEqual([]);
    expect(result.imaginary).toEqual([]);
    // A guard on the guard: if the parser ever silently matched nothing,
    // both lists above would be empty for the wrong reason.
    expect(result.deployedCount).toBeGreaterThan(30);
    expect(result.documentedCount).toBe(result.deployedCount);
  });
});

describe('describeCoverage', () => {
  it('says so plainly when everything lines up', () => {
    expect(
      describeCoverage({ undocumented: [], imaginary: [], deployedCount: 41, documentedCount: 41 }),
    ).toBe('The contract documents all 41 routes, and nothing that does not exist.');
  });

  it('separates the two kinds of mismatch', () => {
    const text = describeCoverage({
      undocumented: ['GET /roles'],
      imaginary: ['DELETE /roles/{roleId}'],
      deployedCount: 2,
      documentedCount: 2,
    });
    expect(text).toContain('Routes that exist but are not in the contract:');
    expect(text).toContain('Routes in the contract that do not exist:');
  });
});
