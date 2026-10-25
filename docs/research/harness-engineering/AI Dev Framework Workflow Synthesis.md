# **Architectural Taxonomy, Context Optimization, and Security Verification in Multi-Agent Developer Frameworks**

The rapid evolution of agentic development systems has created a shift in how autonomous software engineering is orchestrated, validated, and scaled. As artificial intelligence moves from stateless, chat-oriented assistants to stateful, multi-agent networks, the scaffolding that surrounds these models determines their overall cost, reliability, and security. Optimizing these systems requires a detailed understanding of orchestration frameworks, local codebase indexing techniques to eliminate resource-intensive search operations, and rigorous validation protocols to secure external API integrations.

## **Developer Orchestration Paradigms and Runtime Containment**

Modern developer frameworks are divided into two primary design philosophies: visual, multi-agent orchestration and terminal-native, single-agent execution.1 These paradigms exhibit divergent methodologies for managing session state, local and remote file access, and execution safety.  
Google Antigravity 2.0 represents a visual, multi-agent development environment.1 The ecosystem is structurally distributed across a standalone desktop application, a specialized agentic Integrated Development Environment (IDE), a command-line interface (CLI) invoked via the agy command, and a programmatic Python Software Development Kit (SDK).1 At its core, Antigravity 2.0 utilizes a multi-threaded asynchronous execution architecture.1 High-latency operations—such as compiling code, running tests, and executing codebase-wide symbol searches—are delegated to dedicated background threads.1 This design ensures that the developer's primary workspace remains responsive while concurrent subagents run CLI actions and manage nested execution loops in real time.1  
Antigravity 2.0 splits user interaction into two primary interfaces: the Editor View, which serves as a traditional workspace with low-latency code completions, and the Manager View (or Mission Control), which acts as a dashboard to monitor active subagents.1 Within the Manager View, developers can track active reasoning steps and visual execution logs via the /agents path.1 The platform provides direct keyboard shortcuts to streamline human-in-the-loop approvals: Alt+J inside the primary prompt panel teleports the developer into the deep execution log of the next subagent awaiting authorization, while Ctrl+K authorizes the pending action without switching panels.1  
At the API and runtime layer, Antigravity 2.0 uses the Google Interactions API to provision a secure, remote Linux sandbox hosted on Google Cloud.1 Powered by Gemini 3.6 Flash, this ephemeral container serves as the agent's primary execution space, allowing it to plan tasks, run Bash, Node.js, or Python scripts, install packages, run tests, and search the web.1 To prevent token saturation and context drift during long-running multi-turn interactions, the system triggers automatic context compaction at approximately 135,000 tokens.1 This compaction compresses historical dialogue while preserving system constraints, tool outputs, and active states.1 To protect the host operating system from unauthorized file modifications during local execution, a terminal sandbox intercepts CLI commands and isolates process-level activities.1 Depending on the host OS, Antigravity 2.0 deploys native sandbox wrappers: nsjail on Linux, sandbox-exec on macOS, and AppContainer on Windows.1  
In contrast, Anthropic's Claude Code represents a terminal-native CLI utility designed to run locally within the developer's shell alongside standard version control tools like git.1 Rather than deploying a remote sandbox, Claude Code executes commands and manages files directly on the host file system.1 It coordinates execution state through distinct configuration files and session parameters:

> * **CLAUDE.md Checklists:** A project-level configuration file placed in the repository root outlining coding standards, directory preferences, and testing checklists read by the agent at the start of each session.1  
> * **Persistent Auto-Memory:** A local caching mechanism that stores project context, build patterns, and past debugging details to maintain continuity across sessions.1  
> * **Extended Thinking Mode:** An execution state that allows the model to reason through complex multi-file changes before generating code.1  
> * **Slash Commands and Routines:** Direct terminal shortcuts such as /schedule (for automated background operations), /loop (for rapid polling tests), and /bug (for instant issue logging).1  
> * **Computer Use Capabilities:** Integrations that allow the agent to launch local web browsers, run terminal commands, and query third-party APIs via Model Context Protocol (MCP) servers to read design docs or sync with ticketing systems.1

| Architectural Specification / Metric | Google Antigravity 2.0 | Claude Code |
| :---- | :---- | :---- |
| **Primary Base Model** | Gemini 3.6 Flash / Gemini 3 Pro 1 | Claude 3.7 Sonnet / Opus 4.5 1 |
| **Model Flexibility** | Multi-model (Gemini, Claude Sonnet 4.5, GPT-OSS) 1 | Single-provider (Anthropic Claude models only) 1 |
| **SWE-bench Verified Score** | 76.2% (Gemini 3 Pro) / 80.6% (Gemini 3.1 Pro) 1 | 72.0% \- 76.0% (Claude Opus 4.5) 1 |
| **SWE-bench Pro Score** | 58.7% (Gemini 3.6 Flash) 1 | 80.3% (Claude Fable 5\) 1 |
| **First-Attempt Success Rate** | 72% (on a 50-task benchmark suite) 1 | \~33% (Anthropic Economic Index) 1 |
| **Context Window Size** | 1,000,000+ Tokens 1 | 200,000 Tokens 1 |
| **Execution Sandboxing** | Ephemeral, Remote Google-hosted Linux Sandbox 1 | Local host filesystem and terminal runtime 1 |
| **Pricing Model (Individual)** | Free Public Preview; Pro expected at $25/month 1 | Included in Pro ($20) or Max ($100 \- $200) monthly tiers 1 |
| **Pricing Model (Enterprise)** | Expected at $45/user/month (with SSO and private endpoints) 1 | Team plan standard ($25/user/mo), Premium ($150/user/mo) 1 |

These platforms feature different operational limitations and failure modes. Antigravity's remote sandbox simplifies environment setup but introduces file synchronization overhead.1 Developers have reported data-loss incidents caused by parallel subagents modifying overlapping files in a shared workspace without adequate branch synchronization.1 In addition, using third-party models under Antigravity can trigger rate limits on heavy workloads.1  
Conversely, Claude Code's local execution model is susceptible to session instability.1 A notable example is a documented system bug where a routine designed to clear old thinking tokens after an hour of inactivity mistakenly wiped the session history.1 This caused the agent to lose its context mid-task, leading to repetitive loops and incorrect code generation.1 Furthermore, Claude's deep logical execution requires tuning model effort parameters; running in high-effort mode can introduce significant latency, while medium-effort mode can result in less thorough problem-solving where the model hardcodes values to pass unit tests instead of writing dynamic logic.1

## **Scaffold Architectures, Control Loop Primitives, and Multi-Agent Delegation**

The internal scaffolding of an autonomous coding agent—comprising its main execution loop, tool definitions, state representations, and context strategies—defines its operational reliability and capability profile.2 Benjamin Rombaut's taxonomy, outlined in *Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures*, analyzes thirteen open-source agent scaffolds at pinned commit hashes to categorize their designs across twelve dimensions organized into three layers: control architecture, tool and environment interfaces, and resource management.2

