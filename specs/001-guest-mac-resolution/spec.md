# Feature Specification: Guest MAC Resolution Behind the OLT Relay

**Feature Branch**: `fix/olt-relay-mac-resolution`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "GH #114. Guests behind the Huawei OLT get the OLT relay MAC
(`F4:B7:8D:A6:80:88`) as their device MAC in the app. Find the source with a temporary diagnostic
log and one phone test. Then fix that source and add a guard so the app never accepts a relay MAC
as a guest MAC."

## Background

- Guests sit behind a Huawei OLT that relays DHCP. The OLT relay MAC `F4:B7:8D:A6:80:88` is the
  source MAC on every relayed DHCP lease. The router ARP table also lists it for relayed guest IPs.
- The router translates guest traffic to the app server. The app sees every guest as one client IP
  (`10.210.0.1`). Router lookups for that IP find nothing.
- Test phone (Pixel 6a): real MAC `2E:47:8F:2D:35:8F`, IP `10.210.44.159`. The router hotspot host
  table has the real MAC. Its lease has circuit ID `OLT-9 xpon 0/1/0/4:16.3.70` (access point
  `OAP3000G-FC6G`).
- But the app logged the relay MAC (ends `80:88`) in 3 of 4 dashboard loads, and checkout used it,
  even after the phone's site data was cleared. One customer account has the relay MAC saved as
  its last known MAC.
- The source of the relay MAC is not known. Possible sources: the captive redirect `?mac=` value,
  the saved portal cookie, the device cookie, the account MAC, or the router IP-to-MAC lookup
  (hotspot host, then lease, then ARP). App logs mask both IP and MAC, so they cannot show it.
