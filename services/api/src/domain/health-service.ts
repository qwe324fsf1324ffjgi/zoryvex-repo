import type { HealthStatus } from '@zoryvex/contracts';
import type { Clock } from '../repositories/clock-repository';

/**
 * Identity of the running bundle. `version` is baked in at build time so it
 * describes the code itself; `environment` is read from configuration so the
 * same bundle stays deployable to more than one environment.
 */
export interface BuildInfo {
  version: string;
  environment: string;
}

export function getHealthStatus(clock: Clock, build: BuildInfo): HealthStatus {
  return {
    status: 'ok',
    timestamp: clock.now().toISOString(),
    version: build.version,
    environment: build.environment,
  };
}
