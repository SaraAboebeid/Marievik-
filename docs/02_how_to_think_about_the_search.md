# How to think about the parametric search

Written for you, to reread and to argue with. It is the conceptual spine of
the project; the code in `explore/` is one implementation of it.

---

## 1. The question you asked, and the question to ask instead

> "An algorithm that takes a space plan and tests out all the options."

Taken literally this is impossible, and it is worth knowing exactly why before
deciding what to do instead. Twenty furniture items, each with roughly a
thousand valid positions and four rotations, is 4000²⁰ arrangements — more than
the number of atoms in the observable universe, by a wide margin. Adding a
faster computer does not help. Adding every computer does not help.

**The useful question is not "what are all the options" but "what are the
options worth looking at".** Those are different sets, and the second one is
small — usually a few dozen. Everything below is about getting from the first
to the second honestly, rather than by quietly throwing away possibilities you
never examined.

---

## 2. Decomposition: the idea that does the most work

A design is not one giant choice. It is a stack of choices, and choices at one
level are largely independent *given* the level above. That means you can solve
them one level at a time.

| Level | What varies | Roughly how many | Who decides |
|---|---|---|---|
| **0 · Shell** | nothing — structure, façade, core, drainage stacks | 1 | the existing building |
| **1 · Zoning** | which use goes in which part of the plan | 10²–10³ | you, or a solver |
| **2 · Partitions** | where walls run, given the zoning | 10¹–10² | you, or a solver |
| **3 · Furnishing** | where things go *within each room* | 10³ per room | a packing solver |
| **4 · Specification** | which wall type, floor, component | 10³ | a catalogue search |

The arithmetic that matters: **searched together these multiply; searched in
levels they add.** 10³ × 10² × 10³ × 10³ is 10¹¹ and hopeless. 10³ + 10² + 10³ +
10³ is about 2,100 and takes seconds.

This is legitimate rather than a cheat, as long as you are honest that it is a
*greedy* decomposition: you may miss a brilliant option that requires a bad
zoning rescued by an unusual furnishing. In practice those are rare, and the
cost of missing them is small compared with never running the search at all.
Say so in the method section and nobody will object.

**Level 3 has a second, bigger saving.** Furnishing is *separable per room*:
arranging the bedroom does not affect arranging the kitchen. So you solve five
small problems instead of one large one, and 10¹⁵ becomes 5 × 10³.

---

## 3. Independence across objectives

This one surprised me when the numbers came back, and it is worth internalising.

- **Furnishing geometry** drives the social metrics (reach, turning, clearance).
  It barely touches cost.
- **Component specification** drives cost and carbon. It does not move a single
  line on the drawing.

They are nearly independent. So N furnishings × M specifications costs
**N + M** expensive evaluations, not N × M. In the current search that is
18 geometry runs instead of 72 — and geometry is the slow part.

The general lesson: **look for the axes of your problem that do not interact,
and never pay for their cross product.**

---

## 4. Constraints before objectives

The instinct is to generate options and score them. Resist it. Scoring is
expensive; feasibility is nearly free.

- **Hard constraints** — can you reach every room, does each habitable room
  have a window, does the bed fit with its clearance, is the wet room near a
  stack. These either hold or they do not, and they are cheap to test.
- **Objectives** — cost, carbon, experience. Continuous, expensive, and only
  meaningful for options that pass the constraints.

Filter first. In our run, roughly a third of generated options fail a hard
constraint, and never cost anything to evaluate.

The research framing for this is **constraint satisfaction**: you are pruning
a search tree, not sorting a list. It is also the honest way to handle
regulation. A plan that fails BBR is not "a low-scoring option", it is **not an
option**, and a model that lets a good carbon number outvote an accessibility
failure is producing exactly the kind of result this project exists to argue
against.

---

## 5. There is no best. There is a front.

With one objective you get a winner. With three you get a **Pareto front**: the
set of options that nothing beats on cost, carbon *and* experience
simultaneously.

Everything not on the front is *dominated* — some other option is at least as
good on all three and better on one. Those can be discarded without an
argument, and that is the point: the front is not a shortlist you defend, it is
what remains after the indefensible options remove themselves.

From our current run of 28 feasible options, the front is **two**:

| Option | LCC | Carbon | Experience |
|---|---|---|---|
| Open studio, stud partitions | 556,578 SEK | 12,129 kg | 88 |
| Divided studio, stud partitions | 609,293 SEK | 13,100 kg | 98 |

That is the whole conversation, stated precisely: **+9% life-cycle cost and +8%
carbon buys +10 points of experience**, almost all of it acoustic privacy —
having a bedroom rather than a bed in the living room. Whether that trade is
worth making is a client's decision, not a model's. Your job is to put the
exchange rate on the table.

