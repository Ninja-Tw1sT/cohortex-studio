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
  // Real local computation, not another API wrapper — see cohortex/cohortex/tools/__init__.py.
  {
    name: "contrast_ratio",
    description:
      "Compute the WCAG 2.x contrast ratio between two hex colors (e.g. '2E86AB, FFFFFF') and report AA/AAA " +
      "pass/fail for normal and large text — the actual accessibility standard's formula, not an API's opinion.",
  },
  {
    name: "shannon_entropy",
    description:
      "Compute the Shannon entropy (bits/byte) of a string — the standard static-analysis signal analysts use " +
      "to flag likely packed, encrypted, or compressed content in a binary (plain text/code runs ~4-6 bits/byte; " +
      "~7.2-8 suggests packing or encryption).",
  },
  {
    name: "defang_iocs",
    description:
      "Defang IPs, domains, and URLs in a block of text (1.2.3.4 -> 1[.]2[.]3[.]4, http:// -> hxxp[://]) so " +
      "indicators of compromise can be shared in a report without becoming live, clickable links — standard " +
      "SOC/CTI report hygiene.",
  },
  // OSINT crew's pipeline: gather (wikipedia_search, ip_geolocation) -> verify
  // (dns_resolution_check, wayback_availability) -> synthesize (word_count, current_datetime).
  // All five hit real, free, no-key-required public APIs.
  {
    // srlimit=2 keeps the response under the sidecar's 2000-char tool-output cap
    // (cohortex.tools._http_tool_fn truncates at resp.text[:2000] — the default
    // srlimit=10 runs ~4KB and gets cut mid-JSON) — verified against the real
    // runtime with curl, not just a browser (which masks truncation/redirect
    // behavior a browser handles transparently but httpx here does not).
    name: "wikipedia_search",
    kind: "http",
    method: "GET",
    description: "Search Wikipedia for articles matching a query, e.g. 'Ada Lovelace'. Returns the top 2 results.",
    urlTemplate: "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=2&srsearch={input}",
  },
  {
    name: "ip_geolocation",
    kind: "http",
    method: "GET",
    description: "Get geolocation and network info for an IP address or hostname.",
    urlTemplate: "https://api.hackertarget.com/geoip/?q={input}",
  },
  {
    // rdap.org bootstraps via an HTTP redirect to the TLD's actual registry
    // server — but cohortex.tools._http_tool_fn calls httpx with
    // follow_redirects=False (SSRF hardening: never let a tool call silently
    // hop to an unvalidated host), so a redirect-based WHOIS/RDAP source
    // returns nothing usable here. DNS-over-HTTPS has no such indirection —
    // Cloudflare's resolver answers directly with a 200 and a small JSON body.
    name: "dns_resolution_check",
    kind: "http",
    method: "GET",
    description:
      "Resolve a domain's current A record via Cloudflare's DNS-over-HTTPS resolver — confirms whether a domain " +
      "currently resolves to live infrastructure, one input among several for judging a source's legitimacy.",
    urlTemplate: "https://cloudflare-dns.com/dns-query?name={input}&type=A",
    headers: { Accept: "application/dns-json" },
  },
  {
    name: "wayback_availability",
    kind: "http",
    method: "GET",
    description: "Check whether a URL has an archived snapshot in the Internet Archive's Wayback Machine, and how far back it goes.",
    urlTemplate: "https://archive.org/wayback/available?url={input}",
  },
  {
    name: "current_datetime",
    kind: "http",
    method: "GET",
    description: "Get the current UTC date and time — useful for timestamping a report. No input needed.",
    urlTemplate: "https://timeapi.io/api/time/current/zone?timeZone=UTC",
  },
  // security_research_crew's pipeline: authorized, defensive vulnerability research
  // grounded entirely in public, official reference databases (NIST, MITRE, FIRST.org)
  // — lookups only, never active scanning of a live target and never exploit code.
  {
    // MITRE's API has no field-filtering option — a full entry runs ~55KB, so the
    // sidecar's 2000-char cap always truncates it. Verified the truncated prefix
    // still lands after ID/Name/Description/ExtendedDescription (the useful
    // summary), just before the verbose Relationships/References tail, so this
    // is a deliberate, checked tradeoff rather than an unnoticed cutoff.
    name: "cwe_weakness_lookup",
    kind: "http",
    method: "GET",
    description:
      "Look up a Common Weakness Enumeration (CWE) entry by its ID (e.g. '79') from MITRE's public CWE database — " +
      "the industry-standard defensive taxonomy of known software weakness categories, used to classify findings " +
      "in an authorized security assessment report. Response is long; only the name and description near the " +
      "start are guaranteed to come through.",
    urlTemplate: "https://cwe-api.mitre.org/api/v1/cwe/weakness/{input}",
  },
  {
    // resultsPerPage=1 keeps this under the 2000-char cap with a complete, valid
    // JSON body — the unbounded default page can run 5+ MB (all matching CVEs in
    // one response) and would otherwise be truncated into garbage, not just a
    // long response.
    name: "cve_database_search",
    kind: "http",
    method: "GET",
    description:
      "Search the U.S. National Vulnerability Database (NIST NVD) — the official public U.S. government registry " +
      "of already-disclosed software vulnerabilities — by product or technology keyword. Returns the single most " +
      "relevant match; for authorized defensive research: identifying known, publicly disclosed CVEs that may " +
      "affect a system's own technology stack.",
    urlTemplate: "https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch={input}&resultsPerPage=1",
  },
  {
    name: "epss_exploit_prediction_score",
    kind: "http",
    method: "GET",
    description:
      "Get the published Exploit Prediction Scoring System (EPSS) score for a CVE ID from FIRST.org (Forum of " +
      "Incident Response and Security Teams) — an industry-standard defensive metric estimating real-world " +
      "exploitation likelihood, used by security teams worldwide to prioritize patching, not to attack anything.",
    urlTemplate: "https://api.first.org/data/v1/epss?cve={input}",
  },
  // web_design_crew's pipeline: ux_researcher reuses wikipedia_search for domain/
  // audience background; ui_designer and accessibility_reviewer share these two
  // color tools from different angles (styling direction vs. legibility check).
  {
    // count=1 (not the obvious 5): TheColorAPI's per-color object is verbose
    // enough that a 5-color scheme runs ~7KB, well past the 2000-char cap, and
    // truncation would land mid-way through color #2 or #3 — several incomplete
    // colors instead of one usable one. count=1 keeps the generated color's full
    // object plus most of the seed color's, both complete, within the cap; call
    // it again with a different seed to build up a fuller palette.
    name: "color_scheme_generator",
    kind: "http",
    method: "GET",
    description:
      "Generate one complementary color from a base hex color (e.g. '2E86AB', no '#') via TheColorAPI, for " +
      "proposing a cohesive styling direction. Call again with a different hex to build up a fuller palette.",
    urlTemplate: "https://www.thecolorapi.com/scheme?hex={input}&mode=analogic&count=1",
  },
  {
    name: "color_info_lookup",
    kind: "http",
    method: "GET",
    description:
      "Get details for a hex color (e.g. '2E86AB', no '#') via TheColorAPI — name, RGB/HSL values, and a " +
      "suggested high-contrast text color — useful for checking a color choice's legibility.",
    urlTemplate: "https://www.thecolorapi.com/id?hex={input}",
  },
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
    description:
      "Threat modeling grounded in public CWE/CVE data, vulnerability risk scoring via EPSS, and a prioritized " +
      "remediation report. Authorized defensive security research (blue-team) only — every tool is a read-only " +
      "lookup against a public reference database (NIST, MITRE, FIRST.org); nothing here scans a live target or " +
      "produces exploit code.",
    topology: "sequential",
    agents: [
      {
        name: "threat_modeler",
        role: "Threat Modeler",
        goal:
          "identify the most likely attack surfaces and threat scenarios for the described system, grounded in " +
          "known CWE weakness categories and publicly disclosed CVEs. Authorized defensive threat-modeling only — " +
          "the output is a threat model for the system owner's own security team, never attack instructions or " +
          "exploit code.",
        tools: ["cwe_weakness_lookup", "cve_database_search"],
      },
      {
        name: "vuln_analyst",
        role: "Vulnerability Analyst",
        goal:
          "analyze the described system or code against known, publicly disclosed vulnerability classes (CVE) and " +
          "their published real-world exploitation likelihood (EPSS), explaining risk and impact for the system " +
          "owner's security team. Authorized defensive risk analysis only — prioritizing what to patch, not how " +
          "to attack anything.",
        tools: ["cve_database_search", "epss_exploit_prediction_score"],
      },
      {
        name: "security_report_writer",
        role: "Security Report Writer",
        goal:
          "summarize findings into a clear, prioritized, timestamped report with concrete remediation " +
          "recommendations for the system owner's security team, defanging any IPs/domains/URLs mentioned so " +
          "the report can be shared without its indicators becoming live, clickable links",
        tools: ["word_count", "current_datetime", "defang_iocs"],
      },
    ],
  },
  {
    name: "web_design_crew",
    description: "UX research grounded in real background knowledge, UI design direction with generated color palettes, and an accessibility pass with legibility data.",
    topology: "sequential",
    agents: [
      {
        name: "ux_researcher",
        role: "UX Researcher",
        goal: "define user needs, goals, and key flows for the requested page or product, using background research to ground assumptions instead of guessing",
        tools: ["wikipedia_search"],
      },
      {
        name: "ui_designer",
        role: "UI Designer",
        goal: "propose a clear visual layout, component structure, and styling direction, using a generated color palette and color details as a concrete starting point",
        tools: ["color_scheme_generator", "color_info_lookup"],
      },
      {
        name: "accessibility_reviewer",
        role: "Accessibility Reviewer",
        goal:
          "review the design for accessibility issues (contrast, semantics, keyboard navigation) and list fixes, " +
          "computing the actual WCAG 2.x contrast ratio for proposed foreground/background color pairs and " +
          "reporting whether they pass AA/AAA — not just checking an API's suggested contrast color",
        tools: ["color_info_lookup", "contrast_ratio"],
      },
    ],
  },
  {
    name: "reversing_crew",
    description:
      "Static and dynamic analysis of a sample the user already possesses and is authorized to examine, cross-" +
      "referenced against public CWE/CVE/EPSS data, then a technical report. Defensive research only — for " +
      "malware analysts, incident responders, and software researchers documenting what a sample does; this crew " +
      "never executes anything itself and never produces exploit or attack code.",
    topology: "sequential",
    agents: [
      {
        name: "static_analyst",
        role: "Static Analysis Engineer",
        goal:
          "describe what a piece of compiled code likely does based on structure, strings, and imports, without " +
          "executing it; compute the Shannon entropy of any suspicious extracted string/data blob to flag likely " +
          "packed, encrypted, or compressed sections (a standard static-analysis signal), and cross-reference any " +
          "identified libraries/components against known CWE weakness categories and public CVEs. Defensive " +
          "analysis of a sample the user is authorized to examine — produces a description for defenders, never " +
          "runnable exploit code.",
        tools: ["cwe_weakness_lookup", "cve_database_search", "shannon_entropy"],
      },
      {
        name: "dynamic_analyst",
        role: "Dynamic Analysis Engineer",
        goal:
          "describe expected runtime behavior and how to safely observe it in an isolated, disposable sandbox " +
          "(e.g. an offline VM), and check whether related CVEs are known to be actively exploited (EPSS) to " +
          "inform how the finding should be prioritized. Defensive analysis only — describes safe observation " +
          "methodology, never instructions to deploy or weaponize anything.",
        tools: ["cve_database_search", "epss_exploit_prediction_score"],
      },
      {
        name: "re_report_writer",
        role: "Reverse Engineering Report Writer",
        goal:
          "summarize findings into a clear, timestamped technical report suitable for defenders or researchers, " +
          "defanging any network indicators (IPs, domains, URLs) mentioned so the report can be shared safely",
        tools: ["word_count", "current_datetime", "defang_iocs"],
      },
    ],
  },
  {
    name: "osint_crew",
    description: "Gather, verify, and synthesize publicly available information into a sourced summary.",
    topology: "sequential",
    agents: [
      { name: "osint_researcher", role: "OSINT Researcher", goal: "gather and organize publicly available information relevant to the request from the provided context", tools: ["wikipedia_search", "ip_geolocation"] },
      { name: "source_verifier", role: "Source Verifier", goal: "assess the credibility and recency of each piece of information and flag anything unverified", tools: ["dns_resolution_check", "wayback_availability"] },
      { name: "intel_synthesizer", role: "Intelligence Synthesizer", goal: "synthesize verified findings into a clear, sourced summary, defanging any IPs/domains/URLs mentioned so the summary can be shared without its indicators becoming live, clickable links", tools: ["word_count", "current_datetime", "defang_iocs"] },
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