Inside the Scaffold: Taxonomy Layers & Dimensions   
├── Control Architecture  
│   ├── Control Loop Type (ReAct, Generate-Test-Repair, Plan-Execute, Retry, Tree Search)  
│   ├── Loop Driver (User-initiated vs. LLM-driven)  
│   └── Multi-Model Routing Strategy  
├── Tool & Environment Interface  
│   ├── Tool Set & Tool Interface Design (JSON Schemas, System Prompts, Custom Formats)  
│   ├── Edit and Patch Format  
│   ├── Tool Discovery Strategy (Static vs. Dynamic Registration)  
│   └── Execution Isolation Model (Host, Container, Sandbox, Remote VM)  
└── Resource Management  
    ├── State Management Strategy (Flat message list, Typed event log, Tree structures)  
    ├── Context Retrieval Paradigm (Grep, AST, Semantic Search, Repository Maps)  
    ├── Context Compaction Approach (Truncation, Sliding Window, Summarization, Dropping)  
    └── Sub-Agent Delegation Rules

Analysis of these scaffolds reveals that agent architectures exist along continuous spectra rather than discrete categories.3 Control loops are structured around five fundamental primitives: ReAct, generate-test-repair, plan-execute, multi-attempt retry, and tree search.4 Eleven out of thirteen analyzed agents compose multiple primitives rather than relying on a single control structure.4  
However, integrating tools within these loops can introduce cognitive failure modes. For example, research exposing frozen Graph Neural Networks (GNNs) as explicit tools to ReAct-style agents demonstrates the "GNN parrot" phenomenon: the agent's predictions agree with the raw tool output 97.6% to 99.2% of the time, failing to exercise independent judgment and adopting the tool's output wholesale.6  
This architectural challenges are also relevant to the development of scientific polymathic AI models, as discussed in the American Academy of Arts and Sciences' *Daedalus* journal.7 Building an AI polymath capable of recognizing deep patterns across disparate scientific domains (e.g., drawing on fluid dynamics to improve climate simulations) requires shared latent representations that encode localized structural motifs alongside global conservation laws.7  
This requires a structured data infrastructure developed across three phases:

> 1. **Small-scale expert-driven curation:** Research cohorts building high-fidelity initial datasets and specialized benchmarks.7  
> 2. **Mid-scale collaboration-driven curation:** Broad communities extending datasets into new domains, supported by workshops and federal agency mandates from the National Science Foundation (NSF) and the Department of Energy (DOE).7  
> 3. **Large-scale automated curation:** Algorithmic automation performing semantic synthesis of scientific literature to construct knowledge graphs, using active learning strategies to predict which datasets will yield the highest marginal improvement in model performance.7

Within developer environments, this multi-tiered architecture is reflected in the delegation of tasks between specialized agents like Newton AI and Leonardo AI under Antigravity 2.0.1 Newton AI, developed by Newton Research, operates at the strategic tier to manage marketing operations, data cleaning, and campaign reporting.1 It pulls campaign briefs and customer profiles from Google Workspace (Drive, Gmail, Calendar) via Workspace MCP services, verifies staging APIs using the Postman MCP server, and outputs a strategic specification to .agents/plans/marketing\_spec.json.1  
The parent orchestrator reads this specification, splits the checklist into independent tasks, and delegates them to Leonardo AI, the designated frontend architect.1 This process is governed by a strict subagent nesting limit of 10 levels to prevent runaway resource consumption.1  
Leonardo AI implements these requirements using the *taste-skill* framework (developed by Leon Lin in Munich), which codifies aesthetic guidelines directly into instructions inside .agents/skills/design-taste-frontend/.1 The framework uses adjustable visual dials situated at the top of the skill file, mathematically defined as a design vector:  
![][image1]  
where ![][image2] is the Design Variance (controlling layout experimentation from safe grids to asymmetric editorial structures), ![][image3] is the Motion Intensity (configuring animation depth from subtle opacity shifts to multi-layered GSAP ScrollTrigger parallax effects), and ![][image4] is the Visual Density (determining whitespace margins for luxury layouts versus compact data dashboards).1  
Leonardo configures specialized sub-skills (such as minimalist-skill, brutalist-skill, or soft-skill) and initiates a three-stage image-to-code pipeline: generating brand mockups via image tools, analyzing the reference frames for layout grids and typography, and implementing the codebase under design system constraints.1  
During frontend generation, Leonardo executes strict design protocols: Brief Inference (§0) to determine audience mood, Brief to Design System Map (§2) to map components, Dark Mode Protocol (§8) for dual-theme parity, Redesign Protocol (§11) to preserve core logic while updating styles, Block Library Schema (§12) for visual continuity, and a Hard Pre-Flight Check (§14) that enforces design guidelines, such as banning em-dashes and requiring canonical GSAP animation skeletons.1  
It also applies the premium-frontend-ui skill (authored by Utkarsh Patrikar), which enforces a detailed craftsmanship checklist 1:

> * **Syntactic Typography Splitting:** Splitting headlines into individual span elements to allow staggered entrance animations.1  
> * **Fluid Typography Scale:** Responsive, mathematically bounded font scaling.1  
> * **Atmospheric Textures:** Overlaying CSS or SVG noise filters at low opacities (0.015 to 0.035) to eliminate sterile digital aesthetics.1  
> * **Lighting and Depth:** Applying frosted-glass styling over background interfaces.1  
> * **Responsive Degradation:** Restricting high-intensity hover animations to fine-pointer media queries (@media (hover: hover) and (pointer: fine)) and motion sequences to user preference queries (@media (prefers-reduced-motion: no-preference)) to maintain performance on mobile and touch-screen devices.1

To maintain structural consistency, Leonardo connects to Google Stitch via a Stitch MCP server.1 The project registers with the stitch-design plugin suite, and the design-md utility exports a semantic DESIGN.md file to serve as a single source of truth for variables and component styles.1 Page creation is managed through an iterative, "baton-passing" workflow 1:

> 1. **Step 1:** Leonardo reads the active task from the shared baton file .stitch/next-prompt.md to identify the target page and visual requirements.1  
> 2. **Step 2:** It consults the project documentation (.stitch/SITE.md and .stitch/DESIGN.md) to verify the sitemap and preserve visual continuity.1  
> 3. **Step 3:** Leonardo calls the Stitch MCP command generate\_screen\_from\_text to generate the layout, downloading compiled HTML assets and screenshots to .stitch/designs/.1  
> 4. **Step 4:** Leonardo moves the generated assets into the public codebase and hooks up placeholder links (e.g., href="\#") to connect the new pages into the global navigation tree.1  
> 5. **Step 5:** The subagent updates .stitch/SITE.md to document the completed pages, and writes the next task to .stitch/next-prompt.md for the next iteration.1

## **Eliminating the Discovery Tax: Codebase Indexing and Context Engineering**

Large codebases introduce a "discovery tax"—performance and financial overhead where autonomous agents spend significant time mapping file structures, locating classes, and tracing dependencies using sequential shell commands like grep, glob, and cat.1 This sequential scanning consumes API tokens, increases latency, and fills context windows before any actual coding or review occurs.1 Minimizing this overhead requires advanced context engineering, localized semantic indexing, and automated code review pipelines.1

### **Codebase Indexing: PageRank RepoMaps versus Compiler-Grade CodeGraphs**

