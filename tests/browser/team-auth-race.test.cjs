// Focused component regression checks; no live Supabase calls or application build.
// Install the isolated test tools without changing this repository's dependencies:
// npm install --prefix /tmp/fruitroom-auth-regression --no-save --package-lock=false react@19.2.0 react-test-renderer@19.2.0 typescript@5.9.3
// AUTH_TEST_NODE_MODULES=/tmp/fruitroom-auth-regression/node_modules node --test tests/browser/team-auth-race.test.cjs
// Optional: AUTH_SOURCE=/absolute/path/to/team-auth.tsx tests a baseline or another copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const testRequire = name => require(require.resolve(name, {
  paths: process.env.AUTH_TEST_NODE_MODULES ? [path.resolve(process.env.AUTH_TEST_NODE_MODULES)] : [__dirname],
}));
const ts = testRequire('typescript');
const React = testRequire('react');
const Renderer = testRequire('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const sourceFile = process.env.AUTH_SOURCE || path.resolve(__dirname, '../../components/team-auth.tsx');
const compiled = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
  fileName: 'team-auth.tsx',
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true},
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(r => {resolve = r;});
  return {promise, resolve};
}

async function harness() {
  const reads = [], queries = [], writes = [], timers = new Map();
  let authCallback, timerId = 0, currentSession = null, root;
  const client = {
    auth: {
      getUser() {const d = deferred(); reads.push(d); return d.promise;},
      onAuthStateChange(callback) {authCallback = callback; return {data: {subscription: {unsubscribe() {authCallback = undefined;}}}};},
      async signOut() {authCallback?.('SIGNED_OUT', null); return {error: null};},
    },
    from(table) {
      return {
        select() {return this;},
        eq(_column, id) {this.id = id; return this;},
        maybeSingle() {const d = deferred(); queries.push({table, id: this.id, ...d}); return d.promise;},
        upsert(value) {const d = deferred(); writes.push({value, ...d}); return d.promise;},
      };
    },
  };
  const module = {exports: {}};
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      if (name === 'next/dynamic') return () => props => React.createElement('landing', props);
      if (name === 'lucide-react') return {Loader2: () => null};
      if (name === '@/lib/supabase-browser') return {supabaseBrowser: () => client};
      return testRequire(name);
    },
    setTimeout(fn) {const id = ++timerId; timers.set(id, fn); return id;},
    clearTimeout(id) {timers.delete(id);},
    window: {location: {pathname: '/', search: ''}, scrollTo() {}},
    console, Date, URLSearchParams,
  }, {filename: sourceFile});
  const {default: TeamAuth, useTeamSession} = module.exports;
  function Probe() {
    currentSession = useTeamSession();
    return React.createElement('session', {user: currentSession?.userId, name: currentSession?.profile.name, team: currentSession?.isTeam});
  }
  await Renderer.act(async () => {root = Renderer.create(React.createElement(TeamAuth, null, React.createElement(Probe)));});
  async function act(fn) {await Renderer.act(async () => {await fn?.(); await Promise.resolve();});}
  async function resolveUser(index, id) {
    await act(() => reads[index].resolve({data: {user: id ? {id, email: `${id}@example.test`, user_metadata: {}} : null}, error: null}));
  }
  async function resolveProfile(id, name = id, team = false) {
    await act(() => {
      for (const q of queries.filter(q => q.id === id && !q.done)) {
        q.done = true;
        q.resolve({data: q.table === 'profiles' ? {name, affiliation: '', region: '', default_inputs: null} : team ? {user_id: id} : null, error: null});
      }
    });
  }
  async function emit(event, id) {await act(() => authCallback(event, id ? {user: {id}} : null));}
  async function flushTimers() {await act(() => {const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());});}
  async function signIn(id) {
    await emit('SIGNED_IN', id); await flushTimers();
    await resolveUser(reads.length - 1, id); await resolveProfile(id);
  }
  return {
    reads, queries, writes, timers, act, resolveUser, resolveProfile, emit, flushTimers, signIn,
    get session() {return currentSession;},
    get tree() {return root.toJSON();},
    async dispose() {await act(() => root.unmount());},
  };
}

test('late account A profile read cannot undo SIGNED_OUT', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A');
  await h.emit('SIGNED_OUT', null); await h.flushTimers();
  await h.resolveUser(1, null);
  await h.resolveProfile('A', 'Old A', true);
  assert.equal(h.tree.type, 'landing');
});

test('authentication event invalidates reads before its deferred reload starts', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A');
  await h.emit('SIGNED_OUT', null);
  await h.resolveProfile('A', 'Old A', true);
  assert.notEqual(h.tree.type, 'session');
});

test('late account A read cannot replace newly signed-in B', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A');
  await h.signIn('B');
  await h.resolveProfile('A', 'Old A', true);
  assert.equal(h.tree.props.user, 'B');
  assert.equal(h.tree.props.name, 'B');
  assert.equal(h.tree.props.team, false);
});

test('late account A profile save cannot replace account B profile', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A'); await h.resolveProfile('A');
  let save;
  await h.act(() => {save = h.session.saveProfile({name: 'Edited A'});});
  await h.signIn('B');
  await h.act(() => h.writes[0].resolve({error: null}));
  await save;
  assert.equal(h.tree.props.user, 'B');
  assert.equal(h.tree.props.name, 'B');
});

test('returning to the same account does not accept a save from its old session', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A'); await h.resolveProfile('A');
  let save;
  await h.act(() => {save = h.session.saveProfile({name: 'Old edit'});});
  await h.signIn('B'); await h.signIn('A');
  await h.act(() => h.writes[0].resolve({error: null}));
  await save;
  assert.equal(h.tree.props.name, 'A');
});

test('same-account token refresh still permits an outstanding profile save', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A'); await h.resolveProfile('A');
  let save;
  await h.act(() => {save = h.session.saveProfile({name: 'Edited A'});});
  await h.emit('TOKEN_REFRESHED', 'A'); await h.flushTimers();
  await h.resolveUser(1, 'A'); await h.resolveProfile('A');
  await h.act(() => h.writes[0].resolve({error: null}));
  assert.equal(await save, null);
  assert.equal(h.tree.props.user, 'A');
  assert.equal(h.tree.props.name, 'Edited A');
});

test('password recovery screen survives a same-account token refresh', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A'); await h.resolveProfile('A');
  await h.emit('PASSWORD_RECOVERY', 'A'); await h.flushTimers();
  await h.resolveUser(1, 'A'); await h.resolveProfile('A');
  await h.emit('TOKEN_REFRESHED', 'A'); await h.flushTimers();
  await h.resolveUser(2, 'A'); await h.resolveProfile('A');
  assert.equal(h.tree.type, 'landing');
  assert.equal(h.tree.props.recovery, true);
});

test('unmount cancels queued auth work', async () => {
  const h = await harness();
  await h.emit('SIGNED_IN', 'A');
  const before = h.reads.length;
  await h.dispose();
  await h.flushTimers();
  assert.equal(h.reads.length, before);
});

test('signOut cannot be undone by pending profile work', async t => {
  const h = await harness(); t.after(() => h.dispose());
  await h.resolveUser(0, 'A'); await h.resolveProfile('A');
  await h.emit('TOKEN_REFRESHED', 'A'); await h.flushTimers();
  await h.resolveUser(1, 'A');
  await h.act(() => h.session.signOut());
  await h.resolveProfile('A', 'Old A', true);
  assert.equal(h.tree.type, 'landing');
});
