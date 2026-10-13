---
name: ref:gotyme-walled-garden-recon-dns-classification
description: "Plan step 8 traceability note — GoTyme live DNS-cache capture (02-10-26) and per-host walled-garden verdicts"
date: 02-10-26
feature: none
---

# GoTyme DNS Classification — Plan Step 8 (SPEC AC1 + AC2)

**Plan:** `gotyme-walled-garden-recon_PLAN_22-09-26.md` (Section 2, steps 5-8)
**Capture date:** 2026-10-02 (supplied by the user/operator, live staging router)

## TL;DR

- **Add direct (`dst-host`):** `*.gotyme.com.ph` (evidence: `chapigw.gotyme.com.ph`, plain A records, no CNAME).
- **Add scheduler (`:resolve`):** `aws-gate.licelus.com` (CNAME to an AWS ELB → `dst-host` cannot match it).
- **Not added:** analytics / feature-flag / crash SDKs, and all unrelated noise.
- **The capture is partial.** Login failed (Code 3103000). The app never reached the pay/QRPH screen.
  More GoTyme hosts may show up after login works.

## How the capture was taken

1. Phone: Private DNS off; airplane-mode toggle (clears phone DNS cache); mobile data off.
2. Phone on the hotspot, NOT granted (still captive).
3. Router: `/ip dns cache flush`.
4. Opened GoTyme and tried to log in.

**Result:** login FAILED with an in-app drawer:
> "There's a technical issue. For security reasons, we need you to start over. (Code: 3103000)"

So the capture covers **app launch + login attempt only**. It does not cover the pay/QRPH flow,
because no GoTyme host was allowed at capture time.

## Raw evidence

Filtered:
```
/ip dns cache print where name~"gotyme"
 0   chapigw.gotyme.com.ph   A     13.35.130.4     36s
 1   chapigw.gotyme.com.ph   A     13.35.130.120   36s
 2   chapigw.gotyme.com.ph   A     13.35.130.25    36s
 3   chapigw.gotyme.com.ph   A     13.35.130.15    36s
```

Full (RouterOS truncates long names with "..."):
```
 0 S parafibr.hotspot        A     10.210.0.1
 1-28 duo.nl  A/AAAA/MX/NS/TXT (many records)
29   www.qq.com              CNAME www.qq.com.eo.dnse2.com
30   www.qq.com.eo.dnse2.com A     43.159.109.55
31   www.qq.com.eo.dnse2.com AAAA  240d:c010:119:2::108
32-37 dhitc.com A/NS/MX/TXT
38   www.taobao.com          CNAME www.taobao.com.danuoyi.tbcache.com
39-42 www.taobao.com.danuo... AAAA/A
43   alt2-mtalk.google.com   CNAME alt2.mobile-gtalk4.l.google.com
44   alt2.mobile-gtalk4.l... A     74.125.137.188
45   prod-gate-alb-206142... A     18.195.191.226
46   prod-gate-alb-206142... A     63.188.151.79
47   prod-gate-alb-206142... A     52.59.68.239
48   firebase-settings.cr... A     142.250.207.35
49   crashlyticsreports-p... A     142.250.199.78
50   clientstream.launchd... CNAME clientstream-ga.launchdarkly.com
51   clientstream-ga.laun... A     13.248.151.210
52   clientstream-ga.laun... A     76.223.31.44
53-56 chapigw.gotyme.com.ph A 13.35.130.4 / .120 / .25 / .15
57   www.jd.com              CNAME www.jd.com.gslb.qianxun.com
58   www.jd.com.gslb.qian... CNAME jd-abroad.cdn20.com
59   time.windows.com        CNAME twc.trafficmanager.net
60   twc.trafficmanager.net  A     20.189.79.72
61   log.tailscale.com       AAAA  2606:b740:1:20::102
62   log.tailscale.com       A     199.165.136.100
63   cdn-settings.segment... A     3.170.245.130
64-66 in.ap1.segmentapis.com A 52.77.70.4 / 54.179.207.226 / 13.229.167.176
67-70 sdk-01.moengage.com    A 13.35.130.94 / .128 / .4 / .82
71-74 rvxbq7.cdn-settings.... A 13.35.130.113 / .9 / .14 / .87
75   edge-mqtt.facebook.com  CNAME mqtt.c10r.facebook.com
76   mqtt.c10r.facebook.com  A     57.144.228.144
77   z-m-gateway.facebook... CNAME dgw-mini.c10r.facebook.com
78   chat-e2ee-mini-fallb... CNAME chat-e2ee-mini.fallback.c10r.facebook.com
79   chat-e2ee-mini.fallb... A     57.144.64.8
80-83 rvxbq7.inapps.appsfl... A 13.35.130.127 / .98 / .51 / .129
84-87 rvxbq7.launches.apps... A 13.33.151.67 / .33 / .89 / .90
88   edge-mqtt-fallback.f... CNAME mqtt.fallback.c10r.facebook.com
89   mqtt.fallback.c10r.f... A     57.144.64.144
90-91 jd-abroad.cdn20.com    A 153.43.255.19 / .17
92   www.sina.com.cn         CNAME spool.grid.sinaedge.com
93   spool.grid.sinaedge.com CNAME ww1.sinaimg.cn.w.alikunlun.com
94-103 ww1.sinaimg.cn.w.ali... AAAA/A
104  alt3-mtalk.google.com   CNAME alt3.mobile-gtalk.l.google.com
105  alt3.mobile-gtalk.l.... A     74.125.137.188
106  aws-gate.licelus.com    CNAME prod-gate-alb-2061421914.eu-central-1.elb.amazonaws.com
107-114 mobile.launchdarkly.com A (8 AWS IPs)
115-117 api.segment.io       A 52.13.54.113 / 54.214.144.241 / 52.32.165.214
```