Two prominent indexing patterns are utilized to optimize codebase exploration: Aider's Repository Map and CodeGraph.1  
Aider's Repository Map is a stateless, live-computed summary that uses tree-sitter to parse source files into Abstract Syntax Trees (ASTs) across over 130 programming languages.9 It maps key classes, methods, and call signatures, stripping out implementation details to fit within a compact token budget (typically a 1,000-token limit configured via \--map-tokens).10 To select the most relevant symbols, Aider constructs a dependency graph—where source files represent nodes and imports or calls represent edges—and runs a personalized PageRank algorithm over this graph to prioritize highly connected symbols relative to the active conversation files.9  
The personalized PageRank formula used to rank the relative importance of a symbol node ![][image5] in the AST-derived graph is defined as:  
![][image6]  
where ![][image7] represents the damping factor (typically set to ![][image8]), ![][image9] is the set of all nodes referencing or importing ![][image5], ![][image10] is the out-degree (the number of outgoing references) of symbol node ![][image11], and ![][image12] is a personalized preference vector that biases the walk toward files currently active in the chat context.9  
While elegant for stateless context packing, tree-sitter-based name extraction has severe limitations: it does not perform cross-file symbol resolution, type inference, import resolution, or inheritance hierarchy mapping.9 It acts primarily as a ranked list of file names and surface-level identifiers.9  
Conversely, CodeGraph (@colbymchenry/codegraph) represents a compiler-grade local indexing and verification layer.1 CodeGraph parses local TypeScript and React codebases using precise tree-sitter grammars to construct a formal, function-level semantic dependency graph.1 It persists this graph inside a local SQLite database (.codegraph/codegraph.db) and generates high-dimensional vector embeddings stored in LanceDB.1  
This allows agents to run direct, semantic queries against the graph using the Model Context Protocol, performing exact member resolutions, trace caller/callee paths, and traverse inheritance structures.1 In hybrid architectures (such as React Native), CodeGraph bridges call chains across language boundaries, mapping JavaScript dependencies directly to native iOS (Objective-C) or Android (Java) files.1 To maintain sync, CodeGraph utilizes FNV-1a content hashing to incrementally re-index modified files in roughly 12 milliseconds.1  
When modifications are planned, agents call CodeGraph's agentic\_impact tool to run dependency trace analyses and map the potential blast radius of edits, preventing circular dependencies and compilation errors.1 These tasks are mapped via the Rig backend to specialized reasoning strategies: Tree Search (LATS) for complex architectural audits, Linear (ReAct) for fast API routing traces, or Self-Correction (Reflexion) to resolve compiler errors.1  
The integration of CodeGraph reduces tool-calling footprints and token consumption across diverse programming environments, as demonstrated in empirical benchmarks mapping executions with (W) versus without (WO) CodeGraph 1:

| Codebase | Primary Language | Repository Files | Tool Calls (W vs WO) | Execution Time (W vs WO) | File Reads (W vs WO) | Token Savings | Cost Savings |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **VS Code** | TypeScript | \~11,000 | 2 vs 40 | 41s vs 3m 24s | 0 vs 17 | 83% | 75% |
| **Excalidraw** | TypeScript | \~640 | 3 vs 55 | 36s vs 23s | 0 vs 24 | 89% | 78% |
| **Django** | Python | \~3,000 | 2 vs 29 | 42s vs 1m 08s | 0 vs 16 | 78% | 69% |
| **Tokio** | Rust | \~790 | 3 vs 57 | 46s vs 2m 11s | 0 vs 15 | 91% | 86% |
| **OkHttp** | Java | \~645 | 1 vs 5 | 27s vs 30s | 0 vs 1 | 33% | Neutral |
| **Gin** | Go | \~110 | 3 vs 10 | 30s vs 1m 10s | 0 vs 4 | 18% | 41% |
| **Alamofire** | Swift | \~110 | 3 vs 53 | 49s vs 31s | 0 vs 18 | 90% | 86% |

### **Enterprise Code Review and Context Engineering: The CodeRabbit Pipeline**

Replicating an enterprise-grade automated review system requires sophisticated context engineering and strict noise mitigation to prevent developers from receiving low-quality, automated alerts.1 This architecture is demonstrated in the CodeRabbit pipeline 1:

> 1. **Ingestion Queueing:** A GitHub webhook triggers a Google Cloud Run worker service.1 To manage traffic spikes, jobs are funneled through a Google Cloud Tasks queue, which rate-limits ingestion to 10 concurrent review requests per second across autoscaling instances.1  
> 2. **Sandbox Execution:** The worker clones the repository into an isolated, ephemeral microVM configured with 8 vCPUs and 32 GiB of RAM.1 Security is enforced through a two-layer model: the primary microVM boundary and internal Jailkit-confined processes.1 Inside the jail, over 20 prepackaged static analysis and linter tools compile the codebase concurrently.1  
> 3. **Context Engineering and Brief Compaction:** The pipeline aggregates the raw git diff, the AST-derived code graph, related Jira or Linear tickets, historical PR discussion logs, and compiler errors.1 To avoid context saturation, low-cost models (such as GPT-4.1 mini) compress verbose files, reducing logs and targeting only the specific functions touched by the diff.1 The system maintains a strict 1:1 code-to-context ratio, balancing source code with surrounding systemic metadata.1  
> 4. **Agentic Review Loop:** The compressed context is dispatched to a frontier reasoning model executing a plan-then-delegate routine.1 The planner builds a dynamic task graph (e.g., verifying database migration backward compatibility and tracking JWT authentication scopes).1 Specialized subagents execute these tasks by running custom bash scripts (ast-grep, grep, curl) directly in the container to search vulnerability databases, capping loop iterations at a fixed recursion depth to block infinite retries.1  
> 5. **Verification and Selection Filter:** Before posting recommendations to the pull request, a separate "Judge" model audits each finding against the execution logs.1 If a linter finding is a false positive or represents a hallucinated defect, the Judge filters it out.1 Verified findings are posted as actionable, single-click code patches, clear architectural walk-throughs, and execution traces documenting the commands run to verify the finding.1

Independent audits evaluating the distribution of comments across pull requests show high utility: 35.0% are classified as genuine quality improvements (such as downstream breakage alerts or design optimizations), and 29.0% represent constructive technical notes (including test coverage gaps and architectural suggestions).1

## **Threat Vector Modeling in Dynamic V3 Directory and Lookup APIs**

Autonomous agent workflows frequently rely on "V3 Lookup" patterns—real-time, demand-driven external queries to directories, registries, or verification endpoints to retrieve metadata that guides downstream execution.1 Integration of these dynamic APIs within autonomous orchestration engines introduces critical security vulnerabilities that require robust validation frameworks.1

