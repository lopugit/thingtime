# AI API costing — market analysis & research (August 2026)

Research supporting the NSFW/TOS media-moderation pipeline (PR #308): what the
pipeline spends per image today, what every realistic alternative costs, and
which levers change the bill. All prices were verified against **official
pricing pages fetched 2026-08-19** by a multi-agent research pass, then
adversarially re-checked by two independent verification agents; corrections
from that pass are already folded in. Figures marked *unverified* could not be
confirmed on an official page this session.

> **Standard comparison call** used throughout: one ~1 MP image (1024×1024)
> plus Thingtime's ~270-token moderation prompt in, a ~100-token strict-JSON
> verdict out. Prices are USD list prices; batch/caching discounts are noted
> separately.

## TL;DR

- Thingtime's default (`claude-opus-5`) costs **~$0.011 per moderated image**
  (~$11 per 1,000). Dropping to `claude-sonnet-5` is ~$0.0043, `claude-haiku-4-5`
  ~$0.0021 — a 2.5–5× saving behind the existing `TT_MODERATION_MODEL` env var
  with no code change.
- Dedicated moderation APIs run **$0.00075–$0.003 per image** (Azure Content
  Safety $0.75/1k, AWS Rekognition $1.00/1k, Google SafeSearch $1.50/1k, Hive
  $3.00/1k). OpenAI's `omni-moderation-latest` moderates images **for free**.
- The old "LLM vision costs 10–100× more than dedicated APIs" framing is dead:
  budget multimodal tiers (Gemini Flash-Lite ~$0.0002, GPT-5.6 Luna ~$0.0004)
  now **undercut** dedicated APIs; the premium only survives at the frontier
  tier (~3–10×).
- Self-hosted open classifiers (Falconsai ViT, NudeNet v3) on serverless GPUs
  cost **$0.01–$0.50 per 1,000 images** — 10–100× cheaper than any API — but
  you own accuracy, thresholds, and appeals.
- Market context: equivalent-capability token prices fell ~88% since 2023 and
  ~39% in H2 2025 alone, but 2026 shows stabilization (-6% YTD), premium SKUs
  are appearing above base tiers, and Google has pre-announced a Flash price
  *increase* for Jan 2027. 50%-off batch APIs and ~90%-off cached input are now
  standard at all three majors.

## 1. What the Thingtime pipeline spends today

One non-streaming Claude Messages call per ready image attachment
(fire-and-forget on upload completion via `queueAttachmentModeration`, plus the
admin sweep retrying unstamped docs in batches of 10). Parameters, from
`remix/app/api/utils/moderation/`:

| Parameter | Value | Cost effect |
| --- | --- | --- |
| Default model | `claude-opus-5` ($5 in / $25 out per MTok); `TT_MODERATION_MODEL` overrides; a named first entry in the admin AI-model waterfall wins over both | `claude-fable-5` first in the waterfall **doubles** every figure ($10/$50) |
| Prompt | ~270 tokens, strict-JSON classifier instructions | Sent *after* the image block → cannot form a cacheable prefix, and is below the 512-token cache minimum anyway: every call pays full input price |
| Image bytes | Full-size S3 bytes, base64, **no downscaling**; ≤ 10 MiB; jpeg/png/gif/webp only | Token count follows Anthropic's patch formula (below). The 10 MiB byte cap does **not** bound pixel dimensions — a 10 MiB JPEG can far exceed 1 MP and bill up to the 4,784-token/image cap |
| Output | `max_tokens: 2048`; verdict is ~60–100 tokens | Opus 5's adaptive thinking bills as output inside the cap → typical real spend ~60–300 tokens, worst case 2,048 |
| Skips (zero API cost) | non-image types, `too-large` (>10 MiB), provider `off`/`test`, already-stamped docs | Only still images are ever billed |
| Refusals | stamped blocked + quarantined, terminal (never retried) | One round trip spent; no fallback-model cascade |
| Failure retry | an *unparseable* response leaves the doc `pending` | each admin sweep **re-bills a full call** for the same image until it parses or is manually reviewed — the one real cost-amplification bug surface |

**Image token math (verified):** Claude bills `ceil(width/28) × ceil(height/28)`
visual tokens — 28-px patches. 1024×1024 → 37² = **1,369 tokens**; 1000×1000 →
1,296; 200×200 → 64. High-res tier (Claude 4.7+, incl. Opus 5 / Sonnet 5 /
Fable 5) downscales above a 2,576-px long edge and caps at **4,784
tokens/image**; the standard tier (Haiku 4.5, Sonnet ≤4.6) downscales above
1,568 px and caps at 1,568. The older `(w×h)/750` rule is retired.

**Per-image cost on the current default (Opus 5):**

```
input  = (1,369 image + ~270 prompt) × $5.00/1M  = $0.0082
output = ~100 × $25.00/1M                        = $0.0025
total ≈ $0.0107 per moderated 1 MP image  (~$10.70 per 1,000)
```

Bounds: tiny 200×200 thumbnail ≈ **$0.0042**; absolute worst case (max-res
image at the 4,784-token cap + fully exhausted 2,048-token output) ≈
**$0.0765**. If the waterfall selects Fable 5, double everything (~$0.0214
typical).

## 2. Frontier multimodal LLM APIs

All three majors: uniform **50% batch discount** (async, ≤24 h) and **~90%-off
cached input**. Anthropic stacks batch × caching; caching doesn't help our
current image-first message shape (see §7).

### Anthropic Claude ([pricing](https://platform.claude.com/docs/en/about-claude/pricing), [vision](https://platform.claude.com/docs/en/build-with-claude/vision))

| Model | Input /MTok | Output /MTok | Std call¹ | Batch call |
| --- | --- | --- | --- | --- |
| Fable 5 | $10.00 | $50.00 | $0.0214 | $0.0107 |
| **Opus 5** (= Opus 4.5–4.8) | $5.00 | $25.00 | **$0.0107** | $0.0053 |
| Sonnet 5 | $2.00 | $10.00 | $0.0043 | $0.0021 |
| Sonnet 4.6 / 4.5 | $3.00 | $15.00 | $0.0064 | $0.0032 |
| Haiku 4.5 | $1.00 | $5.00 | $0.0021 | $0.0011 |

¹ (1,369 image + 270 prompt) input + 100 output tokens.

Notes: Sonnet 5's $2/$10 launch price was **made permanent** (the scheduled
Sept 1, 2026 rise to $3/$15 was cancelled) — older Sonnet 4.6 now costs *more*
than Sonnet 5. Opus 4.1/4.0 ($15/$75) are retired on the first-party API (4.1
lives on via Bedrock and Google Cloud; 4.0 Google Cloud only). Cache
multipliers: write 1.25× (5-min) / 2× (1-hr), read 0.1×. No long-context
surcharge on 4.6+ (full 1M context at flat rates). Fast mode (Opus 5/4.8
research preview) is a $10/$50 premium SKU. Sonnet 5's newer tokenizer produces
~30% more *text* tokens than 4.6 for the same content.

