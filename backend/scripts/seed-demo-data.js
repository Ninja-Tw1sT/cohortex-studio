#!/usr/bin/env node
/**
 * Seeds the shared demo namespace (ownerId: null) with agents, crews, and
 * pre-recorded replay runs, so the app has content and a working "replay"
 * demo out of the box — no LLM backend or API keys required to see it run.
 *
 * Usage: node scripts/seed-demo-data.js
 * Env:   MONGODB_URI (defaults to mongodb://127.0.0.1:27017/cohortex_studio)
 */
require("dotenv").config();
const { connectDb, disconnectDb } = require("../src/config/db");
const Agent = require("../src/models/Agent");
const Crew = require("../src/models/Crew");
const CrewTemplate = require("../src/models/CrewTemplate");
const Run = require("../src/models/Run");
const Tool = require("../src/models/Tool");
const { PALETTE } = require("../src/util/palette");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/cohortex_studio";

const AGENTS = [
  {
    name: "researcher",
    role: "Research Analyst",
    goal: "gather the key facts and cite the reasoning behind them",
    backend: "ollama",
    model: "phi3:mini",
    temperature: 0.2,
    tools: ["calculator"],
    vaults: [],
    color: PALETTE[0],
  },
  {
    name: "writer",
    role: "Technical Writer",
    goal: "turn raw research into clear, well-structured prose",
    backend: "ollama",
    model: "phi3:mini",
    temperature: 0.5,
    tools: [],
    vaults: [],
    color: PALETTE[1],
  },
  {
    name: "critic",
    role: "Critic",
    goal: "review a draft for accuracy, gaps, and clarity, then suggest fixes",
    backend: "ollama",
    model: "phi3:mini",
    temperature: 0.3,
    tools: [],
    vaults: [],
    color: PALETTE[2],
  },
  {
    name: "planner",
    role: "Planner / Supervisor",
    goal: "break a task into subtasks and route each to the right specialist",
    backend: "ollama",
    model: "phi3:mini",
    temperature: 0.2,
    tools: [],
    vaults: [],
    color: PALETTE[3],
  },
  {
    name: "coder",
    role: "Software Engineer",
    goal: "write small, correct, well-commented example code",
    backend: "ollama",
    model: "qwen2.5-coder:7b",
    temperature: 0.1,
    tools: ["calculator", "word_count"],
    vaults: [],
    color: PALETTE[4],
  },
  {
    name: "summarizer",
    role: "Summarizer",
    goal: "condense a longer answer into a short executive summary",
    backend: "ollama",
    model: "phi3:mini",
    temperature: 0.3,
    tools: ["word_count"],
    vaults: [],
    color: PALETTE[5],
  },
];

// The Tool Shed catalog — every agent's `tools` above must name one of these.
const TOOLS = [
  { name: "calculator", description: "Evaluate a basic arithmetic expression, e.g. '23 * (4 + 1)'." },
  { name: "word_count", description: "Count the words in a string." },
];

const CREWS = [
  {
    name: "research_pipeline",
    topology: "sequential",
    agentNames: ["researcher", "writer", "critic"],
    supervisorName: null,
    maxRounds: 4,
  },
  {
    name: "dev_squad",
    topology: "supervisor",
    agentNames: ["coder", "writer", "critic"],
    supervisorName: "planner",
    maxRounds: 4,
  },
];

