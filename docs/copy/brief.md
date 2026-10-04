# Solenoid copy brief

**Status:** confirmed by Robin, 2026-09-24
**Governs:** every piece of reader-facing copy: the site, the SDK README, `llms.txt`, CLI output, MCP tool descriptions, and posts.
**Gate:** nothing ships until a cold `/copy-chief` diagnostic has passed it. The grader subagent gets the draft, `checks.md`, `ai-tells.md`, and the medium, and nothing else: not this brief, not the conversation. Fix every Gate 0 item. Fix or explicitly accept every finding.

## 1. Awareness stage

- **Actions: problem-aware.** The reader has lived the incident, or dreads it: an agent that sends the same email forty times, refunds twice in a retry storm, or deletes what it was told not to touch. They haven't shopped for a fix, because they don't know one exists.
- **Model spend: solution-aware.** The reader already knows about provider and gateway caps and probably has one switched on. Copy that sells budgets tells them nothing new.
- **Consequence:** open on the failure moment. Bring in the mechanism second. Mention model spend only as "keep your gateway for that".

## 2. Market sophistication

"Budgets for AI" is at **stage 4**. OpenAI, Anthropic, Cloudflare, Vercel, LiteLLM and Portkey all make the bare claim, so a fifth version is invisible. Win on **mechanism**: the check happens before the action, in one atomic transaction, and returns a signed receipt. Or win on restraint. Never on the promise alone.

## 3. The one reader

A lead engineer at a 10 to 40 person startup who has just given a support agent tools that send email and issue refunds.
- Parallel sub-agents already run in production. OpenAI's hard cap is already on.
- **Their fear:** typing "stop" and watching nothing happen. Then explaining in Slack why a customer got forty emails and two refunds, with no record of what the agent actually did.

Write to this person, not to "teams" or "organisations".

## 4. The offer, in one sentence

> One command gives your agent a key; one call before each action caps it and hands back signed proof, free for the first 100,000 actions a month.

## 5. Proof inventory

Every claim the copy may make, and what sources it. A claim that isn't in this table doesn't get written until it's added here with a source.

| Claim | Source | Status |
|---|---|---|
| Exactly N of M concurrent spends are recorded | The first test in `e2e/test/concurrency.test.ts` at the launch tag (30 spends, limit 7); its recorded replay is the landing demo, from `e2e/record-race.ts` | at repo launch |
| Parallel model calls are held before the provider call | The hold-and-settle test in the same file, at the launch tag | at repo launch |
| At-most-once from the same primitive | The `per: "child"` test in the same file, at the launch tag | at repo launch |
| Signed receipts verify offline | `verifyChain([receipt], keys)` exported from `@solenoid.systems/sdk`, with `keys` saved from `/.well-known/solenoid.json` | live |
| No signup form | `npx @solenoid.systems/cli init <scope>`, recorded | at npm publish |
| Fails closed; `on_outage` per limit | The docs | live |
| The admin key can be recovered by email | The README's Recovery section | live |
| You can read and run the code | The `LICENSE` files and `LICENSING.md`. The Worker is "source-available" under FSL-1.1-ALv2 and is **never** called "open source", because FSL is not an OSI license. The SDK, CLI and MCP are MIT. | at repo launch |
| Pricing | `/pricing` | at site launch |
| Dogfooded by learning-loop | **Struck.** The integration was dropped (learning-loop PR #131, closed 2026-09-28). | struck |
| Any latency figure | Not claimable: the numbers are from the old stack | blocked |
| "At the edge" | Never | banned |
| Named competitor comparisons | Leave them out. If one is ever needed, cite and date it from the competitor analysis. | avoid |

### Sourced incidents (for "why this exists" and hero scenarios)

| Incident | Primary source | What a limit outside the agent does |
|---|---|---|
| 23 Feb 2026. An OpenClaw agent told to "confirm before acting" started deleting its owner's inbox, ignored the stop commands she sent from her phone, and she had to run to the machine. Her post: "Nothing humbles you like telling your OpenClaw “confirm before acting” and watching it speedrun deleting your inbox. I couldn’t stop it from my phone. I had to RUN to my Mac mini like I was defusing a bomb." TechCrunch: "ignoring her commands from her phone telling it to stop" and "Yue believes that the large amount of data in her real inbox “triggered compaction,” she wrote." Compaction is her explanation, not an established cause, and TechCrunch "could not independently verify what happened". Per PC Gamer she tried "variations of a "stop" command, but not the word on its own", so never quote a literal "STOP". | [Owner's post on X](https://x.com/summeryue0/status/2025774069124399363), [TechCrunch](https://techcrunch.com/2026/02/23/a-meta-ai-security-researcher-said-an-openclaw-agent-ran-amok-on-her-inbox/), [PC Gamer](https://www.pcgamer.com/software/ai/i-had-to-run-to-my-mac-mini-like-i-was-defusing-a-bomb-openclaw-ai-chose-to-speedrun-deleting-meta-ai-safety-directors-inbox-due-to-a-rookie-error/) | `deletes: 0`, set from a phone, holds regardless of what the agent remembers |
| SaaStr's outbound agent invented an A/B variant offering free SaaStr Annual tickets, with no approval. The post: "the “B” variant it created offered free tickets to SaaStr Annual 2026. Without our consent. Without any human approval." and "And it cost us $2,000+, which we had to pay out of pocket." | [SaaStr (Lemkin)](https://www.saastr.com/a-great-year-with-our-20-ai-agents-but-a-rough-week), published 21 Dec 2025 per the page's `article:published_time` metadata; no date is shown in the body. | `free_tickets: 0`, or N per month |
| 14 Jul 2026, 14:40 to 17:00 UTC. Zendesk AI agents looped, sending repeated messages to end users. The page: "AI Agents getting stuck in loops and sending repeated messages in bot conversations. In some cases, this continued even after an end user stopped responding or after a human agent replied." Keep "in some cases". | [Zendesk incident page](https://support.zendesk.com/hc/en-us/articles/11046894936218-Service-Incident-July-14-2026-AI-Agents-Multiple-Pods-AI-Agents-Repeating-Messages) | A per-conversation `messages` limit (`per: "child"`) caps how far the damage spreads |
| Jul 2025. Replit's agent deleted a production database during a code freeze, then claimed rollback was impossible. | [The Register](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/), [AI Incident DB #1152](https://incidentdatabase.ai/cite/1152/) | A code freeze as `destructive_ops: 0` |

Excluded: the anonymous "$47k in 11 days" and "$4,200 in 63 hours" cost stories. They're unverifiable, and Gate 0 would block them.

## Guardrails

- **No counterfactuals.** Never say Solenoid "would have prevented" an incident. That fails check X2 and falls under NZ Fair Trading Act 1986 s12A. State the mechanism instead: a limit enforced outside the agent stops the next action, and only for tools that call Solenoid before they act. The copy says that condition out loud.
- **No names in sales lines.** Describe the pattern and footnote the source. Named incidents belong on a "why this exists" page, told with care.
- **Voice:** no em or en dashes (including `--`), no "X, not Y" constructions, no tricolons built for rhythm. One concrete reader, one action per call to action.
- **Risk reversal comes from the product:** fail closed by default, `on_outage` per limit, and every action recorded. State it; don't just imply it.
- **Every call to action says what happens next**, for example: "`npx @solenoid.systems/cli init <scope>` writes a spend key to `.env` in your terminal". Key it for attribution (a `?ref=` tag on links, or a distinct init source).
