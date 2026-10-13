export const meta = {
  name: 'review-change',
  description: 'Review the current change through Celestia guardrail + convention lenses in parallel, then adversarially verify each finding; returns ranked confirmed findings.',
  phases: [
    { title: 'Review', detail: 'guardrail-warden + context-compliance over the change' },
    { title: 'Verify', detail: 'adversarially re-check each finding, default not-real' },
  ],
}

// Scope: working-tree by default; pass args {mode:'branch', base:'main'} to review a branch diff.
const scope = (args && args.mode === 'branch')
  ? `the diff of the current branch against '${(args && args.base) || 'main'}'`
  : 'the uncommitted working-tree change (git diff HEAD + untracked files)'

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          rule: { type: 'string', description: 'cited guardrails.md#G<n> or .context doc#section' },
          summary: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'rule', 'summary'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean', description: 'true ONLY if the violation genuinely exists at the cited line' },
    inScope: { type: 'boolean', description: 'true ONLY if it falls within the reviewed change' },
    reason: { type: 'string' },
  },
  required: ['isReal', 'inScope', 'reason'],
}

const LENSES = [
  { agentType: 'guardrail-warden', label: 'guardrail' },
  { agentType: 'context-compliance', label: 'convention' },
]

phase('Review')
const lensResults = await parallel(LENSES.map((lens) => () =>
  agent(`Review ${scope}. Report only violations present in the changed lines, each grounded in a cited rule.`, {
    label: `review:${lens.label}`,
    agentType: lens.agentType,
    phase: 'Review',
    schema: FINDINGS_SCHEMA,
  })
))

const allFindings = lensResults
  .filter(Boolean)
  .flatMap((r, i) => (r.findings || []).map((f) => ({ ...f, lens: LENSES[i].label, agentType: LENSES[i].agentType })))

phase('Verify')
const verified = await parallel(allFindings.map((f) => () =>
  agent(
    `Adversarially verify this finding against ${scope}. Default to NOT real unless you can confirm the exact violation.\n` +
    `Location: ${f.file}:${f.line || '?'}\nRule: ${f.rule}\nClaim: ${f.summary}`,
    { label: `verify:${f.file}`, agentType: f.agentType, phase: 'Verify', schema: VERDICT_SCHEMA },
  ).then((verdict) => ({ ...f, verdict }))
))

// Rank by guardrail severity (money/trust/secrets first), then conventions.
const SEVERITY = ['G1', 'G2', 'G5', 'G8', 'G6', 'G3', 'G4', 'G7', 'G9', 'G10']
const rank = (f) => {
  const m = (f.rule || '').match(/G\d+/)
  const i = m ? SEVERITY.indexOf(m[0]) : -1
  return i === -1 ? 99 : i
}

const confirmed = verified
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.isReal && f.verdict.inScope)
  .sort((a, b) => rank(a) - rank(b))

return { scope, reviewed: allFindings.length, confirmed }