### OpenAI ([pricing](https://developers.openai.com/api/docs/pricing))

Images on the GPT-5.6 family bill as 32-px patches, no multiplier: 1024×1024 →
32² = 1,024 tokens.

| Model | Input /MTok | Output /MTok | Std call² |
| --- | --- | --- | --- |
| gpt-5.6-cyber (no batch) | $12.50 | $75.00 | $0.0237 |
| gpt-5.6-sol (flagship) | $5.00 | $30.00 | $0.0095 |
| gpt-5.6-terra (mid) | $2.00 | $12.00 | $0.0038 |
| gpt-5.6-luna (mini) | $0.20 | $1.20 | $0.0004 |
| **omni-moderation-latest** | **Free** | **Free** | **$0.00** |

² (1,024 image + 270 prompt) input + 100 output tokens; batch halves these.

The moderation endpoint is confirmed still free in Aug 2026 and **accepts
images up to 20 MB** (13 harm categories, some text-only) — a hard $0 price
floor for a first-pass NSFW gate. July 30, 2026 cuts: Terra -20%, Luna -80%.
Prior generations (gpt-5.5, 5.4 family, 5 family: $1.25/$10 down to nano
$0.05/$0.40) remain offered.

### Google Gemini ([pricing](https://ai.google.dev/gemini-api/docs/pricing), [media resolution](https://ai.google.dev/gemini-api/docs/media-resolution))