// Starter crews for common workflows, seeded into the shared demo namespace
// so they show up in the wizard for every visitor. "tools" here are what get
// pre-checked when the wizard proposes each agent — still toggleable per use.
const CREW_TEMPLATES = [
  {
    name: "software_dev_crew",
    description: "Architect designs, engineer implements, reviewer checks the work.",
    topology: "sequential",
    agents: [
      { name: "architect", role: "Software Architect", goal: "design a clear, minimal implementation plan for the requested feature, calling out key files/interfaces to change", tools: [] },
      { name: "engineer", role: "Software Engineer", goal: "implement the plan with small, correct, well-tested code changes", tools: ["calculator"] },
      { name: "reviewer", role: "Code Reviewer", goal: "review the implementation for correctness, security, and simplicity, and list concrete fixes", tools: [] },
    ],
  },
  {
    name: "security_research_crew",
    description: "Threat modeling, vulnerability analysis, and a prioritized findings report — for authorized research and defensive use.",
    topology: "sequential",
    agents: [
      { name: "threat_modeler", role: "Threat Modeler", goal: "identify the most likely attack surfaces and threat scenarios for the described system, for defensive research purposes", tools: [] },
      { name: "vuln_analyst", role: "Vulnerability Analyst", goal: "analyze the described system or code for known vulnerability classes and explain the risk and impact of each", tools: [] },
      { name: "security_report_writer", role: "Security Report Writer", goal: "summarize findings into a clear, prioritized report with remediation recommendations", tools: ["word_count"] },
    ],
  },
  {
    name: "web_design_crew",
    description: "UX research, UI design direction, and an accessibility pass.",
    topology: "sequential",
    agents: [
      { name: "ux_researcher", role: "UX Researcher", goal: "define user needs, goals, and key flows for the requested page or product", tools: [] },
      { name: "ui_designer", role: "UI Designer", goal: "propose a clear visual layout, component structure, and styling direction", tools: [] },
      { name: "accessibility_reviewer", role: "Accessibility Reviewer", goal: "review the design for accessibility issues (contrast, semantics, keyboard navigation) and list fixes", tools: [] },
    ],
  },
  {
    name: "reversing_crew",
    description: "Static and dynamic analysis of a sample, then a technical report — for authorized malware/software research.",
    topology: "sequential",
    agents: [
      { name: "static_analyst", role: "Static Analysis Engineer", goal: "describe what a piece of compiled code likely does based on structure, strings, and imports, without executing it", tools: [] },
      { name: "dynamic_analyst", role: "Dynamic Analysis Engineer", goal: "describe expected runtime behavior and how to safely observe it in an isolated sandbox", tools: [] },
      { name: "re_report_writer", role: "Reverse Engineering Report Writer", goal: "summarize findings into a clear technical report suitable for defenders or researchers", tools: ["word_count"] },
    ],
  },
  {
    name: "osint_crew",
    description: "Gather, verify, and synthesize publicly available information into a sourced summary.",
    topology: "sequential",
    agents: [
      { name: "osint_researcher", role: "OSINT Researcher", goal: "gather and organize publicly available information relevant to the request from the provided context", tools: [] },
      { name: "source_verifier", role: "Source Verifier", goal: "assess the credibility and recency of each piece of information and flag anything unverified", tools: [] },
      { name: "intel_synthesizer", role: "Intelligence Synthesizer", goal: "synthesize verified findings into a clear, sourced summary", tools: ["word_count"] },
    ],
  },
];

