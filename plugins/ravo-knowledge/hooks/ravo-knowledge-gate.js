#!/usr/bin/env node

function readStdin(callback) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try { callback(JSON.parse(input.replace(/^\uFEFF/, ""))); }
    catch (_err) { callback({}); }
  });
}

function explicitKnowledge(prompt) {
  return /(类似|以前|经验|教训|知识|复用|沉淀|复盘|remember|knowledge|lesson|learned|again|踩坑)/i.test(String(prompt || ""));
}

function mediumComplexity(prompt) {
  const text = String(prompt || "");
  if (/^(什么是|解释一下|怎么读|翻译|改个颜色|rename|what is)\b/i.test(text.trim())) return false;
  if (text.length < 28 && !/(架构|方案|规划|验收|评审|长程|升级|根因|需求)/.test(text)) return false;
  return /(架构|方案|规划|验收|评审|发布|发版|长程|升级|插件|治理|需求|根因|设计|开始做|从哪里开始|不要直接写代码|architecture|planning|review|acceptance|release|long-running)/i.test(text);
}

function closeout(message) {
  return /(完成|做完|交付|验收|发版|总结|复盘|经验|教训|closeout|done|completed|release)/i.test(String(message || ""));
}

function userInput(prompt) {
  const text = String(prompt || "");
  const match = text.match(/<input>([\s\S]*?)<\/input>/);
  return (match ? match[1] : text).trim();
}

readStdin((data) => {
  const prompt = userInput(data.prompt || "");
  const lastMessage = data.last_assistant_message || data.lastAssistantMessage || "";
  const stopAdvisory = !prompt && closeout(lastMessage);
  if (!explicitKnowledge(prompt) && !mediumComplexity(prompt) && !stopAdvisory) {
    process.stdout.write("{}");
    return;
  }
  if (stopAdvisory) {
    process.stdout.write(JSON.stringify({
      systemMessage: "RAVO_KNOWLEDGE_CLOSEOUT_ADVISORY"
    }));
    return;
  }
  process.stdout.write(JSON.stringify({
    systemMessage: "RAVO_KNOWLEDGE:ADVISORY",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        explicitKnowledge(prompt) ? "RAVO knowledge capture/reuse may apply." : "This medium/high-complexity task may need prior RAVO knowledge.",
        "Retrieve workspace knowledge before answering, and include user-level lessons only after explicit opt-in.",
        "If relevant knowledge is found, state what was applied and what was not applicable.",
        "For knowledge capture/reuse prompts, only write, retrieve, or apply knowledge. Do not modify product/source/docs outside RAVO knowledge artifacts unless the user explicitly asks.",
        "For closeout capture, the Agent must provide the actual summary; hooks must not invent hidden conversation content.",
        "If knowledge is written or proposed, the final visible reply must include the workspace-local path and whether user-level global knowledge writing was disabled or explicitly enabled."
      ].join("\n")
    }
  }));
});
