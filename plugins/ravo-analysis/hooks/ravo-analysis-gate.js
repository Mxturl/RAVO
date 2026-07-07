#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function readJsonStdin(callback) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      callback(JSON.parse(input.replace(/^\uFEFF/, "")));
    } catch (_err) {
      callback({});
    }
  });
}

function shortTitle(prompt, kind) {
  return String(prompt || kind)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48) || kind;
}

function writeArtifact(cwd, kind, prompt) {
  const script = path.join(__dirname, "..", "scripts", "write-analysis-artifact.js");
  const args = [
    script,
    "--workspace", cwd,
    "--type", kind,
    "--status", "draft",
    "--title", shortTitle(prompt, kind),
    "--conclusion", "Pending RAVO analysis artifact created from natural prompt trigger."
  ];
  if (kind === "root-cause") {
    args.push("--symptom", shortTitle(prompt, kind));
  }
  const child = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  try {
    return JSON.parse(String(child.stdout || "{}")).artifactPath || "";
  } catch (_err) {
    return "";
  }
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function classify(prompt) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();
  const noCodeYet = /(先别开发|先不要开发|先不要改代码|不要急着写代码|before implementation|do not implement yet)/i.test(text);

  const rootCause = matchesAny(text, [
    /根因|机制根因|五个\s*why|5\s*why|为什么.*为什么|防复发|复发风险/,
    /symptom|proximate cause|mechanism root cause|root cause|why chain/i
  ]);
  if (rootCause) return "root-cause";

  const requirement = matchesAny(text, [
    /需求|方案|架构|产品|用户是谁|消费者|目标是什么|边界|风险|权衡|推荐方案|采用成本|维护风险/,
    /requirement|solution|architecture|consumer|tradeoff|constraints?|risk|proposal/i
  ]);
  if (requirement && noCodeYet) return "requirement";
  if (requirement && text.length > 80) return "requirement";
  return "";
}

readJsonStdin((data) => {
  const kind = classify(data.prompt);
  if (!kind) {
    process.stdout.write("{}");
    return;
  }

  const skill = kind === "root-cause" ? "ravo-root-cause-analysis" : "ravo-requirement-analysis";
  const cwd = data.cwd || process.cwd();
  const artifactPath = writeArtifact(cwd, kind, data.prompt);
  const contract = kind === "root-cause"
    ? "Required headings: Symptom, Proximate Cause, Alternative Hypotheses, Mechanism Root Cause, Why Chain, Boundary, Smallest Fix, Verification. Test at least one plausible alternative before locking the root cause."
    : "Required headings: Goal, Consumer, Constraints, Facts, Options, Challenge, Derived Conclusion, Validation. Include at least two options with tradeoffs, separate facts from assumptions, and do not start implementation before the analysis conclusion.";

  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_ANALYSIS_GATE:ADVISORY",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        `RAVO analysis trigger matched: ${kind}.`,
        `Prefer skill: ${skill}.`,
        artifactPath ? `RAVO analysis artifact created: ${artifactPath}` : "RAVO analysis artifact should be created under knowledge/.ravo/analysis.",
        contract,
        "If the task is trivial or clearly implementation-only, ignore this advisory."
      ].join("\n")
    }
  }));
});