- Impact: guests behind the OLT can share one MAC in the app. Payment access point attribution
  falls back to the bridge (blocks GH #97). Login, time grants and the admin-device bypass use the
  same MAC resolution.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Name the source of the wrong MAC (Priority: P1)

An operator turns on a temporary diagnostic log, connects the test phone through the OLT, and
opens the dashboard and checkout. Each MAC resolution writes one log line. The line tells which
source gave the MAC. The operator reads the lines and names the source of the relay MAC.

**Why this priority**: The fix in Story 2 depends on the source. Without it, a fix is a guess.

**Independent Test**: Deploy the log to the staged VM, load the dashboard and checkout on the test
phone, and read the logs. The story is done when one source is named for the relay MAC.

**Acceptance Scenarios**:

1. **Given** the diagnostic log is on, **When** the app resolves a MAC for any request, **Then**
   it writes exactly one line with the source name, the masked MAC (last two octets) and the client
   IP. The full IP shows only on the staged VM, through a local uncommitted edit. The committed code
   masks it (FR-016a).
2. **Given** the MAC came from the router lookup, **When** the line is written, **Then** it names
   the router table that matched (hotspot host, lease, or ARP).
3. **Given** the test phone loads the dashboard and checkout through the OLT, **When** the
   operator reads the log lines, **Then** the source of every `80:88` result is named.

---

### User Story 2 - Never accept a relay MAC as a guest MAC (Priority: P2)

A guest behind the OLT connects, logs in, opens the dashboard and pays. The app uses the guest's
real device MAC, or no MAC. It never uses the relay MAC. Payments are attributed to the real
access point.

**Why this priority**: This is the real fix. It protects access binding, time grants, the admin
bypass and payment attribution. It needs Story 1's result to fix the source.

**Independent Test**: Unit tests feed a relay MAC to each source and show it is never returned and
never saved. A live phone test on the staged VM shows the real MAC on dashboard and checkout and
the correct access point on the payment record.

**Acceptance Scenarios**:

1. **Given** a source gives a MAC that is a relay MAC, **When** the app resolves the guest MAC,
   **Then** it treats that source as "no MAC" and tries the next normal fallback.
2. **Given** the router lookup matches a relay MAC in any table, **When** the lookup ends,
   **Then** it does not return the relay MAC.
3. **Given** a portal cookie, device cookie or account MAC already holds a relay MAC, **When**
   the app reads it, **Then** it ignores the value.
4. **Given** any resolution step, **When** the resolved MAC is a relay MAC, **Then** the app does
   not save it to a cookie or to the account.
5. **Given** an admin device sits behind the OLT, **When** the admin-device bypass checks its
   MAC, **Then** a relay MAC never matches and never grants the bypass.
6. **Given** the test phone pays through `OAP3000G-FC6G`, **When** checkout runs, **Then** the
   payment record has the phone's access point, not the bridge.
7. **Given** the source fix from Story 1's finding is in, **When** the test phone loads the
   dashboard and checkout, **Then** both show the real MAC (ends `35:8F`).

---

### Edge Cases

- No source gives a valid MAC after the relay MAC is rejected: the app behaves as it does today
  with no MAC (no device detected). It does not fall back to the relay MAC.
- The router is not reachable when the relay MAC list is built: the app must not crash. The router
  lookup works as today. MACs are checked against the last loaded relay set, or pass unchecked if none was loaded (FR-015).
- A relay MAC changes or a new relay is added: detection is automatic from current leases, so no
  config change is needed.
- Two guests behind the same relay: each must resolve to its own MAC or to no MAC. They must never
  share the relay MAC.
- A guest's real MAC arrives by `?mac=` and is not a relay MAC: it is still client-influenceable
  and stays a fallback, not a verified binding (no change from today).

## Requirements _(mandatory)_

### Functional Requirements

Story 1 (diagnostic, temporary):

- **FR-001**: Each MAC resolution MUST write one log line with the source name. Source names:
  `redirect`, `portal-cookie`, `device-cookie`, `account`, `last-session`, for the router
  lookup `hotspot-host`, `lease` or `arp`, `router-cache` when the 60 s IP cache answers, and
  `none` when no source matched (FR-004).
- **FR-002**: The log line MUST mask the MAC as today (only the last two octets visible).
- **FR-003**: The log line MUST show the full raw client IP on the staged VM. This is allowed only
  because the staged VM has no real users now. The full IP comes from a local uncommitted edit on
  the VM. The committed code masks it (FR-016a).
- **FR-004**: A resolution that finds no MAC MUST also write a line that says no source matched.
- **FR-005**: The operator MUST run one phone test through the OLT and record the named source in
  this feature's notes.

Story 2 (guard and fix):

- **FR-006**: A MAC MUST count as a relay MAC when it is the source MAC on any relayed DHCP lease.
  No config list.
- **FR-007**: The shared guard MUST live in the shared core code, so the customer app and the
  admin app (admin-device bypass included) both use it.
- **FR-008**: The router IP-to-MAC lookup MUST NOT return a relay MAC from any table (hotspot
  host, lease, ARP).
- **FR-009**: The customer app MUST reject a relay MAC from the redirect `?mac=` value, the portal
  cookie, the device cookie, the account MAC and the last-session MAC.
- **FR-010**: A rejected relay MAC MUST count as "no MAC". Resolution MUST go on to the next normal
  fallback (device cookie, account MAC, last-session MAC).
- **FR-011**: The app MUST NOT save a relay MAC to any cookie or to the account.
- **FR-012**: Saved relay MACs (cookies, the one account row) MUST be ignored when read. No manual
  database cleanup.
- **FR-013**: The admin-device bypass MUST NOT match a relay MAC.
- **FR-014**: The source named in Story 1 MUST be fixed so the guest's real MAC is found. The exact
  fix depends on Story 1's finding and is confirmed with the user after Story 1.
- **FR-015**: Fail open, keep the last relay set. If the relay MAC list cannot be read from the
  router, the app uses the last loaded set if it has one. Else MACs pass unchecked. The request
  never fails.
- **FR-016**: When Story 2 ships, the diagnostic log MUST be removed or MUST mask the IP again.
- **FR-016a**: The full-IP diagnostic log MUST NOT be merged to `staging` or deployed where real
  users connect. It lives only on the feature branch and the staged VM.
- **FR-016b**: When no valid guest MAC is found after a relay MAC is rejected, checkout MUST keep
  today's no-MAC attribution (bridge fallback). It MUST NOT attribute the payment by a relay MAC.
- **FR-016c**: Payment confirmation and credit rules MUST NOT change. Only the MAC used for access
  point attribution changes.
- **FR-017**: Each change to MAC resolution, binding, grants, the admin bypass or checkout
  attribution MUST have a failing test first, then the fix, then live evidence (high-risk path).

### Key Entities

- **Relay MAC**: A MAC that is the source MAC on a relayed DHCP lease. It belongs to network gear
  (the OLT), never to a guest.
- **Guest MAC**: The MAC of the guest's own device. Used for login binding, time grants, the
  admin-device bypass and payment access point attribution.
- **MAC source**: Where a MAC came from: redirect, portal cookie, device cookie, account,
  last session, or a router table (hotspot host, lease, ARP).
- **Payment checkout record**: Holds the access point circuit ID and access point name at payment
  time.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After one phone test, the logs name exactly one source (or a clear set of sources)
  for every relay-MAC result.
- **SC-002**: Unit tests show, for each of the 8 sources, that a relay MAC is never returned,
  never saved, and ignored when already saved. The 3 router tables (`hotspot-host`, `lease`, `arp`)
  are tested through `resolveDeviceMac`. 0 failures.
- **SC-003**: On the staged VM, the test phone through `OAP3000G-FC6G` gets its real MAC (ends
  `35:8F`) on 100% of dashboard and checkout loads in the live test (at least 4 loads each).
- **SC-004**: In the same test, checkout uses the device circuit ID path (`via: 'device-circuit-id'`)
  and the payment record has circuit ID `OLT-9 xpon 0/1/0/4:16.3.70` and access point name
  `OAP3000G-FC6G`. This also closes GH #97.
- **SC-005**: After Story 2 ships, no log line shows a full client IP.
- **SC-006**: All CI gates pass: check, prettier, eslint, unit tests, build, and admin e2e.

## Assumptions

- The staged VM has no real users now, so a full client IP in a temporary log is acceptable
  (user decision).
- Relayed leases are the ones the router marks with a relay. Their source MAC is the relay MAC.
- The router lease table can be read by the app, as the IP-to-MAC lookup already does.
- No relay MAC is ever a real guest device MAC.
- GH #97's checkout fix (PR #115, checkout uses `resolveMacForUser`) is merged or merged together
  with this work. SC-004 needs it.
- Only one account row holds a relay MAC today. It is left in place and ignored (FR-012).
- The `?mac=` value stays client-influenceable and a fallback MAC is not a verified binding. This
  feature does not change those rules.
- Out of scope: changing router config, the walled garden, or the OLT. Locator app.