Note what is *absent*: no demountable option reaches the front. With a single
use over fifty years there is nothing for demountability to pay back against.
Which brings us to the part that is actually yours.

---

## 6. The dimension that makes this project yours

Everything above is generic generative design. Your project is not about one
layout; it is about a building that changes use.

So the object being searched is not a plan. It is:

> **a shell investment, plus a fit-out per use, over a sequence of uses**

and the objective includes the **transformation** between consecutive fit-outs.
Written out:

```
total = shell_investment
      + fitout(use₁)
      + Σ transform(fitout(useᵢ) → fitout(useᵢ₊₁))
      + Σ operational(useᵢ, duration)
```

This is why the engine already keeps a reuse stock that persists across a
timeline, and why `adaptability_index` is measured per change of use rather
than per project.

It also changes what "optimal" means. A fit-out that is optimal for use₁ alone
is usually *not* optimal in sequence, because it makes use₂ expensive to reach.
That is a real and publishable finding, and it is invisible to any single-use
optimisation — which is to say, invisible to nearly every tool in the field.

Formally this is a **sequential decision problem**, and the thing that makes it
tractable is that the sequence is short (3–5 changes in 50 years). You can
enumerate use sequences directly, and for each one run the per-use search above.
No reinforcement learning, no dynamic programming, nothing exotic — just a loop
over a small set, which is worth knowing before anyone suggests otherwise.

---

## 7. What the code does today, and where it stops

`explore/search.py` implements levels 2–4 for a single apartment:

- partition schemes come from the configurations you define (level 2)
- furnishings are generated per scheme, **constrained to the room each item
  started in** (level 3)
- specifications sweep the partition catalogue (level 4)
- infeasible options are dropped before evaluation
- what comes back is every option plus the Pareto front

**Honest limits, in the order they matter:**

1. **Level 1 is not searched.** Zoning comes from the schemes you hand it.
   The bay allocator in `engine/layout.py` already does this at building
   scale and is not yet wired to the apartment model.
2. **Furnishing variants are shallow.** Shuffling placement order and anchor
   gives a handful of genuinely distinct packings, then converges. Real
   diversity needs simulated annealing per room, which the bay allocator
   already demonstrates.
3. **No sequence search yet.** Section 6 is designed for and not built. This
   is the highest-value gap.
4. **Placement is greedy.** Items are placed one at a time, best-first. It
   will miss arrangements that need two items to move together.
5. **All cost and carbon data are placeholders.** The *structure* of the
   result is trustworthy; the magnitudes are not, and the direction of a
   comparison is what you should quote until EPDs replace them.

---

## 8. The order I would build it in

1. **Sequence search** (§6). Highest value, and nothing else in the field
   does it. You already have the transformation ledger — it needs wiring to
   the option search.
2. **Per-room annealing** for real furnishing diversity, reusing the
   annealer in `engine/layout.py`.
3. **Level 1 zoning search** at apartment scale, so the model can propose
   where the bedroom goes rather than being told.
4. **Weighted scalarisation as a reporting layer, not a search layer** — let
   a client slide "how much do I care about carbon" and watch the chosen
   point move along the front. Keep the front as the real output; the slider
   is for the conversation.
5. **Real data.** At some point the placeholders become the limiting factor
   on what you can claim, and no amount of algorithm fixes that.

---

## 9. Vocabulary, so you can read the literature

You will meet these terms and they are worth having:

- **Design space / search space** — the set of all configurations.
- **Objective function** — what you are minimising. You have three.
- **Constraint satisfaction** — pruning by feasibility rather than scoring.
- **Pareto front / non-dominated set** — §5. Also *Pareto-optimal*.
- **Dominated** — beaten on every objective at once, therefore discardable.
- **Combinatorial explosion** — §1, why you decompose.
- **Greedy algorithm** — takes the locally best choice at each step. Fast,
  not guaranteed optimal. Our placement is greedy.
- **Simulated annealing** — accepts worse solutions early, less often over
  time, to escape local optima. Used in `engine/layout.py`.
- **Local optimum** — better than everything nearby, worse than something far
  away. The thing annealing exists to escape.
- **NP-hard** — no known algorithm finds the exact optimum quickly as the
  problem grows. Packing is NP-hard. This is a reason to use heuristics
  and say so, not a reason to give up.
- **Heuristic** — a rule that usually works and carries no guarantee. Most of
  this project is heuristics, declared as such.
- **Scalarisation** — collapsing several objectives into one with weights.
  Convenient, and it hides the trade-off, which is why the front comes first.

When you write the method section, the sentence that will do the most work is:
*"The search is decomposed into conditionally independent levels; within each
level the solver is greedy/annealed and therefore heuristic; results are
reported as a Pareto front rather than a single optimum."* That is accurate,
it concedes exactly what should be conceded, and it is defensible.
