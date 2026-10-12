# Lessons

Format: date, feature, what happened, the rule to keep.

## 2026-10-12, 001-guest-mac-resolution (GH #114)

L1. What happened: the P2-5 check `grep -c '\[mac-diag\]'` returns 0 on a quiet log, even when the
log code is still there. Rule: a zero-count check counts only after real traffic since the restart.
Load the page first, then count.

L2. What happened: the first relay rule (`srcMac !== mac`) put the VM host NIC in the relay set. The
live lease print showed a lease with `src-mac-address` and no `agent-circuit-id`. Rule: key a relay
set on Option 82 presence, not only on `srcMac !== mac`. Check the rule against a live lease print
before the guard ships.

L3. What happened: the VM cannot reach GitHub, so `git pull` cannot work, and git without `sudo`
failed with `index.lock: Permission denied`. Rule: move code with
`git bundle` + `scp` + `sudo git fetch <bundle>` + `sudo git merge --ff-only FETCH_HEAD`. The repo
is owned by root.

L4. What happened: the stub controller returns no leases, so the relay guard did nothing in dev and
admin e2e. Rule: a guard that reads router data needs a unit test with a fake lease list and a live
test. Dev and e2e cannot cover it.
