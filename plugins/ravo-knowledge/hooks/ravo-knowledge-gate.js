#!/usr/bin/env node

function readStdin(callback) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try { callback(JSON.parse(input.replace(/^\uFEFF/, ""))); }
    catch (_err) { callback({}); }
  });
}

function wantsKnowledge(prompt) {
  return /(类似|以前|经验|教训|知识|复用|knowledge|lesson|learned|again|踩坑)/i.test(String(prompt || ""));
}

readStdin((data) => {
  if (!wantsKnowledge(data.prompt)) {
    process.stdout.write("{}");
    return;
  }
  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_KNOWLEDGE:ADVISORY",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        "RAVO knowledge may apply.",
        "Retrieve workspace knowledge before answering, and include user-level lessons only after explicit opt-in.",
        "State which knowledge was applied and which was not applicable if it materially affects the result."
      ].join("\n")
    }
  }));
});