Gemini 3.x bills a fixed per-image budget via `media_resolution` (default 1,120
tokens; low = 280). Gemini 2.5 uses 258-token 768×768 tiles (1024×1024 → 4
tiles = 1,032 tokens).

| Model | Input /MTok | Output /MTok | Std call³ |
| --- | --- | --- | --- |
| 3.1 Pro Preview (no free tier) | $2.00 (≤200k) | $12.00 | $0.0040 |
| 3.7 / 3.6 Flash (promo → Dec 31 2026) | $0.75 → $1.50 | $3.75 → $7.50 | $0.0014 → $0.0028 |
| 3.5 Flash | $1.50 | $9.00 | $0.0030 |
| 3.5 Flash-Lite | $0.30 | $2.50 | $0.0007 |
| 2.5 Flash | $0.30 | $2.50 | $0.0006 |
| 2.5 Flash-Lite | $0.10 | $0.40 | $0.0002 |

³ Gemini 3.x: (1,120 + 270) input + 100 output; 2.5: (1,032 + 270) + 100.
During the Flash promo window, batch = 50% of the *promo* rate ($0.375/$1.875).

Gemini keeps a genuine **free tier** on every listed model except 3.1 Pro
Preview (content used for product improvement — likely unacceptable for user
uploads). The Flash promo ending Jan 1, 2027 is a rare *pre-announced price
increase*. Vertex AI mirrors these per-token rates (*parity partially
verified — official Vertex page fetch truncated*).

## 3. Dedicated content-moderation APIs