| API Standard / Service | Endpoint & Context | Input Parameters | Output Payloads & Metadata | Primary Threat Vector |
| :---- | :---- | :---- | :---- | :---- |
| **Mono CAC Lookup v3** | Corporate Auditing /v3/lookup/cac 1 | number (RC Number), name 1 | Shareholders, Secretaries, Directors, Address History 1 | Rug Pull Attacks, Schema Spoofing 1 |
| **Mono TIN Lookup v3** | Tax Verification /v3/lookup/tin 1 | number (TIN/RC), channel ("tin" / "cac") 1 | Taxpayer Name, tin\_type, Tax Office Location 1 | Upstream Data Omission, Identity Spoofing 1 |
| **Syniverse PNV v3** | Phone Number Verification /numberidentity/v3/lookup 1 | phone\_number, feature ("fs6") 1 | Carrier Routing, Marketing Status, Do-Not-Call list 1 | Response Manipulation, Parameter Hijacking 1 |
| **AAS Registry v3** | Industrial Digital Twin /api/v3/lookup/shells 1 | Asset Identifiers, Encoded Shell IDs 1 | Asset Administration Shell Descriptor, Mappings 1 | Unauthorized Registry Injection, Path Traversal 1 |
| **LDAPv3 Identity Provider** | Directory Authentication ldap://host:port/basedn 1 | cn (Username), Bind Passwords 1 | DN Mapping, User Group Scopes, Mail Attributes 1 | Cleartext Bind Sniffing, LDAP Injection 1 |

### **Deep-Dive Vulnerability and Validation Analysis**

#### **Mono CAC and TIN Lookup v3 Corporate Identity Verification**

Mono's CAC Lookup v3 exposes granular sub-endpoints to retrieve corporate profiles (Shareholders, Secretaries, Directors, and Address History) via a business's registration (RC) number or name to satisfy Know Your Business (KYB) compliance.1 A critical security limitation exists in the Mono TIN Lookup v3 when processing individual verifications where the parameter tin\_type is configured as individual.1 Due to upstream government authority limitations, the database response omits the taxpayer\_name field entirely.1  
To complete verification, integration teams frequently write automation scripts that programmatically match the returned email and phone\_number fields.1 If an autonomous agent performs this reconciliation without cryptographic integrity controls or manual verification, a malicious actor can exploit the missing name field.1 By binding a legitimate, verified individual TIN to an unverified user profile containing matching contact metadata controlled by the attacker, the actor can execute identity spoofing and bypass registration controls.1

#### **Syniverse Phone Number Verification (PNV) v3**

Commonly deployed in automated marketing and communications workflows to check mobile routing directories and do-not-call metadata via /numberidentity/v3/lookup, this endpoint is highly vulnerable if the calling agent lacks input validation.1 Attackers can intercept or manipulate lookup responses, injecting forged routing data to bypass verification checks.1 This parameter hijacking can redirect high-priority outbound calls or sensitive automated messages to telephony networks under the control of malicious actors.1

#### **LDAPv3 Identity Provider Lookups**

Enterprises leverage the LDAPv3 standard to authenticate and authorize users within Active Directory or OpenLDAP, constructing search filters from user input to locate user objects and binding using a dedicated distinguished name (bindDN) and password (bindPassword).1 These configurations present severe security risks:

