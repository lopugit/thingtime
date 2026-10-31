# Support page and funding launch runbook

Updated 14 September 2026. This is the public implementation runbook. Financial
budgets, income targets, prospect lists and draft investor materials belong in
an owner-controlled private plan, not public repository history.

## Implemented

- `/support` offers contributions through the existing
  [Thingtime campaign](https://www.gofundme.com/f/thingtime), paid setup/workflow
  quote enquiries, and business/infrastructure sponsorship enquiries.
- GoFundMe's live checkout offered Give once and Monthly choices in the launch
  check. The provider owns checkout, recurring fees, cancellation and transfers.
  Donation availability does not establish payout readiness or a successful charge.
- Setup and sponsorship each have an editable subject/message. Switching retains
  each draft for the mounted page. Visitors can open their email app or copy
  the draft; the page does not send email, save the contents or process payments.
- The homepage and shared footer link to support. The active funding section
  no longer shows hard-coded raised totals, backer counts, deadlines, merchandise
  or lifetime access promises, or the unavailable Indiegogo prelaunch link.
- `.github/FUNDING.yml` uses the existing campaign for GitHub's support button.

## First 48 hours

1. Reconcile current bills, due dates, existing credits and cleared funds privately.
   Choose a dated near-term cash gap; do not use historical campaign gross as
   available money.
2. Verify the fundraiser's recipient, transfer readiness and any payout holds in
   the organizer dashboard. New donations and transfers have processing delays.
3. Validate and promote this support-page change through the normal PR process.
4. Agree one deliverable, available hours, price, cancellation terms and payment
   arrangement for an initial paid setup experiment. Contributions and service
   invoices are separate; support does not buy AI credits.
5. Review one campaign update and a small batch of personalized messages to people
   who have expressed relevant interest. Obtain authorization before sending.
6. Deliver the first paid result, record actual cost/time, and ask for feedback
   and permission before publishing any testimonial.

## Continue for two weeks

Track cleared contributions, service receipts, delivery costs, refunds, founder
hours, recurring renewals and credit savings separately. Review the offer after
five qualified conversations. If a first batch of twenty relevant messages and
one appropriate follow-up produces little interest, improve the audience/offer
before expanding it. Stop on opt-out or continued silence.

Recurring support, paid services, restricted vendor credits and investment are
distinct. A post, application, payment-link click or historical pledge is not
cash received. Never promise unlimited AI, investment returns or eligibility
for a grant/program without evidence.

## Channel reference links

- [GoFundMe Australia pricing](https://www.gofundme.com/en-au/c/pricing) and
  [transfer expectations](https://support.gofundme.com/hc/en-us/articles/360042184631-Transferring-money-to-your-personal-bank-account).
- [MongoDB for Startups](https://www.mongodb.com/solutions/startups): assess current
  Atlas costs and actual entity eligibility before applying for restricted credits.
- [Vercel OSS](https://vercel.com/open-source-program): verify the live intake and
  project licence/community requirements; public source alone is insufficient.
- [GitHub Sponsors eligibility](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors)
  and [payment terms](https://docs.github.com/en/site-policy/github-terms/github-sponsors-additional-terms).
- [Patreon fee structure](https://support.patreon.com/hc/en-us/articles/36426991446797-A-standard-platform-fee-for-new-creators-effective-after-August-4-2025):
  compare costs and ongoing membership obligations before launching a second channel.
- [Blackbird investment](https://www.blackbird.vc/get-investment),
  [Startmate](https://www.startmate.com/accelerator/program) and
  [Antler Australia](https://www.antler.co/location/australia): longer-term
  investment routes, subject to fit, selection and negotiated terms.

## Setup and verification

Public destinations are defined in
`remix/app/components/Support/supportContent.ts`. Forks must replace the campaign
and contact email there and in README/FUNDING before publishing. No credentials
are needed for this feature. Do not configure the donation URL as a Lopu credit
purchase destination; the existing optional top-up link does not grant credits.

Follow the funding checklist in `TESTING.md`. Test the homepage and support page
at desktop/mobile widths, scroll to the footer, switch enquiry types, preserve
edits, inspect mailto encoding, copy the draft and check the manual-copy fallback.
Do not send a test email or make a payment as part of UI verification.

Production status and exact validation evidence belong in the PR. An open PR
or local preview does not mean the support page has been released.
