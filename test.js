import test from 'ava';
import sleep from 'then-sleep';
import EventEmitter from 'events';
import Server from './server';
import Client from './client';

const serverApp = {
  ADD: ({ x, y }) => Promise.resolve(x + y),
  SUB: ({ x, y }) => Promise.resolve(x - y),
  MUL: ({ x, y }) => Promise.resolve(x * y),
  DIV: ({ x, y }) => (y ? Promise.resolve(x / y) :
                        Promise.reject(new Error('Zero div'))),
};

const clientMethods = {
  add: { type: 'ADD', factory: (x, y) => ({ x, y }) },
  sub: { type: 'SUB', factory: (x, y) => ({ x, y }) },
  mul: { type: 'MUL', factory: (x, y) => ({ x, y }) },
  div: { type: 'DIV', factory: (x, y) => ({ x, y }) },
  nope: { type: 'NOPE', factory() {} },
};

const eventOf = (emitter, event) =>
  new Promise(resolve => emitter.once(event, resolve));

let _serverPort = 45610;
const getPort = () => _serverPort++;

test.beforeEach(t => {
  t.context.port = getPort();
  t.context.url = `http://localhost:${t.context.port}`;
});

test('[System] Trivial usage', async t => {
  const { port, url } = t.context;
  const server = new Server(serverApp);
  await new Promise(resolve => server.listen(port, resolve));
  const client = new Client(url, clientMethods);
  t.is(await client.add(3, 5), 8);
  try {
    await client.div(3, 0);
    t.fail('Should fail...');
  } catch (err) {
    t.is(err.message, 'Zero div');
  }
  try {
    await client.nope();
    t.fail('Should fail...');
  } catch (err) {
    t.is(err.message, 'Unknown request type NOPE');
  }
});

test('[System] Bare client', async t => {
  const { port, url } = t.context;
  const server = new Server(serverApp);
  await new Promise(resolve => server.listen(port, resolve));
  const client = new Client(url);
  t.is(await client.dispatch('ADD', {x: 3, y: 5}), 8);
});

test('[System] Healthcheck test', async t => {
  const { port, url } = t.context;
  let isHealthy = true;
  const healthCheck = () => (isHealthy ?
    (isHealthy === 'timeout' ?
      new Promise(resolve => setTimeout(resolve, 100)) :
      Promise.resolve()) :
    Promise.reject());
  const server = new Server(serverApp, healthCheck);
  await new Promise(resolve => server.listen(port, resolve));
  const client = new Client(url, clientMethods);
  await client.ping(200);
  isHealthy = false;
  try {
    await client.ping(200);
    t.fail('Ping should have failed');
  } catch (e) {
    t.pass('Ping failed');
  }
  isHealthy = 'timeout';
  try {
    await client.ping(50);
    t.fail('Ping should have failed with timeout');
  } catch (e) {
    t.is(e.message, 'Timeout error');
  }
});

test('[System] server down errors', async t => {
  const { url } = t.context;
  const client = new Client(url, clientMethods);
  const rejected = client.add(1, 2);
  await eventOf(client, 'error');
  try {
    await rejected;
    t.fail('Should have failed');
  } catch (e) {
    t.is(e.code, 'ECONNREFUSED');
  }
});

test('[System] Middleware test', async t => {
  const { port, url } = t.context;
  let counter = 0;
  const server = new Server(serverApp, undefined, [
    (req, res, next) => {
      counter++;
      next();
    },
  ]);
  server.api((req, next) => {
    req.payload.x = 5;
    return next(req);
  });
  server.api((req, next, OK, ERR) => {
    const { x, y } = req.payload;
    if (x == null || y == null) {
      return Promise.reject(0);
    }
    return x * y;
  });
  await new Promise(resolve => server.listen(port, resolve));
  const client = new Client(url, clientMethods);
  t.is(await client.add(3, 5), 25);
  try {
    await client.add(3);
    t.fail('Should have failed');
  } catch (e) {
    t.is(e, 0);
  }
  t.is(counter, 2);
});

test('[System] Server shoutdown', async t => {
  const { port, url } = t.context;
  const server = new Server(serverApp);
  await new Promise(resolve => server.listen(port, resolve));
  const client = new Client(url, clientMethods);
  t.is(await client.add(3, 5), 8);
  await new Promise(resolve => server.close(resolve));
  const rejected = client.add(1, 2);
  await eventOf(client, 'error');
  try {
    await rejected;
    t.fail('Should have failed');
  } catch (e) {
    t.is(e.code, 'ECONNREFUSED');
  }
});
