# Diffwise

Diffwise is an AI pull request reviewer: it reads a pull request's changes and reports bad coding practices and security vulnerabilities, using whichever language model the user chooses.

## Language

### Reviewing

**Repository**:
A GitHub repository, named by its owner and name (`owner/repo`), that holds Pull Requests. Diffwise can read only the Repositories its GitHub App is installed on.
_Avoid_: Repo (in prose), project

**Pull Request**:
A proposed set of code changes to a Repository. The thing Diffwise reviews.
_Avoid_: PR (in prose), merge request, changeset

**Review**:
One run of Diffwise over a Pull Request at a specific head commit, using a specific Model, producing a set of Findings. A Review is running until every changed file has its File Outcome and it has been saved, and complete from then on. Reviews are kept, so one Pull Request can have many: a complete Review outlives a restart of Diffwise, unless saving it failed.
_Avoid_: Analysis, scan, audit

**Outdated**:
A Review whose head commit is no longer the Pull Request's head commit, because new commits were pushed since it ran. Its Findings are not carried forward.
_Avoid_: Stale, expired

**File Outcome**:
What happened to one changed file within a Review: reviewed, skipped (excluded by the skip list or size limit, with a reason) or failed (the model could not produce a valid result). A Review with any skipped or failed files has incomplete coverage, and says so. While a Review runs, a file without its File Outcome yet is pending: queued (waiting its turn) or reviewing (with the Model now); it's settled once it has one.
_Avoid_: File status, file result

### Findings

**Finding**:
A single problem a Review reports in a Pull Request: either a Bad Practice or a Security Issue, anchored to a line range made up only of lines the Pull Request adds or modifies. Problems in unchanged code are out of scope.
_Avoid_: Issue (clashes with GitHub Issues), comment, warning

**Bad Practice**:
A Finding about code that works but that the model judges to be poor practice (readability, maintainability, correctness risk). There is no fixed ruleset; the model's judgement is the standard.
_Avoid_: Code smell, style issue

**Security Issue**:
A Finding about code that introduces or exposes a security vulnerability.
_Avoid_: Vulnerability (as the Finding's name), CVE

**Severity**:
How serious a Finding is: low, medium, high or critical.
_Avoid_: Priority, level

**Suggested Fix**:
Optional replacement code attached to a Finding, showing how to resolve it.
_Avoid_: Patch, autofix

**Security Reference**:
An optional CWE or OWASP identifier attached to a Security Issue, naming the class of weakness it belongs to.
_Avoid_: Tag, category

### Models

**Model Provider**:
A source of language models that runs Reviews: Ollama (local) or any OpenAI-compatible API.
_Avoid_: LLM, AI backend, engine

**Model**:
One specific language model offered by a Model Provider (e.g. `llama3.1:8b`, `gpt-4o`). Every Review records the Model that ran it.
_Avoid_: Provider (when the specific model is meant)

### Evaluation

**Eval Set**:
A fixed collection of fixture Pull Requests, each seeded with known Planted Problems, used to measure how well a Model reviews.
_Avoid_: Test suite, benchmark

**Planted Problem**:
A deliberate Bad Practice or Security Issue placed in an Eval Set fixture, which a good Review should report. A Planted Problem is caught if a Review reports a Finding of the same kind whose line range overlaps it, and missed otherwise.
_Avoid_: Seeded bug, known issue
