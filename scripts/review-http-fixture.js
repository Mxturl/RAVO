#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");

const portFile = process.argv[2];
const stateFile = process.argv[3] || "";
if (!portFile) throw new Error("Usage: review-http-fixture.js <port-file>");
const counters = {};

function record(route) {
  counters[route] = (counters[route] || 0) + 1;
  if (stateFile) fs.writeFileSync(stateFile, `${JSON.stringify(counters, null, 2)}\n`, { mode: 0o600 });
  return counters[route];
}

function reviewer(label) {
  return {
    summary: `${label} completed`,
    findings: [{
      title: `${label} finding`,
      severity: "medium",
      evidence: "The local HTTP fixture returned a structured final response.",
      mechanismRisk: "Streaming failures can otherwise be mistaken for usable Review evidence.",
      recommendation: "Keep transport and semantic completion independently observable."
    }]
  };
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function sendSse(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function responsesResult(label, usage = { input_tokens: 40, output_tokens: 20, total_tokens: 60 }) {
  return { status: "completed", output_text: JSON.stringify(reviewer(label)), usage };
}

function chatResult(label, usage = { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }) {
  return { choices: [{ message: { content: JSON.stringify(reviewer(label)) }, finish_reason: "stop" }], usage };
}

const server = http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch (_error) { /* Invalid request bodies use defaults. */ }
    const route = request.url || "";
    const routeAttempt = record(route);

    if (route.includes("auto-responses")) {
      if (Object.prototype.hasOwnProperty.call(payload, "max_output_tokens")) {
        sendJson(response, { error: { message: "auto responses request must omit max_output_tokens" } }, 422);
      } else {
        sendJson(response, responsesResult("auto responses"));
      }
      return;
    }

    if (route.includes("fixed-responses")) {
      if (payload.max_output_tokens !== 12345) {
        sendJson(response, { error: { message: "fixed responses request requires max_output_tokens=12345" } }, 422);
      } else {
        sendJson(response, responsesResult("fixed responses"));
      }
      return;
    }

    if (route.includes("auto-chat")) {
      if (Object.prototype.hasOwnProperty.call(payload, "max_tokens")) {
        sendJson(response, { error: { message: "auto chat request must omit max_tokens" } }, 422);
      } else {
        sendJson(response, chatResult("auto chat"));
      }
      return;
    }

    if (route.includes("fixed-chat")) {
      if (payload.max_tokens !== 12345) {
        sendJson(response, { error: { message: "fixed chat request requires max_tokens=12345" } }, 422);
      } else {
        sendJson(response, chatResult("fixed chat"));
      }
      return;
    }

    if (route.includes("auto-truncation")) {
      if (!Object.prototype.hasOwnProperty.call(payload, "max_output_tokens")) {
        sendJson(response, {
          status: "incomplete",
          incomplete_details: { reason: "provider_default_limit" },
          output_text: JSON.stringify(reviewer("auto truncated")),
          usage: { input_tokens: 40, output_tokens: 2048, total_tokens: 2088 }
        });
      } else if (payload.max_output_tokens === 48000) {
        sendJson(response, responsesResult("auto truncation fallback", { input_tokens: 40, output_tokens: 3000, total_tokens: 3040 }));
      } else {
        sendJson(response, { error: { message: "unexpected fallback max_output_tokens" } }, 422);
      }
      return;
    }

    if (route.includes("fixed-low-truncation")) {
      if (payload.max_output_tokens === 64) {
        sendJson(response, {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output_text: JSON.stringify(reviewer("fixed low truncated")),
          usage: { input_tokens: 40, output_tokens: 64, total_tokens: 104 }
        });
      } else if (payload.max_output_tokens === 48000) {
        sendJson(response, responsesResult("fixed low fallback", { input_tokens: 40, output_tokens: 3000, total_tokens: 3040 }));
      } else {
        sendJson(response, { error: { message: "unexpected fixed fallback max_output_tokens" } }, 422);
      }
      return;
    }

    if (route.includes("transport-retry-three")) {
      if (routeAttempt <= 3) sendJson(response, { error: { message: `retryable transport failure ${routeAttempt}` } }, 503);
      else sendJson(response, responsesResult("transport retry recovered"));
      return;
    }

    if (route.includes("semantic-retry-three")) {
      if (routeAttempt <= 3) sendJson(response, { status: "completed", output_text: JSON.stringify({ summary: `invalid semantic response ${routeAttempt}`, findings: [] }) });
      else sendJson(response, responsesResult("semantic retry recovered"));
      return;
    }

    if (route.includes("token-required")) {
      if (!Object.prototype.hasOwnProperty.call(payload, "max_output_tokens")) {
        sendJson(response, { error: { message: "max_output_tokens is required by this provider" } }, 400);
      } else if (payload.max_output_tokens === 48000) {
        sendJson(response, responsesResult("required token fallback"));
      } else {
        sendJson(response, { error: { message: "max_output_tokens must use the configured fallback" } }, 422);
      }
      return;
    }

    if (route.includes("large-response")) {
      sendJson(response, {
        ...responsesResult("large response", { input_tokens: 40, output_tokens: 20, total_tokens: 60 }),
        padding: "x".repeat((10 * 1024 * 1024) + 1024)
      });
      return;
    }

    if (route.includes("stream-fallback")) {
      if (payload.stream) {
        sendJson(response, { error: "stream unsupported" }, 415);
      } else {
        sendJson(response, { status: "completed", output_text: JSON.stringify(reviewer("stream fallback")) });
      }
      return;
    }

    if (route.includes("first-event-timeout")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      setTimeout(() => {
        if (response.destroyed) return;
        sendSse(response, { type: "response.completed", response: { status: "completed", output_text: JSON.stringify(reviewer("late event")) } });
        response.end();
      }, 250);
      return;
    }

    if (route.includes("first-content-timeout")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      const interval = setInterval(() => {
        if (response.destroyed) {
          clearInterval(interval);
          return;
        }
        sendSse(response, { type: "response.reasoning.delta", delta: "still reasoning" });
      }, 20);
      setTimeout(() => {
        clearInterval(interval);
        if (response.destroyed) return;
        sendSse(response, { type: "response.completed", response: { status: "completed", output_text: JSON.stringify(reviewer("late content")) } });
        response.end();
      }, 250);
      return;
    }

    if (route.includes("idle-timeout") && !route.includes("partial-idle-timeout")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      sendSse(response, { type: "response.reasoning.delta", delta: "first event" });
      setTimeout(() => {
        if (response.destroyed) return;
        sendSse(response, { type: "response.completed", response: { status: "completed", output_text: JSON.stringify(reviewer("late idle")) } });
        response.end();
      }, 250);
      return;
    }

    if (route.includes("heartbeat-idle-timeout")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      sendSse(response, { type: "response.created", response: { id: "fixture" } });
      const interval = setInterval(() => {
        if (response.destroyed) {
          clearInterval(interval);
          return;
        }
        sendSse(response, { type: "provider.heartbeat" });
      }, 20);
      setTimeout(() => {
        clearInterval(interval);
        if (response.destroyed) return;
        sendSse(response, { type: "response.completed", response: { status: "completed", output_text: JSON.stringify(reviewer("late heartbeat")) } });
        response.end();
      }, 250);
      return;
    }

    if (route.includes("partial-idle-timeout") || route.includes("partial-total-timeout")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      sendSse(response, { type: "response.output_text.delta", delta: "partial content" });
      return;
    }

    if (route.includes("total-timeout")) {
      setTimeout(() => {
        if (!response.destroyed) sendJson(response, { status: "completed", output_text: JSON.stringify(reviewer("late total")) });
      }, 250);
      return;
    }

    sendJson(response, { status: "completed", output_text: JSON.stringify(reviewer("default")) });
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  fs.writeFileSync(portFile, `${address.port}\n`, { mode: 0o600 });
  if (stateFile) fs.writeFileSync(stateFile, `${JSON.stringify(counters, null, 2)}\n`, { mode: 0o600 });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