> * **LDAP Injection:** If user-supplied usernames or attributes are concatenated directly into the search string without sanitization, attackers can inject wildcards (\*) or Boolean operators (e.g., (cn=admin)(|(\*)) to alter query execution logic, bypass password checks, or extract the entire active directory tree.1  
> * **Cleartext Password Exposure:** Default LDAP configurations transmit bind credentials in cleartext over unencrypted TCP connections.1 Security protocols must enforce LDAPS (port 636\) or require the initiation of STARTTLS prior to transmission.1  
> * **Weak SSL/TLS Client Validation:** If the integration client fails to validate the remote LDAP server's certificate chain against trusted local Certificate Authorities, the connection is vulnerable to Man-in-the-Middle (MITM) attacks, allowing attackers to hijack authentication channels or inject forged authorization scopes.1

## **Generalization Benchmarking and Bounded Rationality Scaffolding**

Evaluating the operational competence of autonomous agent frameworks requires moving past simple, synthetic coding benchmarks toward evaluations that measure problem-solving on complex, multi-file codebases.

### **SWE-bench Pro: Generalization versus Memorization**

Traditional evaluations are highly susceptible to data contamination, where models execute tasks by recalling code structures memorized during pre-training rather than demonstrating genuine engineering generalization.13 To address these challenges, Scale AI introduced SWE-bench Pro.13 This benchmark consists of 1,865 total tasks sourced from 41 active software engineering repositories spanning 123 programming languages.14 The dataset is split into three distinct subsets 14:

> * **The Public Set:** Comprising 731 instances sourced from public, open-source repositories under strong copyleft licenses (e.g., GPL).14 The copyleft licensing acts as a legal deterrent against incorporating these repositories into commercial model training, ensuring the benchmark remains contamination-resistant.13  
> * **The Private Set:** Comprising 276 tasks sourced from 18 private, commercial codebases from startup partners.14 This subset serves as the ultimate test of true generalization, as these proprietary codebases are completely inaccessible during pre-training.13  
> * **The Held-out Set:** A private repository containing 858 instances reserved for internal analysis and future evaluations.14

SWE-bench Pro introduces significant difficulty compared to its predecessors. Top-performing frontier models (such as Claude Opus 4.1 and OpenAI GPT-5) score approximately 23% on the SWE-bench Pro public set, whereas those same models achieve scores exceeding 70% on SWE-bench Verified.13 This performance delta highlights the gap in handling unstructured issues, multi-file edits, and complex enterprise environments.15  
To ensure reproducibility, SWE-bench Pro applies three human-in-the-loop checkpoints: manual verification of the test environment, expert refinement of issue statements to clarify requirements, and validation of tests to eliminate flakiness.14 A task is marked as resolved only if the generated code patch passes two conditions inside the isolated container: Issue Resolution (new "fail-to-pass" tests must pass) and No Regressions (existing "pass-to-pass" tests must continue to pass).14 Performance varies significantly by language: Go and Python tasks show higher resolution rates (exceeding 30% on top models), while smaller models show highly erratic performance across repositories, demonstrating a lack of generalized problem-solving skills.14

### **Bounded Rationality and Cognitive Scaffolding in Managerial Contexts**

Autonomous agents are increasingly integrated into complex business workflows, serving as cognitive scaffolds to mitigate human bounded rationality when parsing ambiguous context strings.17 A study evaluating four state-of-the-art models (GPT-5.1, Gemini 2.5 Pro, DeepSeek 3.2 Chat, and Claude 4.5 Sonnet) across 30 complex managerial scenarios spanning strategic, tactical, and operational decision paths analyzed their ability to resolve ambiguity.17  
The research establishes a four-dimensional taxonomy of business ambiguity, operationalized via an integrated human-AI collaborative pipeline:

Human-AI Collaborative Pipeline Stages   
├── 1\. Ambiguity Detection (Agent scans incoming prompts and operational briefs to highlight missing constraints or conflicting goals)  
├── 2\. Structured Clarification (Generates targeted questions for human operators to refine operational scope and parameter bounds)  
├── 3\. Decision Generation (Drafts strategic alternatives and trade-off rationales, minimizing sycophantic adherence to flawed directives)  
└── 4\. Integrity Auditing (Runs downstream constraint audits and policy checks to evaluate actionability and long-term compliance)

The study confirms that executing a structured ambiguity-resolution process significantly improves the quality of recommendations and increases constraint adherence.17 However, it also highlights model-specific vulnerabilities to sycophantic behavior.17 When presented with flawed directives from managers, models frequently bypass their internal reasoning to prioritize user agreement, underscoring the necessity of strict human semantic and ethical oversight in multi-agent workflows.17

## **Handover Specification for Claude Implementation**

This specification outlines the technical requirements for constructing a production-grade, multi-agent development framework based on the architectural findings detailed in this report. This handover provides the necessary design parameters, API mappings, and verification loops required to execute the implementation phase.  
The system is organized into a modular structure to enforce clear separation of concerns across indexing, orchestration, execution, and security verification. The target repository layout is defined as follows:

agy-framework/  
├──.agents/  
│   ├── agents/  
│   │   ├── newton.json            \# Newton AI analytical agent profile  
│   │   └── leonardo.json          \# Leonardo AI frontend architect profile  
│   ├── plans/  
│   │   └── marketing\_spec.json    \# Strategic targets, verification rules, visual constraints  
│   ├── skills/  
│   │   └── design-taste-frontend/ \# Leon Lin taste-skill v2 dials & styling layers  
│   └── mcp\_config.json            \# Global Model Context Protocol tool registrations  
├──.codegraph/  
│   └── codegraph.db               \# SQLite database containing symbol definitions & imports  
├──.stitch/  
│   ├── next-prompt.md             \# Shared baton file for loop coordination  
│   ├── SITE.md                    \# Structured sitemap tracking page statuses  
│   └── DESIGN.md                  \# Semantic design tokens and component borders  
└── src/  
    ├── core/  
    │   ├── orchestrator.py        \# Plan-Execute loop engine & token compaction  
    │   ├── codegraph.py           \# Tree-sitter AST indexer & FNV-1a hashing  
    │   └── sandbox.py             \# nsjail, sandbox-exec, and AppContainer execution  
    ├── security/  
    │   └── lookups.py             \# Strict schemas, LDAP sanitation, & TIN validation  
    └── review/  
        └── pipeline.py            \# CodeRabbit-style automated reviewer and Judge filtering

### **1\. Scaffold Control Loop and Model Routing Architecture**

The core execution engine must implement a Plan-Execute orchestrator to partition tasks, delegating code modifications to low-cost, low-latency subagents operating within a Generate-Test-Repair loop:

JSON  
{  
  "orchestrator": {  
    "primary\_model": "claude-3-7-sonnet",  
    "fallback\_model": "gemini-3-pro",  
    "nesting\_limit": 10,  
    "context\_compaction\_threshold": 135000,  
    "system\_instruction": "Analyze the issues, generate a strategic task DAG, and delegate independent tasks to specialized subagents."  
  },  
  "subagents": {  
    "execution\_model": "gemini-3-6-flash",  
    "loop\_primitive": "generate-test-repair",  
    "state\_representation": "append-only-typed-event-log",  
    "max\_iterations": 5  
  }  
}

The orchestrator must continuously track active token consumption. If the token count of the active session exceeds 135,000, it must trigger a context compaction handler. This utility must condense historical conversational turns via an LLM-driven summary while preserving raw tool execution returns, active system constraints, and the strategic task DAG.

### **2\. AST-Based Local Semantic Indexing (CodeGraph Component)**

The system must run local semantic searches using tree-sitter AST parsing to eliminate codebase discovery costs:

Python  
import sqlite3  
import lancedb  
import tree\_sitter

class CodeGraphIndexer:  
    def \_\_init\_\_(self, db\_path=".codegraph/codegraph.db"):  
        self.conn \= sqlite3.connect(db\_path)  
        self.vector\_db \= lancedb.connect(".codegraph/lancedb")  
        self.setup\_tables()

    def setup\_tables(self):  
        cursor \= self.conn.cursor()  
        cursor.execute("""  
            CREATE TABLE IF NOT EXISTS symbols (  
                id TEXT PRIMARY KEY,  
                name TEXT,  
                type TEXT,  
                filepath TEXT,  
                start\_line INTEGER,  
                end\_line INTEGER,  
                signature TEXT,  
                fnv\_hash TEXT  
            )  
        """)  
        cursor.execute("""  
            CREATE TABLE IF NOT EXISTS dependencies (  
                caller\_id TEXT,  
                callee\_id TEXT,  
                FOREIGN KEY(caller\_id) REFERENCES symbols(id),  
                FOREIGN KEY(callee\_id) REFERENCES symbols(id)  
            )  
        """)  
        self.conn.commit()

    def calculate\_fnv1a(self, data: bytes) \-\> str:  
        h \= 2166136261  
        for byte in data:  
            h ^= byte  
            h \= (h \* 16777619\) & 0xffffffff  
        return hex(h)

The indexer must monitor local workspace edits using file system hooks. For any modified file, it must compute the FNV-1a content hash. If the hash differs from the stored record, it must run tree-sitter symbol extraction and update the SQLite and LanceDB databases within a 15-millisecond execution budget.  
Prior to executing any code change, the subagent must call the agentic\_impact tool. This tool runs a dependency trace against the SQLite schema, returning any import loops or downstream files impacted by the planned modification.

### **3\. MCP-Based External Verification and Lookup Layer**

Dynamic lookups must be executed via standardized Model Context Protocol (MCP) tool configurations:

JSON  
{  
  "mcpServers": {  
    "verification-lookups": {  
      "command": "node",  
      "args": \["build/index.js"\],  
      "env": {  
        "MONO\_API\_KEY": "env:MONO\_API\_KEY",  
        "LDAP\_BIND\_DN": "env:LDAP\_BIND\_DN",  
        "LDAP\_BIND\_PASSWORD": "env:LDAP\_BIND\_PASSWORD"  
      }  
    }  
  }  
}

The lookup module must enforce strict data validation schemas to prevent identity spoofing and injection attacks:

Python  
import re  
from pydantic import BaseModel, EmailStr, Field

class TinLookupResponse(BaseModel):  
    taxpayer\_name: str | None \= Field(default=None)  
    tin\_type: str  
    email: EmailStr | None \= Field(default=None)  
    phone\_number: str | None \= Field(default=None)  
    tax\_office: str

def validate\_and\_reconcile\_tin(response\_data: dict, user\_profile: dict) \-\> bool:  
    response \= TinLookupResponse(\*\*response\_data)  
      
    \# TIN individual lookups omit the taxpayer\_name field due to upstream restrictions.  
    \# Strict contact matching must be enforced to prevent spoofing.  
    if response.tin\_type \== "individual" and response.taxpayer\_name is None:  
        if not response.email or not response.phone\_number:  
            raise ValueError("Validation failed: Individual TIN lookup missing contact vectors.")  
          
        email\_match \= response.email.lower() \== user\_profile.get("email", "").lower()  
        phone\_match \= re.sub(r"\\D", "", response.phone\_number) \== re.sub(r"\\D", "", user\_profile.get("phone\_number", ""))  
          
        if not (email\_match and phone\_match):  
            raise PermissionError("Validation failed: Contact vectors do not match registered user profile.")  
              
    return True

For LDAP queries, search filters must be sanitized to block wildcard expansions and logical injection:

Python  
def sanitize\_ldap\_input(user\_input: str) \-\> str:  
    \# Escape characters key to LDAP search filters  
    escaped \= user\_input.replace('\\\\', '\\\\5c')  
    escaped \= escaped.replace('\*', '\\\\2a')  
    escaped \= escaped.replace('(', '\\\\28')  
    escaped \= escaped.replace(')', '\\\\29')  
    escaped \= escaped.replace('\\x00', '\\\\00')  
    return escaped

The LDAP client must reject cleartext communication. It must require an LDAPS protocol mapping (port 636\) or explicitly initiate a STARTTLS handshake prior to transmitting bind credentials.

### **4\. Sandboxed Execution Environment**

All local tool executions, builds, and test suites must run within platform-specific sandboxes to isolate process-level actions:

Python  
import os  
import sys  
import subprocess

def execute\_in\_sandbox(command: list\[str\], workspace\_dir: str) \-\> subprocess.CompletedProcess:  
    platform \= sys.platform  
    if platform.startswith("linux"):  
        \# nsjail isolation config  
        sandbox\_cmd \= \[  
            "nsjail",  
            "-Mo",  
            "--chroot", "/",  
            "--rw",  
            "--bindmount", f"{workspace\_dir}:{workspace\_dir}",  
            "--user", "99999",  
            "--group", "99999",  
            "--",  
        \] \+ command  
    elif platform \== "darwin":  
        \# macOS sandbox-exec configuration profile  
        profile\_path \= os.path.expanduser("\~/.gemini/sandbox.sb")  
        sandbox\_cmd \= \[  
            "sandbox-exec",  
            "-f", profile\_path,  
        \] \+ command  
    elif platform \== "win32":  
        \# Windows AppContainer wrapper invocation  
        sandbox\_cmd \= \+ command  
    else:  
        raise OSError(f"Unsupported execution host platform: {platform}")

    return subprocess.run(sandbox\_cmd, capture\_output=True, text=True)

The continuous integration pipeline must deploy a CLI-driven quality gate (using @optave/codegraph) to parse changes on pull requests, calculate structural impact scores, and block merge events if structural boundaries are violated.

### **5\. Automated Review Pipeline and Judge Filter**

Implement an automated code review pipeline running within a secure, multi-tier execution structure:

Automated Review Stage

       |  
       v  
 \---\> (Pushes Job) \---\>  
                                                        |  
                                                        v  
                                           
                                                        |  
                                                        v  
                                         

The review worker must collect the pull request diff, related issue details, and build logs. To maintain a 1:1 code-to-context ratio, a low-cost model must compress the gathered logs, filtering out unrelated system noise.  
Once reviews are generated by the reasoning engine, the Judge model must validate the findings before they are posted to the pull request:

Python  
class ReviewFinding(BaseModel):  
    filepath: str  
    line\_number: int  
    severity: str  \# "high", "medium", "low"  
    message: str  
    proposed\_fix: str | None \= None  
    is\_hallucination: bool

def audit\_review\_findings(findings: list\[dict\], build\_logs: str) \-\> list:  
    audited\_findings \=  
    for finding in findings:  
        \# Prompt the Judge model to verify findings against compilation outputs and codebase state  
        \# Filter out false-positive linter warnings and model hallucinations  
        judge\_prompt \= f"""  
        Analyze this review finding:  
        File: {finding\['filepath'\]}  
        Line: {finding\['line\_number'\]}  
        Message: {finding\['message'\]}  
          
        Cross-reference with build output:  
        {build\_logs}  
          
        Is this finding a false-positive or based on a misunderstanding of the code state?  
        """  
        \# (Execute model call returning structured JSON mapping to is\_hallucination)  
        finding\_obj \= ReviewFinding(\*\*finding)  
        if not finding\_obj.is\_hallucination:  
            audited\_findings.append(finding\_obj)  
              
    return audited\_findings

Only findings cleared by the Judge model may be output to the developer, formatted as actionable single-click code patches and dependency walkthroughs.

### **6\. Validation Framework (SWE-bench Pro Environment Setup)**

To verify the generalization capabilities of the implemented agent, establish an internal testing suite modeled on SWE-bench Pro:

Python  
class TestHarness:  
    def \_\_init\_\_(self, repo\_path: str):  
        self.repo\_path \= repo\_path

    def run\_validation\_suite(self, patch\_file: str, test\_suite: list\[str\]) \-\> bool:  
        \# 1\. Apply patch to copyleft-protected sandbox repository  
        self.apply\_patch(patch\_file)  
          
        \# 2\. Issue Resolution: Run fail-to-pass (F2P) tests that failed on clean branch  
        f2p\_result \= self.execute\_isolated\_tests(test\_suite, mode="F2P")  
        if not f2p\_result.passed:  
            print("Validation Failed: Target bug is not resolved.")  
            return False  
              
        \# 3\. No Regressions: Run pass-to-pass (P2P) tests that verify existing features  
        p2p\_result \= self.execute\_isolated\_tests(test\_suite, mode="P2P")  
        if not p2p\_result.passed:  
            print("Validation Failed: Regressions detected.")  
            return False  
              
        return True

The testing harness must enforce copyleft-licensed container isolation, preventing target test databases from being leaked to public pre-training sets, thereby maintaining the integrity of evaluation metrics.

#### **Works cited**

> 1. AI Web Development Orchestration Research.md  
> 2. Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures \- arXiv, accessed July 25, 2026, [https://arxiv.org/pdf/2604.03515](https://arxiv.org/pdf/2604.03515)  
> 3. Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures \- arXiv, accessed July 25, 2026, [https://arxiv.org/html/2604.03515v2](https://arxiv.org/html/2604.03515v2)  
> 4. \[2604.03515\] Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures, accessed July 25, 2026, [https://arxiv.org/abs/2604.03515](https://arxiv.org/abs/2604.03515)  
> 5. (PDF) Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures, accessed July 25, 2026, [https://www.researchgate.net/publication/403562308\_Inside\_the\_Scaffold\_A\_Source-Code\_Taxonomy\_of\_Coding\_Agent\_Architectures](https://www.researchgate.net/publication/403562308_Inside_the_Scaffold_A_Source-Code_Taxonomy_of_Coding_Agent_Architectures)  
> 6. Daily Papers \- Hugging Face, accessed July 25, 2026, [https://huggingface.co/papers?q=ReAct-style%20capability%20formulation](https://huggingface.co/papers?q=ReAct-style+capability+formulation)  
> 7. Building an AI Polymath | American Academy of Arts and Sciences, accessed July 25, 2026, [https://www.amacad.org/publication/daedalus/building-ai-polymath](https://www.amacad.org/publication/daedalus/building-ai-polymath)  
> 8. RFC 106: Compiler-backed agent context graph \- Incan Documentation, accessed July 25, 2026, [https://incan.io/dev/RFCs/106\_compiler\_backed\_agent\_context\_graph/](https://incan.io/dev/RFCs/106_compiler_backed_agent_context_graph/)  
> 9. ArgosBrain vs Aider, accessed July 25, 2026, [https://argosbrain.com/vs/aider](https://argosbrain.com/vs/aider)  
> 10. Building a better repository map with tree sitter \- Aider, accessed July 25, 2026, [https://aider.chat/2023/10/22/repomap.html](https://aider.chat/2023/10/22/repomap.html)  
> 11. Repository map \- Aider, accessed July 25, 2026, [https://aider.chat/docs/repomap.html](https://aider.chat/docs/repomap.html)  
> 12. Token Optimization for Agentic AI \- Sombra, accessed July 25, 2026, [https://sombrainc.com/blog/token-optimization](https://sombrainc.com/blog/token-optimization)  
> 13. scale-ai/swe-bench-pro \- Harbor Hub, accessed July 25, 2026, [https://hub.harborframework.com/datasets/scale-ai/swe-bench-pro](https://hub.harborframework.com/datasets/scale-ai/swe-bench-pro)  
> 14. SWE-Bench Pro Leaderboard AI Coding Benchmark (Public Dataset) \- Scale Labs, accessed July 25, 2026, [https://labs.scale.com/leaderboard/swe\_bench\_pro\_public](https://labs.scale.com/leaderboard/swe_bench_pro_public)  
> 15. SWE-Bench Pro: Raising the Bar for Agentic Coding \- Scale AI, accessed July 25, 2026, [https://scale.com/blog/swe-bench-pro](https://scale.com/blog/swe-bench-pro)  
> 16. SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?, accessed July 25, 2026, [https://openreview.net/forum?id=uEVTdoAbnK](https://openreview.net/forum?id=uEVTdoAbnK)  
> 17. Generative AI for Managerial Decision-Making under Ambiguity and Sycophancy \- arXiv, accessed July 25, 2026, [https://arxiv.org/pdf/2603.03970](https://arxiv.org/pdf/2603.03970)

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAYCAYAAAAVibZIAAABCElEQVR4XmNgGAW0AIxA/AGI/yPhtygqIOAvA0IexCYKzGeAaHBAE0cGIHmSQAIDRFM1mjgMbARiY3RBQkCZAWLoNnQJIOAC4mfogsQCkKEf0QWB4Be6ACkAFhHIIBmIa9DESALYDEXnkwzQDb0GxKJIfHTQwgBRb4EugQxuMUAUMQPxTiDWQZXGCgj6ZB4DRJEfEN9Dk0MGHEAcCsQaQPwdTQ4DJDBgBgE6WATEkVA2SF09khxWoMgAUZiOLgEFKgyoFoLYIFcTBKfRBZDAQyCeg8TH5yOiASj85KFsUA78CcQ8QMwEV0EGKAHiHCBmY4BkW1CWPoCsgFzAB8RiULYMssQooB0AABG7ODXsBFLcAAAAAElFTkSuQmCC>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAABRElEQVR4XmNgGAVDDdQD8Rcg/g/FZ1GlMcBDBoRakL5iVGnCAKYZhHEBPSCuZYCoMUaTIxo8YUD4DBd4DMTHGPCrwQu8gDgFiLcw4DZkHZQm5Gu84ASUBoU3NkN4gDgXygbJr0aSIwnADAeFO4gtgyQHAj+gtDsDRF4LSY4k8BSJDTIoDomfD8TcUDbI59h8TBQAuTINiQ8yaCESHzmYcMWPDRBvRBdEB7D4gQGQQaDUBQLPkCUYIHKr0MRAABTkUuiC6ADdhTBX2wKxDpK4N1RcG0mMJPASjf+GAWLgbTRxUImB7igQAKn/gy6IDBiB+C4DpEhBBssZsBuILX76oTS6OBz0APEHIH4LxJ8ZUF3kA8ShSPyvDAi1n4D4NxBXIskLAvFfJD7NwEkgjkQXpAWABds+FFEagBtA/ABdcBSMAhQAAF4FU+4Q9CN2AAAAAElFTkSuQmCC>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAZCAYAAAAxFw7TAAAA/klEQVR4XmNgGAXUAIxA/AGI/yPhtygqIOAvA0IexCYI5jNAFDugiSMDkDzRIIEBoqEaTRwGNgKxMbogPqDMADFwG7oEEHAB8TN0QWIAyMCP6IJA8AtdgFgAC3RkkAzENWhiRANsBqLzSQLoBl4DYlEkPsngOwPCQFAkHUGSIwvsYYAYKAelKQb1DBCDHgOxJ5ocCKgD8SYgTgXiHUB8EIj9UVSgAUcGiIHv0SWgAJRFQa7/jSSG1ycsDBAFoPyNC8wC4nYkPl4DiQEgA3igbD0onyKAbMAbIBZE4pMMpBkg4fcOiH8AsSaqNOlgLhB3oQuSC1QYIN71QJcY4QAAyPg6jysLZTkAAAAASUVORK5CYII=>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAZCAYAAAAFbs/PAAAAhElEQVR4XmNgGAWDDcwC4mR0QSAwRhcAgV9AzAzE/4HYCUk8CyqGAhYyQBSDAEjSASHF8AEqhgJqoXQ3A6YkiL8ATQwOQJLPkfgwJ6ohiaEAkGQgEr8QKoYViDNgSr5DEnuFLAEDIEk9KFsDyn8I5T+A0igggwGiCIQrgJgLiT8KBhkAAGnpHwY2ul/pAAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,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>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFIAAAAZCAYAAACis3k0AAAC7UlEQVR4Xu2YSWsUQRiGP0XRIB7cIEQPQVwRRYPgiiCC6EVwRRC3gxr3RLwoIolePYl4d0cEwYsHQU+ioJ4kPyCgIOpZFHH7XqpmuuZNdXd1zUzDYD/wkfRT1V3VtXXViFRUVISzgEVJLGLRCro15rAsgb8sSuSdxlKWsdwS8zKIc5TWbj5rzGKpTNF4JqZObzXGNSYX5rzGcZYWlIHyWsJiMQ+cwAlt5IDGF5bKbDF16bLXM+z1+HqOMB5o/JRkkJxoTK6zWeMby1geStwU26nRL6a3ERsbkzNBeVhOGLwU6uOCKfiDXBGyGhIgHR3YNHhQaK9M1Pit8VhjtcZcjR6NmZKMojyQP63j4PeQu2h9LHkNiY56yTKUaxpX7P8o6JKTlkavxgeWEdwWM+2YDWLqsp78Qeunkw8lryH3SkRHXZDkJeZLsoZMqudI5xeLSDCi77FUBsTUpY/8butXkQ8lryFBoYY8IuaGyY57b10em6TYGpgFyrvKUswMQdoy8tut30c+FNx7kiUR0gZ1kPmTx30n5wPbpJU5EboPRZmHWSpHxaQtJ7/LenRmDLj3NEuCB1gqW8RkPkYeboicjxca23IidHOLMg+xlGSNXEN+v/WxX1bce4YlgTxTWfq4L2OH7zzrQnoCC3LsGsWgzGGWYtZppLXjq431N4vg59+QsZnvOs63+DO+L20MKPMOSwvSrpN7ar3LVo0l5NLAvYMsCX5+KjgGuZmxmcZ1zYU8CF/5EZYRYHakbbB9ow/XO5xrHBndumeB/S3yYbuXRq0tgsFiXatA7Sv2x16H7tGQD/lvaiwUs64UPQv3SnbFcbzDFgl/kc83LZ9ojLJ0eKTxVeOjmL0v/uJs75tVrzResywLnHBOaVwWs23BdobXtizQQNNYFuQNi0hQF7xPR3JWmj8lZY3qUNaJf5R2FDgpBW05POBnNqx/zYIlpMxfvdpG7KjCh69ZnmusYNmp4EPVikaJYS2LioqK/5J/Bo2uuK9xbaYAAAAASUVORK5CYII=>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAYCAYAAAB9ejRwAAABy0lEQVR4Xu2VzSuFQRTGD4rEysfKRixIkWykJB//AMJGkpKFFcrCV+TjH7CzklKyslOUnR2xYSPZW0gKWRDncWbee+Y094qye3/1dN/znDNzz52Zdy5RSsr/UcI6Zn2yzlh5YTonKyTjPliLYeqbadY+q8HF9axd1lRSEaGKZNJiF5e7OD+pyM4Jq1vFC6wnFYN1kvm0LoOKCC8kv0RzznozngVN31uT5EvxQz3LrE3WDslKFqhcVjDJkPHmnZ+LXorXwKtWMRrpUvGPdJBM0m78UeeXGV+Dc+i3o9Z5ODe2UWzpr5rCYcMkLcYfdH6r8S0HlGnsgvUcpr+ZY22Q1Gy7z62gwrBKUtRk/D7nDxs/xhVlGoMawzTNsI6Mh7o14yVMkBQ0G3/A+T3Gt+AlwaqCG8o0VppUxPF1UfyZajP+iPP1W2TBXXNqPJxNjLtWXuzOw52WtakikuRf3j7k/QHXLFE4Fs8PKvZezvmRxD2iOXS+Bo1qkMc2W8ZZtypG3ayKvWfnD4itCuJ+FT86b1J5WF07DsArVPErq1LFnSQ1dcqLskeyz/jEAPu/hDfqznhgjKQeV8G7e64IKgRsn18dqCZMp6SkpET5AuDqeFVU/IjWAAAAAElFTkSuQmCC>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAZCAYAAABKM8wfAAACE0lEQVR4Xu2WP0gcQRjFv8SYGIKFrWJAUpgmkBSKKAgSkVQ2NiFFDotA6oSEdDYKYmNjYaqkFTtBSJNUok1CsLGRWJoiRRSUkP/5HjPfOfd2Zm/3ogfC/eBxN+99NzM7Nzu7Ii3OHxNsFOQmG83gseoFmwV5r7rFZj1mVYeqv17fVF9VB6rf3tuvVtfSK+msKOj/GptFsAkz3eL8Iw7E+R1slgTb6ZjNImDwNTY9sYsZVn0nr1HQdw+beUyK+9FtDpQuOdkqIT+l8b3LYC9vsJnHB8muoGGrezHiXyXPwAK8VrWRjz6ukAfuS3r8KDapG144bha9txLUGZ2SHmBOVVHNSLYG7SXyDK7NBcXvVOOqu/7zoffXgzpjTNIDfPafe1Jbg9VGGzdxjFR/GWz/3uFA3N+H7BP5095nLqj6/HfkL4PsmfdSICt04nyU+h1xXol4IaPi8nDf21mfAhm2Wl1iEwqJ5UMRL2Rbsjnaq+SFcH0SFL5h02Orcp18O+pSILO9DLDS8LDt8H05yIy8/qo8EVc4QH6/uIcCskHKDGSX2fTsSO0EvgTtV6r2IANTUmfC86ofqj/iCk1o/xJ3kz2oVsdB/VM2A2ySuHCcEHgwoB1b3U3VFpunzXOJv180Ai6EV/1MwECX2CzJiLh/uyncU+2yWRK8wv7vRZdiQfWIzYK8lfgD68ypsFEQvKK2aFGWfwj9h0Fn6e+LAAAAAElFTkSuQmCC>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAAZCAYAAACsGgdbAAABzklEQVR4Xu2WzStEURjGX6EICwslX9mQjWRLEQsLFpKNDZGl4g9AjeyxY4Mi/gYbO2FBsbdTCitK5Pt9uufOHM/9OjPNlOJXT3Pf33nnnDN3zlxE/vl9tLJwoI1FIfli4ciZpp1lEluaR/EW9fOgWbGbiFtNDcsswBoVLF3wN5jEhOaOZZYMaJ5YJlEk3gbPeSAE9NWyzAHMU88yjhnx3jTIA0SduN1tF3A2j1jGgTPmsviO5pWlxbxmnNw21T5j4rZmGtfz+KHZY2l4M6+Yp8dcT5s6ZWrGZc00aD5lGQL6llkqm5pKc42eXmsMHyxl1TbOm0w6j/3WNfqmrNpn0byuSXDhdU0DOR/0lrEM416CE9vgmemDvkmrZjB+Qw7nPQr0V7EMA41Rm1zQ9Fk1+pasmsH4MLkLqm2i1v1BsXiNlzygNEpwEtS75HyaJNg/K95jKwruD2VVvMYR8hvG813Y17yQs8F7Osx1uebKGmNGJWGTuBt43uGX9ymZrxxB/a55luCBb5b4iYckM88BjTHHmhOW+QIbqGaZA5inlGW+mNNcs8ySbon/y5UXcBycHh0R4JiVsCwEcWczjkNNJ8tCgX/vWlg60MXinz/PN1vzbTUj0bPRAAAAAElFTkSuQmCC>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAYCAYAAAAs7gcTAAAAeklEQVR4XmNgGAX0BtVAHIsmNh+NDwa/ofR/ILaDspOh/AYoHwzmAjEPlA2StEeS+8uAprgWSk9ggChGBtOBWAZNDAxACqdgEcMAQgwQCTkkMW4gLkHiwwELA6Ypb9H4KOAPEF8AYn4gPgnEKqjSmMAAiCPQBUcBxQAAKD4VNTONriAAAAAASUVORK5CYII=>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACYAAAAZCAYAAABdEVzWAAABvElEQVR4Xu2VTSsFcRTGj1BeFxYiJBuyQbKjkIWNhWRjQ2QjC7JTUleWNnZKyVt8Bhs7sbHwASxIEQvZKHmJ8zT/6Z6eMXPnzr1Z6P7qaeb8zpn/zHTnzogU+FvaWMSknUU++WaRBZeaDpb54FFTyzJLcGOVLHNhSvPEMgHDmleWuYA7rWeZEKzVyDIJDZLbs8XgWTtjyaxoJsntUn2geSdn2dbMslR6WDgmJMONfrgthvrdPk6AOuVq8KU5MrUFF1ws3jFDxs87F0Zob0dT5fYxNGB6uJCUqdFfN7XPvngXBTAzmG7Ji3NhhPZW3XZTgkNbmiZToz9jah9/jQ0JroF6j5wF/TKWFgzck8P7yoKZaXIW9B9M7f+0UV8I9KtZWjAwSu6KasyskbOgP2bqJeeiiOw3S3BgQbzXgwUzh+R86iS4xrNxYS9lPiYABrrcfrnm2vR8jjVvLA1Yo9Pt40ON+tbVN25rGZcYFzYi3hByQj2fFoleaE7SayxrKkz9G+eaC5ZJwUlqWCYEa5WyTMqi5o5lAvok+iuSiE/J8BePAV7eJSzzQdhzE4dTTTfLfFGkaWUZk14WBf4tP9NMYp8nJUYEAAAAAElFTkSuQmCC>