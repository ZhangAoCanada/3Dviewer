import { LoaderRegistry } from '../core/registry';
import { gaussianLoader } from './gaussian/gaussianLoader';
import { meshLoader } from './mesh/meshLoader';
import { pointCloudLoader } from './points/pointCloudLoader';

export function createDefaultRegistry(): LoaderRegistry {
  const registry = new LoaderRegistry();
  registry.register(gaussianLoader);
  registry.register(meshLoader);
  registry.register(pointCloudLoader);
  return registry;
}

export { gaussianLoader, meshLoader, pointCloudLoader };
