/**
 * Local preview: `node dev/server.js` then open http://localhost:8765
 * Runs the real .gs code against an in-memory sheet. Data resets on restart.
 */
const http = require('http');
const { createEnv, renderIndex } = require('./fake-gas');

const env = createEnv();
const ALLOWED = ['apiLoad', 'apiOps', 'apiLoadDemo', 'apiInstallBackup'];

// Stand-in for google.script.* inside the page.
const SHIM = `<script>
window.google = { script: {
  get run() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var api = {
      withSuccessHandler: function (f) { ok = f; return api; },
      withFailureHandler: function (f) { fail = f; return api; }
    };
    ${JSON.stringify(ALLOWED)}.forEach(function (fn) {
      api[fn] = function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: fn, args: args }) })
          .then(function (r) { return r.json(); })
          .then(function (r) { if (r.error) fail(new Error(r.error)); else ok(r.result); }, fail);
      };
    });
    return api;
  },
  history: {
    push: function (s, p, hash) { history.pushState(null, '', '#' + hash); },
    replace: function (s, p, hash) { history.replaceState(null, '', '#' + hash); },
    setChangeHandler: function (f) { window.addEventListener('popstate', function () { f({ location: { hash: location.hash.slice(1) } }); }); }
  },
  url: { getLocation: function (f) { f({ hash: location.hash.slice(1) }); } }
} };
</script>`;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      let out;
      try {
        const { fn, args } = JSON.parse(body);
        if (!ALLOWED.includes(fn)) throw new Error('Unknown function');
        if (process.env.FAIL_OPS && fn === 'apiOps') throw new Error('Simulated failure');
        out = { result: env.call(fn, args) };
      } catch (e) {
        out = { error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderIndex(SHIM));
});

const port = process.env.PORT || 8765;
server.listen(port, () => console.log('Job Cost Tracker preview on http://localhost:' + port));
module.exports = { server, env };
