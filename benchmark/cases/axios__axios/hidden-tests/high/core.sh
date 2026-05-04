#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm install --ignore-scripts
fi

cat > .benchmark-hidden-connect-timeout-core.mjs <<'JSEOF'
import assert from 'node:assert/strict';
import http from 'node:http';
import stream from 'node:stream';
import axios from './index.js';
import AxiosError from './lib/core/AxiosError.js';

class HangingConnectSocket extends stream.Duplex {
  constructor() {
    super();
    this.connecting = true;
  }
  _read() {}
  _write(_chunk, _encoding, callback) {
    callback();
  }
  setKeepAlive() {
    return this;
  }
  setNoDelay() {
    return this;
  }
  setTimeout() {
    return this;
  }
}

class HangingConnectAgent extends http.Agent {
  createConnection() {
    return new HangingConnectSocket();
  }
}

const timeout = 100;
const guardTimeout = 1200;
const controller = new AbortController();
const agent = new HangingConnectAgent();
let guardTimer;
const request = axios.get('http://connect-timeout.hidden/', {
  httpAgent: agent,
  maxRedirects: 0,
  proxy: false,
  signal: controller.signal,
  timeout,
});
const guard = new Promise((_resolve, reject) => {
  guardTimer = setTimeout(() => {
    controller.abort();
    reject(new Error('request did not honor timeout during TCP connect'));
  }, guardTimeout);
});

try {
  await assert.rejects(Promise.race([request, guard]), error => {
    assert.equal(error.code, AxiosError.ECONNABORTED);
    assert.equal(error.message, `timeout of ${timeout}ms exceeded`);
    return true;
  });
} finally {
  clearTimeout(guardTimer);
  controller.abort();
  agent.destroy();
}
JSEOF

node .benchmark-hidden-connect-timeout-core.mjs