Flat per-image pricing, purpose-built taxonomies, no prompt engineering — but
also no custom policy nuance (they can't apply "artistic nudity still counts
for blurring" the way our prompt does).

| Service | Per image (low volume) | Free tier | Notes |
| --- | --- | --- | --- |
| OpenAI omni-moderation | **$0.00** | unlimited (rate-limited) | text + images ≤20 MB, 13 categories |
| Azure AI Content Safety | $0.00075 | 5,000 img/mo (F0) | $0.75/1k (S0, eastus, via Retail Prices API — public page hides figures); commitment tier $169/250k |
| AWS Rekognition | $0.0010 | 1,000 img/mo (12 mo) | tiers: 1M @ $1.00/1k → next 9M @ $0.80 → next 40M @ $0.60 → >50M @ $0.25/1k |
| Google Vision SafeSearch | $0.0015 | 1,000 units/mo | $0.60/1k above 5M; **free when bundled with Label Detection** |
| Sightengine | ~$0.002–0.003/op | 2,000 ops/mo | bills per *model* checked per image (nudity+violence = 2 ops); Starter $29/10k ops |
| Hive AI | $0.0030 | $50 credits | self-serve capped at 100 req/day; volume = sales |
| Clarifai | ~$0.004 *(unverified)* | ~1,000 ops/mo | pricing page JS-rendered; figures third-party, confirm before relying |
| Cloudflare Workers AI | ~$0.00035 *(DIY)* | 10k neurons/day | no vision safety model offered; Llama 3.2 11B Vision prompted DIY, token math assumption-based |

## 4. Open-source / self-hosted

Two tiers, both far cheaper per image than any API:

**Dedicated classifiers (weights free):**
[Falconsai/nsfw_image_detection](https://huggingface.co/Falconsai/nsfw_image_detection)
(Apache-2.0 ViT-base, binary normal/nsfw, the de-facto standard) and
[NudeNet v3](https://github.com/notAI-tech/NudeNet) (ONNX, granular
exposed/covered detection). On the cheapest serverless GPUs — Modal T4
$0.000164/s, RunPod A4000 $0.58/hr, Replicate T4 $0.000225/s — a batched
ViT sustains ~20 img/s: **~$0.008–0.011 per 1,000 images**. Invoked
one-at-a-time with ~0.5–1 s serverless overhead: ~$0.10–0.50 per 1,000. The
old LAION/SD safety checker is effectively obsolete for upload moderation.

**Open VLMs (policy-aware, closest to our current approach):**
Llama Guard 4 12B (multimodal, promptable taxonomy) on Together AI at $0.20/MTok
≈ **$0.0004/image**; Llama 4 Scout $0.18/$0.59 ≈ $0.0004; Qwen2.5-VL 72B via
OpenRouter from $0.25/MTok input ≈ $0.0003/image (*hosted rates vary by
provider; Together's rate unverified*). The 7B Qwen variant self-hosts on one
24 GB GPU.

Trade-offs: no SLA; you own accuracy benchmarking, threshold tuning,
false-positive appeals, and model updates; binary classifiers miss context
(medical/art/racy-but-allowed); cold starts (seconds for a ViT, much longer for
a 7B+ VLM) force keep-warm spend for latency-sensitive flows.

## 5. Market trends (through Aug 2026)

- **Collapse, then plateau.** Equivalent-capability token prices are down ~88%
  since March 2023 (GPT-4 launched at $30/$60; GPT-4-class work now runs at
  ~$0.10–0.40/MTok tiers). H2 2025 alone fell ~39% (YipitData, ~150T
  tokens/mo tracked), driven partly by Anthropic's 67% Opus cut ($15/$75 →
  $5/$25). But 2026 YTD is only ~-6% and enterprise effective pricing is flat —
  the race to the bottom is moderating.
- **2026 moves worth citing:** Anthropic made Sonnet 5's $2/$10 permanent and
  held Opus 5 at $5/$25 (capability up, price flat); OpenAI cut Terra 20% and
  Luna 80% on July 30; Google pre-announced the Flash promo *ending* Jan 1,
  2027 (~2× increase). Premium SKUs are emerging *above* base tiers (Fable 5
  and Claude fast mode at $10/$50, gpt-5.6-cyber at $12.50/$75).
- **Batch + caching are table stakes.** 50%-off batch and ~0.1× cached-input
  pricing at all three majors; caching adoption is a primary driver of falling
  *effective* prices even where list prices held.
- **Vision classification has commoditized.** A ~1 MP image is ~1,000–1,400
  tokens everywhere, so budget multimodal endpoints classify an image for
  $0.0001–0.0013 — at or below dedicated per-image CV APIs. The frontier-tier
  premium over dedicated APIs is now ~3–10× (was 10–100×), reaches parity at
  the Haiku/Sonnet-batch tier, and inverts at the budget tier.

## 6. Monthly projections for Thingtime

Cost of moderating N image uploads/month, standard (non-batch) rates, typical
~1 MP images:

| Images/mo | Opus 5 (default) | Sonnet 5 | Haiku 4.5 | Fable 5 | Rekognition | Azure CS |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | $10.70 | $4.30 | $2.10 | $21.40 | $1.00 | $0 (F0) |
| 10,000 | $107 | $43 | $21 | $214 | $10 | $3.75 |
| 100,000 | $1,070 | $428 | $214 | $2,140 | $100 | $71 |
| 1,000,000 | $10,700 | $4,280 | $2,140 | $21,400 | $1,000 | $746 |

(Azure rows net out the 5,000-image free tier; Rekognition is tier-1 flat.
Batch API halves each Claude column where latency allows.)

Beta-period reality check: at hundreds of uploads/month the *entire* bill on
the Opus 5 default is a few dollars — model choice is not a beta concern. It
becomes one around ~50k+ images/month.

## 7. Cost levers, cheapest first

1. **Free first-pass gate (optional layer):** OpenAI `omni-moderation-latest`
   is $0 for images ≤20 MB. Route only its flagged/uncertain results to Claude
   for the policy-nuanced verdict → cuts paid calls to a small fraction at the
   cost of a second vendor dependency. Azure F0 (5k/mo free) is an alternative.
2. **Model tier via existing env var (no code):** `TT_MODERATION_MODEL=claude-haiku-4-5`
   ≈ 5× cheaper than Opus 5; `claude-sonnet-5` ≈ 2.5× cheaper. Classification
   against our explicit written policy is well within Sonnet/Haiku capability;
   keep Opus for the admin re-review path if wanted. Conversely: putting
   `claude-fable-5` first in the admin waterfall silently doubles spend.
3. **Batch API for the sweep path (code):** the admin sweep and any backfill
   are latency-insensitive — Message Batches would halve them. The upload-time
   call is fire-and-forget too; if minutes-scale stamping latency is
   acceptable, batch everything for a flat 50% cut.
4. **Downscale before send (code):** we currently ship full-size bytes; a 10
   MiB JPEG can bill up to 4,784 image tokens (~3.5× a 1 MP image). Resizing to
   ≤1,092 px long edge (39×39 patches ≈ 1,521 tokens) caps the worst case and
   loses nothing for classification.
5. **Fix the unparseable-response retry loop (code):** a doc left `pending` by
   a bad response is re-billed on every sweep. Stamp a bounded retry count or a
   `failed` status after K attempts.
6. **Prompt caching: not applicable today** — the ~270-token prompt sits after
   the image and is below the 512-token cache minimum. Only worth revisiting if
   the prompt grows past ~512 tokens *and* moves ahead of the image block.
7. **Self-hosted pre-filter (bigger lift):** a Falconsai/NudeNet pass at
   ~$0.01/1k images in front of Claude only pays off at serious volume; revisit
   at ≥500k images/month.

**Recommendation:** keep `claude-opus-5` through beta (volume makes cost
irrelevant; accuracy and the policy-nuanced refusal→quarantine behavior matter
more), plan to flip `TT_MODERATION_MODEL` to `claude-sonnet-5` or
`claude-haiku-4-5` as volume grows, and take levers 3–5 as cheap hardening
whenever the pipeline is next touched. The dedicated-API/self-hosted routes
only become interesting past ~1M images/month, at the price of losing our
custom TOS taxonomy in the primary gate.

## 8. Method & verification notes

- Six parallel research agents (Anthropic / OpenAI / Google / dedicated APIs /
  self-hosted / trends) fetched official pricing pages live on **2026-08-19**;
  a seventh extracted pipeline parameters from this repo's moderation code; two
  adversarial verifiers then independently re-fetched sources and re-did the
  arithmetic.
- Corrections applied from verification: Claude image tokens use the
  `ceil(w/28)×ceil(h/28)` patch formula (retired `px/750` rule initially used
  for the pipeline estimate — dollar conclusions survived); Rekognition tier
  boundaries are 1M/9M/40M/50M+; Gemini Flash promo batch = 50% of the promo
  rate; Opus 4.0 survives only on Google Cloud (not Bedrock); Qwen2.5-VL hosted
  rates start at $0.25/MTok (OpenRouter/Nebius), not ~$0.80.
- Remaining unverified: Clarifai pricing (JS-rendered page), exact Vertex AI
  table values (page fetch truncated; parity via secondary trackers), Together's
  Qwen2.5-VL rate, Cloudflare vision token conversion (undocumented), exact
  GPT-5.6 patch budgets at `detail: low/high`.
- Prices change frequently; treat everything here as a snapshot dated
  **2026-08-19** and re-verify before committing to volume contracts.

### Primary sources

- https://platform.claude.com/docs/en/about-claude/pricing · https://platform.claude.com/docs/en/build-with-claude/vision
- https://developers.openai.com/api/docs/pricing · https://developers.openai.com/api/docs/guides/moderation · https://developers.openai.com/api/docs/guides/images-vision
- https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/image-understanding · https://ai.google.dev/gemini-api/docs/media-resolution
- https://aws.amazon.com/rekognition/pricing/ · https://cloud.google.com/vision/pricing · https://azure.microsoft.com/en-us/pricing/details/cognitive-services/content-safety/ (+ Azure Retail Prices API)
- https://thehive.ai/pricing · https://sightengine.com/pricing · https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://replicate.com/pricing · https://modal.com/pricing · https://www.runpod.io/pricing · https://www.together.ai/pricing
- https://www.yipitdata.com/resources/blog/cloud-llm-pricing-trends · https://tokencost.app/blog/ai-price-index
