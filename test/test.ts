import assert from 'assert';

import ow from 'ow';
import { createServer } from 'net';
import { Notcached, Util } from '../';

const SERVER_LOCATION = process.env.MEMCACHED_SERVER_LOCATION || '127.0.0.1:11211';
const MOCK_SERVER_PORT = Number(process.env.MOCK_MEMCACHED_SERVER_PORT) || 65531;
const MOCK_SERVER_LOCATION = `127.0.0.1:${MOCK_SERVER_PORT}`;

describe('Notcached', function() {
    this.timeout(5000);
    this.slow(1000);

    describe('Connections', function() {
        let server;
        let client;
        beforeEach(() => {
            server = createServer().listen(MOCK_SERVER_PORT);
        });

        afterEach(() => {
            // remove all listeners from client
            if (server) {
                server.close();
                server = null;
            }
            if (client) {
                client.removeAllListeners();
                client.end();
                client = null;
            }
        });

        it('should error when invalid server location is used', () => {
            assert.throws(() => new Notcached('hey:you'));
        });

        it('Should connect to the server', (done) => {
            client = new Notcached(MOCK_SERVER_LOCATION);
            client.once('ready', () => done());
            client.once('error', err => done(err));
        });

        it('Should not connect to some random port', (done) => {
            client = new Notcached('127.0.0.1:44345');
            client.once('ready', () => done(new Error('It should not connect!')));
            client.once('error', () => done());
        });
    });

    describe('Storage commands', function() {
        let client;
        before(() => {
            client = new Notcached(SERVER_LOCATION);
        });

        after(async () => {
            await client.flushAll();
            client.removeAllListeners();
            client.end();
            client = null;
        });

        it('flush all data', async() => {
            await assert.doesNotReject(client.flushAll());
        })

        it('set', async () => {
            await assert.doesNotReject(client.set('test', 'hey'));
        });

        it('add', async () => {
            await assert.doesNotReject(client.add('test2', 'heyo'));
        });

        it('add onto existing entry', async() => {
            await assert.rejects(client.add('test', 'hey'), {
                name: 'Error',
                message: 'NOT_STORED'
            });
        });

        it('replace', async () => {
            await assert.doesNotReject(client.replace('test', 'aloha'));
        });

        it('replace to something nonexistent', async () => {
            await assert.rejects(client.replace('test3', 'aloha'), {
                name: 'Error',
                message: 'NOT_STORED'
            });
        });

        it('append', async() => {
            await assert.doesNotReject(client.append('test', ' John doe!'));
        });

        it('append to something nonexistent', async () => {
            await assert.rejects(client.append('test3', ' John doe!'), {
                name: 'Error',
                message: 'NOT_STORED'
            });
        });

        it('prepend', async () => {
            await assert.doesNotReject(client.prepend('test2', 'John doe, '));
        });

        it('prepend to something inexistent', async () => {
            await assert.rejects(client.prepend('test3', ' John doe!'), {
                name: 'Error',
                message: 'NOT_STORED'
            });
        });

        it('CAS operation', async() => {
            const data = await client.gets('test');
            const { cas } = data['test'];
            
            await client.set('test', 'somethingelse');
        
            await assert.rejects(client.cas('test', 'somethingdifferent', cas), {
                name: 'Error',
                message: 'EXISTS'
            });
        });

        it('CAS operation on something nonexistent', async() => {
            const cas = Math.floor(Math.random() * 10000).toString();
            await assert.rejects(client.cas('somerandomkey', 'somerandomvalue', cas), {
                name: 'Error',
                message: 'NOT_FOUND'
            });
        })
    });

    describe('Retrieval commands', function() {
        let client;
        before(async() => {
            client = new Notcached(SERVER_LOCATION);
            client.string();
            await client.set('test', 'hello world!');
            await client.set('test2', 'I am');
            await client.set('test3', 'John doe!', 0, 100);
        });

        after(async() => {
            await client.flushAll();
            client.removeAllListeners();
            client.end();
            client = null;
        });

        it('get one key', async() => {
            const result = await client.get('test');
            assert.deepEqual(result, {
                'test': {  data: 'hello world!', flags: 0 }
            });
        });

        it('get many keys', async() => {
            const result = await client.get('test', 'test2', 'test3');
            assert.deepEqual(result, {
                'test': { data: 'hello world!', flags: 0 },
                'test2': { data: 'I am', flags: 0 },
                'test3': { data: 'John doe!', flags: 100 }
            });
        });

        it('gets one key', async() => {
            const result = await client.gets('test');
            // use ow to "verify" the result first
            ow(result, ow.object.exactShape({
                'test': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric })
            }));

            const cas = result['test'].cas;
            assert.deepEqual(result, {
                'test': { data: 'hello world!', flags: 0, cas }
            });
        });

        it('gets many keys', async() => {
            const result = await client.gets('test', 'test2', 'test3');
            // use ow to "verify" the result first
            ow(result, ow.object.exactShape({
                'test': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric }),
                'test2': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric }),
                'test3': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric })
            }));

            const casTest = result['test'].cas;
            const casTest2 = result['test2'].cas;
            const casTest3 = result['test3'].cas;

            assert.deepEqual(result, {
                'test': { data: 'hello world!', flags: 0, cas: casTest },
                'test2': { data: 'I am', flags: 0, cas: casTest2 },
                'test3': { data: 'John doe!', flags: 100, cas: casTest3 }
            });
        });
    });

    describe('Deletion', function() {
        let client;
        before(async() => {
            client = new Notcached(SERVER_LOCATION);
            await client.set('test', 'hey');
        });

        after(async() => {
            await client.flushAll();
            client.removeAllListeners();
            client.end();
            client = null;
        });

        it('delete', async() => {
            await client.delete('test');
        });

        it('deleting something nonexistent', async() => {
            await assert.rejects(client.delete('test2'), {
                name: 'Error',
                message: 'NOT_FOUND'
            });
        });
    });

    describe('Increment and decrement', function() {
        let client;
        before(async() => {
            client = new Notcached(SERVER_LOCATION);
            await client.set('test', '10');
        });

        after(async() => {
            await client.flushAll();
            client.end();
            client = null;
        });

        it('increment', async() => {
            const result = await client.incr('test');
            assert.equal(result, 11);
        });

        it('incrementing something nonexistent', async() => {
            assert.rejects(client.incr('test2'), {
                name: 'Error',
                message: 'NOT_FOUND'
            });
        });

        it('decrement', async() => {
            const result = await client.decr('test');
            assert.equal(result, 10);
        });

        it('decrement something nonexistent', async() => {
            assert.rejects(client.decr('test2'), {
                name: 'Error',
                message: 'NOT_FOUND'
            });
        });
    });

    describe('Touch and GAT', function() {
        this.slow(8000);
        
        let client;
        before(async() => {
            client = new Notcached(SERVER_LOCATION);
            client.string();
        });

        after(async() => {
            client.flushAll();
            client.end();
            client = null;
        });

        it('touch', async() => {
            await client.set('test', 'hey', 2000);
            await client.touch('test', 0);

            await Util.asyncWait(3000);
            const result = await client.get('test');
            assert.deepEqual(result, {
                'test': { data: 'hey', flags: 0 }
            });
        });

        it('touch something nonexistent', async() => {
            await assert.rejects(client.touch('test2', 0), {
                name: 'Error',
                message: 'NOT_FOUND'
            });
        });
        
        it('gat a key', async() => {
            const expectedResult = {
                'test': { data: 'hey', flags: 0 }
            }
            await client.set('test', 'hey', 2000);
            const gatResult = await client.gat(0, 'test');
            assert.deepEqual(gatResult, expectedResult);

            await Util.asyncWait(3000);
            const result = await client.get('test');
            assert.deepEqual(result, expectedResult);
        });

        it('gat many keys', async() => {
            const expectedResult = {
                'test': { data: 'hey', flags: 0 },
                'test2': { data: 'heyo', flags: 0 },
                'test3': { data: 'hello', flags: 100 }
            };
            await client.set('test', 'hey', 2000);
            await client.set('test2', 'heyo', 2000);
            await client.set('test3', 'hello', 2000, 100);
            
            const gatResult = await client.gat(0, 'test', 'test2', 'test3');
            assert.deepEqual(gatResult, expectedResult);

            await Util.asyncWait(3000);
            const result = await client.get('test', 'test2', 'test3');
            assert.deepEqual(result, expectedResult);
        });

        it('gats one key', async() => {
            await client.set('test', 'hey', 2000);
            const gatsResult = await client.gats(0, 'test');

            ow(gatsResult, ow.object.exactShape({
                'test': ow.object.exactShape({  data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric })
            }));

            const casTest = gatsResult['test'].cas;
            assert.deepEqual(gatsResult, {
                'test': { data: 'hey', flags: 0, cas: casTest }
            });

            await Util.asyncWait(3000);
            const result = await client.get('test');
            assert.deepEqual(result, {
                'test': { data: 'hey', flags: 0 }
            });
        });

        it('gats many keys', async() => {
            await client.set('test', 'hey', 2000);
            await client.set('test2', 'heyo', 2000);
            await client.set('test3', 'hello', 2000, 100);
            const gatsResult = await client.gats(0, 'test', 'test2', 'test3');
        
            ow(gatsResult, ow.object.exactShape({
                'test': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric }),
                'test2': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric }),
                'test3': ow.object.exactShape({ data: ow.string.nonEmpty, flags: ow.number, cas: ow.string.nonEmpty.numeric })
            }));

            const casTest = gatsResult['test'].cas;
            const casTest2 = gatsResult['test2'].cas;
            const casTest3 = gatsResult['test3'].cas;

            assert.deepEqual(gatsResult, {
                'test': { data: 'hey', flags: 0, cas: casTest },
                'test2': { data: 'heyo', flags: 0, cas: casTest2 },
                'test3': { data: 'hello', flags: 100, cas: casTest3 }
            });

            await Util.asyncWait(3000);
            const result = await client.get('test', 'test2', 'test3');
            assert.deepEqual(result, {
                'test': { data: 'hey', flags: 0 },
                'test2': { data: 'heyo', flags: 0 },
                'test3': { data: 'hello', flags: 100 }
            });
        });
    });
});