## Classification rule used

From `docs/mikrotik/walled-garden.md` §"How to add a wallet/bank" step 4 and the GCash root cause:
the test is **whether the cache shows a CNAME** in front of the host. RouterOS v6 `dst-host`
matching works on the name the A records are cached under. It can not follow a CNAME chain.

- Host has A records directly under its own name → **add-direct** (`dst-host` in `PAYMENT_HOSTS`).
- Host is a CNAME to a cloud/CDN name → **add-scheduler** (`:resolve` scheduler, like `gcash-resolve`).

## Per-host verdicts

| Host (evidence rows) | DNS shape | GoTyme-related? | Needed for login? | Verdict |
|---|---|---|---|---|
| `chapigw.gotyme.com.ph` (53-56) | A ×4 → 13.35.130.x (AWS CloudFront range), **no CNAME** | Yes — GoTyme's own domain; likely the app API gateway | Yes | **add-direct** as `*.gotyme.com.ph` (see below) |
| `aws-gate.licelus.com` (106) → `prod-gate-alb-2061421914.eu-central-1.elb.amazonaws.com` (45-47) | **CNAME** → AWS ELB, A ×3 (18.195.191.226, 63.188.151.79, 52.59.68.239) | Yes (strong inference) — Licel is a mobile app-protection / attestation vendor. No other app in this capture plausibly uses it | Yes (strong inference) — error "For security reasons, we need you to start over" fits an attestation check failing because this host is blocked | **add-scheduler** (`gotyme-resolve`, resolves `aws-gate.licelus.com`) |
| `rvxbq7.cdn-settings.…`, `rvxbq7.inapps.appsfl…`, `rvxbq7.launches.apps…` (71-74, 80-87) | A, CloudFront | Probably — `rvxbq7` looks like GoTyme's AppsFlyer app ID | No — AppsFlyer is install/marketing attribution; SDK failures are silent | **not-needed** |
| `cdn-settings.segment…`, `in.ap1.segmentapis.com`, `api.segment.io` (63-66, 115-117) | A | Probably (analytics SDK) | No — analytics; events queue offline | **not-needed** |
| `sdk-01.moengage.com` (67-70) | A | Probably (engagement/push SDK) | No | **not-needed** |
| `mobile.launchdarkly.com`, `clientstream.launchdarkly.com` (50-52, 107-114) | A / CNAME | Probably (feature flags) | Borderline — see note | **not-needed (round 1)** |
| `firebase-settings.crashlytics.com` (48) | A, Google | Probably (crash reporting) | No | **not-needed** |
| `crashlyticsreports-pa.googleapis.com` (49) | A, Google | Probably | No | **already covered** by existing `*.googleapis.com` — no change |
| `duo.nl`, `dhitc.com`, `www.qq.com`, `www.taobao.com`, `www.jd.com`, `www.sina.com.cn` (+ their CDN chains) | mixed | No — looks like outside open-resolver probing | — | **noise** |
| `edge-mqtt.facebook.com`, `z-m-gateway.facebook…`, `chat-e2ee-mini-fallb…`, `edge-mqtt-fallback.f…` | CNAME | No — Facebook/Messenger push on the phone | — | **noise** |
| `alt2-mtalk.google.com`, `alt3-mtalk.google.com` | CNAME | No — Android push (FCM) | — | **noise** |
| `time.windows.com`, `log.tailscale.com` | — | No — other devices | — | **noise** |
| `parafibr.hotspot` (0, static) | — | No — the hotspot's own DNS name | — | **noise** |