const REPLAY_RUNS = [
  {
    crewName: "research_pipeline",
    mode: "replay",
    task: "Explain why vector databases matter for AI applications",
    result: {
      steps: [
        {
          agent: "researcher",
          output:
            "Key facts: (1) LLMs have no long-term memory between calls — vector DBs give them one. " +
            "(2) Embeddings turn text/images into fixed-length vectors where semantic similarity maps to " +
            "geometric closeness. (3) Approximate nearest-neighbor indexes (HNSW, IVF) make similarity search " +
            "fast at millions-of-vectors scale, which exact search can't do in real time. (4) This underlies " +
            "RAG: retrieve relevant chunks, then let the model reason over them instead of the whole corpus.",
        },
        {
          agent: "writer",
          output:
            "Vector databases matter for AI applications because they solve a problem large language models " +
            "can't solve on their own: remembering and retrieving specific knowledge. An LLM's context window is " +
            "finite and its training data is frozen at a point in time, so it can't natively answer questions " +
            "about your private documents or yesterday's data. A vector database closes that gap. It stores " +
            "embeddings — numeric fingerprints of meaning — and lets you ask \"what's semantically similar to " +
            "this?\" in milliseconds, even across millions of records. That's the retrieval half of " +
            "retrieval-augmented generation (RAG): fetch the few passages that actually matter, hand them to the " +
            "model as context, and get an answer grounded in real, current, private data instead of guesswork.",
        },
        {
          agent: "critic",
          output:
            "Accurate and clear. One addition worth making: mention the tradeoff — approximate nearest-neighbor " +
            "search trades a small amount of recall for large gains in speed, which is why it's \"approximate\" " +
            "and not exact search. Otherwise this is ready to ship.",
        },
      ],
      output:
        "Vector databases matter for AI applications because they give LLMs a working memory. Embeddings encode " +
        "meaning as vectors, and fast approximate nearest-neighbor search lets an application retrieve exactly the " +
        "passages relevant to a query out of millions of candidates in milliseconds. That retrieval step is what " +
        "powers RAG — grounding a model's answer in real, current, private data instead of relying purely on what " +
        "it memorized during training. The tradeoff is approximate (not exact) search, which is a small recall " +
        "cost in exchange for the speed that makes real-time retrieval possible at scale.",
    },
  },
  {
    crewName: "dev_squad",
    mode: "replay",
    task: "Write a Python function that scores text similarity using embeddings, then explain it simply",
    result: {
      steps: [
        {
          agent: "planner",
          output:
            "Plan: (1) coder writes a small cosine-similarity function over two embedding vectors, " +
            "(2) writer explains it in plain language, (3) critic checks the code and the explanation for " +
            "correctness before we finalize.",
        },
        {
          agent: "coder",
          output:
            "def text_similarity(vec_a: list[float], vec_b: list[float]) -> float:\n" +
            '    """Cosine similarity between two embedding vectors, in [-1, 1]."""\n' +
            "    dot = sum(a * b for a, b in zip(vec_a, vec_b))\n" +
            "    norm_a = sum(a * a for a in vec_a) ** 0.5\n" +
            "    norm_b = sum(b * b for b in vec_b) ** 0.5\n" +
            "    if norm_a == 0 or norm_b == 0:\n" +
            "        return 0.0\n" +
            "    return dot / (norm_a * norm_b)",
        },
        {
          agent: "writer",
          output:
            "In plain terms: embed both pieces of text into vectors (numbers that capture meaning), then measure " +
            "the angle between them. Cosine similarity ignores length and only cares about direction — two " +
            "vectors pointing the same way score close to 1 (very similar meaning), perpendicular vectors score " +
            "near 0 (unrelated), and opposite vectors score near -1 (opposite meaning). That's why it's the " +
            "standard metric for comparing embeddings.",
        },
        {
          agent: "critic",
          output:
            "Code is correct and handles the zero-vector edge case. Explanation is accurate. Ready to finalize — " +
            "no changes needed.",
        },
      ],
      output:
        "def text_similarity(vec_a, vec_b) -> float:  # cosine similarity, handles zero vectors\n" +
        "    dot = sum(a * b for a, b in zip(vec_a, vec_b))\n" +
        "    norm_a, norm_b = sum(a*a for a in vec_a) ** 0.5, sum(b*b for b in vec_b) ** 0.5\n" +
        "    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0\n\n" +
        "This measures the angle between two embedding vectors: 1 means near-identical meaning, 0 means " +
        "unrelated, -1 means opposite. It's the standard way to compare embeddings because it ignores vector " +
        "length and isolates direction, which is where the semantic signal lives.",
    },
  },
];

async function upsertAgent(a) {
  return Agent.findOneAndUpdate(
    { ownerId: null, name: a.name },
    { ownerId: null, ...a },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertTool(t) {
  return Tool.findOneAndUpdate(
    { ownerId: null, name: t.name },
    { ownerId: null, ...t },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertCrew(c) {
  return Crew.findOneAndUpdate(
    { ownerId: null, name: c.name },
    { ownerId: null, ...c },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertCrewTemplate(t) {
  return CrewTemplate.findOneAndUpdate(
    { ownerId: null, name: t.name },
    { ownerId: null, ...t },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seedReplayRun(r) {
  // Demo replay runs aren't unique-indexed, so clear prior seeded copies for
  // this crew+task before inserting a fresh one — keeps re-runs idempotent.
  await Run.deleteMany({ ownerId: null, mode: "replay", crewName: r.crewName, task: r.task });
  return Run.create({
    ownerId: null,
    crewName: r.crewName,
    task: r.task,
    mode: "replay",
    status: "done",
    result: r.result,
    startedAt: new Date(),
    finishedAt: new Date(),
  });
}

async function main() {
  await connectDb(MONGODB_URI);

  const tools = await Promise.all(TOOLS.map(upsertTool));
  console.log(`tools: upserted ${tools.length} (${tools.map((t) => t.name).join(", ")})`);

  const agents = await Promise.all(AGENTS.map(upsertAgent));
  console.log(`agents: upserted ${agents.length} (${agents.map((a) => a.name).join(", ")})`);

  const crews = await Promise.all(CREWS.map(upsertCrew));
  console.log(`crews: upserted ${crews.length} (${crews.map((c) => c.name).join(", ")})`);

  const crewTemplates = await Promise.all(CREW_TEMPLATES.map(upsertCrewTemplate));
  console.log(`crew templates: upserted ${crewTemplates.length} (${crewTemplates.map((t) => t.name).join(", ")})`);

  const runs = await Promise.all(REPLAY_RUNS.map(seedReplayRun));
  console.log(`replay runs: seeded ${runs.length}`);

  await disconnectDb();
  console.log("done.");
}

main().catch((e) => {
  console.error("seed failed:", e);
  process.exit(1);
});
