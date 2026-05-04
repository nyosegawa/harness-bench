#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm install --ignore-scripts
fi

cat > .benchmark-hidden-connect-timeout-regression.mjs <<'JSEOF'
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

const controller = new AbortController();
const agent = new HangingConnectAgent();
const request = axios.get('http://connect-timeout.hidden/', {
  httpAgent: agent,
  maxRedirects: 0,
  proxy: false,
  signal: controller.signal,
  timeout: 0,
}).catch(error => error);

try {
  await new Promise(resolve => setTimeout(resolve, 50));
  controller.abort();
  const error = await request;
  assert.equal(error.code, AxiosError.ERR_CANCELED);
} finally {
  controller.abort();
  agent.destroy();
}
JSEOF

node .benchmark-hidden-connect-timeout-regression.mjs