## Decisions and reasoning

### 1. `*.gotyme.com.ph` (wildcard), not the exact `chapigw.gotyme.com.ph`, and no bare parent

- The capture is known to be partial: login failed before any post-login screen. GoTyme will almost
  certainly call more `*.gotyme.com.ph` hosts after login and on the pay/QRPH flow. An exact host
  would force a new recon round for each one.
- `gotyme.com.ph` is GoTyme's own domain. It is NOT a shared CDN, Google, or Cloudflare domain, and
  none of the `PROBE_DENIES` hosts are under it. So the wildcard does not break hard rule 2 (no broad
  CDN allows) and can not re-open the captive-probe flap.
- It matches the root already listed for GoTyme in the doc's candidate table.
- **No bare `gotyme.com.ph`:** the bare parent was not seen in the capture. Hard rule 1 says add both
  only when both are needed. If a later capture shows the bare host, add it then.
- Trade-off against SPEC "add only what's necessary": the wildcard opens slightly more than the one
  observed host, but only inside GoTyme's own domain. If the retest fails for good, the KNOWN-DEAD
  path removes it in full.

### 2. `aws-gate.licelus.com` via a `:resolve` scheduler (not `dst-host`)

- It CNAMEs to `prod-gate-alb-2061421914.eu-central-1.elb.amazonaws.com`. A `dst-host` rule for
  `aws-gate.licelus.com` would show 0 hits, the same failure as GCash.
- Rejected: `*.elb.amazonaws.com` / `*.amazonaws.com` (broad cloud wildcard, hard rule 2).
- Rejected: a `dst-host` for the ELB name itself. That name is AWS-generated and internal to Licel;
  it can change without notice if the load balancer is rebuilt. The plan prescribes the scheduler.
- The scheduler resolves the specific host `aws-gate.licelus.com` every 5 min and upserts one
  `walled-garden ip` row (`comment="gotyme-auto"`), a 1:1 copy of `gcash-resolve`.
- **Known risk (flag for the retest):** the ELB returns **3** A records, and RouterOS `:resolve`
  returns only **one**. The scheduler opens one IP at a time. If the phone connects to one of the
  other two IPs, that connection is still blocked. GCash has the same single-IP shape and works live,
  but Akamai and an AWS ELB may behave differently. If the retest still shows Code 3103000, this is
  the first thing to check (router: `/ip hotspot walled-garden ip print where comment="gotyme-auto"`
  and compare with `/ip dns cache print where name~"prod-gate"`).

### 3. Analytics / feature-flag SDKs not added

- AppsFlyer, Segment, MoEngage, Crashlytics: these SDKs queue or drop data when offline. They do not
  block login. Opening them gives a free pre-auth path to tracking services for no gain.
- LaunchDarkly (feature flags) is the one borderline case. Its mobile SDK falls back to cached or
  default flag values when it can not connect, so it should not block login. If the retest gets past
  login but an app feature (for example QRPH pay) is hidden or disabled, LaunchDarkly is the next
  candidate to add (`mobile.launchdarkly.com` + `clientstream.launchdarkly.com`; the second one is a
  CNAME, so it would need a scheduler too).

## Next capture needed

After the push and retest: if login now works, drive the app to the pay/QRPH confirm screen and take
a second `/ip dns cache print`. New `*.gotyme.com.ph` hosts are already covered. Any new non-GoTyme
host (bank, QRPH switch, attestation) needs its own classification here.
