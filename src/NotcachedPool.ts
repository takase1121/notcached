import { Notcached } from './'
import { NotcachedOptions } from './models/NotcachedOptions';
import { Pool } from 'tarn';
import { PoolOptions } from 'tarn/lib/Pool';
import merge from 'deepmerge';

export function createPool(location: string, poolOptions: Partial<PoolOptions<Notcached>>, connectionOptions?: NotcachedOptions) {
    const callbacks = {
        create: () => new Notcached(location, connectionOptions),
        validate: (resource: Notcached) => !resource.destroyed,
        destroy: (resource: Notcached) => resource.removeAllListeners().end()
    }

    const options = merge(callbacks, poolOptions);

    return new Pool<Notcached>(options as PoolOptions<Notcached>);
}