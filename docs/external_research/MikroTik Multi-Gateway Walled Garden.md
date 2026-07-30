# **Architecting Resilient Captive Portal Checkout Flows for E-Wallets and 3D Secure Card Payments**

## **Executive Summary**

The deployment of a comprehensive e-wallet and credit card checkout flow—incorporating payment gateways such as Maya, GCash, QRPh, Google Pay, and major international card networks—within a strictly controlled captive portal environment presents a profound network engineering challenge. The core architectural conflict arises between the restrictive, perimeter-based nature of a captive portal's Walled Garden and the distributed, highly dynamic, and heavily encrypted nature of modern web infrastructure and payment processing systems.  
When a guest device connects to a MikroTik RouterOS hotspot but remains unauthenticated, its traffic is intercepted and redirected by the router's hs-unauth firewall and NAT chains. Access to external payment gateways relies entirely on Walled Garden rules granting targeted exceptions. Historically, hostname-based Walled Garden rules utilizing the dst-host parameter functioned adequately. However, this mechanism comprehensively fails against modern payment flows due to three intersecting technological shifts. First, payment gateways rely on global Content Delivery Networks (CDNs) that utilize short Time-To-Live (TTL) rotating IP addresses for load balancing. Second, the widespread implementation of EMV 3D Secure (3DS) authentication redirects users to highly unpredictable banking Access Control Server (ACS) domains. Third, the ubiquitous adoption of encrypted DNS protocols, specifically DNS-over-TLS (DoT) and DNS-over-HTTPS (DoH), alongside Encrypted Client Hello (ECH) in TLS 1.3, fundamentally blinds the router to the client's destination intent.  
This report exhaustively evaluates two distinct approaches to resolving this systemic failure: static IP-based and Autonomous System Number (ASN) whitelisting, and forced DNS interception coupled with dynamic firewall address list matching. The analysis indicates that while static IP whitelisting is viable for predictable backend API endpoints, it introduces severe security vulnerabilities when applied to CDNs. Conversely, forcing DNS interception provides a robust mechanism for predictable E-Wallet domains by utilizing RouterOS v7's advanced DNS address-list features. However, both options critically fail when accommodating credit and debit card checkouts due to the inherent unpredictability of 3D Secure ACS domains.  
Consequently, this report recommends a hybrid architectural approach. By leveraging a baseline forced-DNS configuration to resolve stable gateway assets, combined with an API-triggered "Temporary Trial Bypass" state initiated specifically during the checkout phase, hotspot operators can ensure seamless, high-conversion payment processing without compromising the security or billing integrity of the captive portal network.

## **1\. The Mechanics of Interception and the HTTPS/CDN Crisis**

To engineer a durable and scalable solution, it is first necessary to deconstruct the internal packet flow mechanisms by which a MikroTik Hotspot intercepts traffic, and critically evaluate why modern payment gateways inherently conflict with these legacy interception mechanisms.

### **1.1 The Legacy MikroTik Walled Garden Architecture**

The MikroTik RouterOS Walled Garden operates interception at two distinct layers of the OSI model: Layer 7 (Application) for unencrypted HTTP, and Layer 3/4 (Network/Transport) for everything else, including HTTPS.  
When a client attempts an unencrypted HTTP connection to any external site, the router intercepts the traffic on TCP port 80 and transparently redirects it to an internal web proxy1. This proxy reads the HTTP Host header in plain text and evaluates it sequentially against the /ip hotspot walled-garden dst-host rules2. If a match occurs, the proxy fetches the requested resource and serves it to the client, effectively bypassing the authentication requirement.  
However, payment gateways strictly mandate HTTPS on TCP port 443\. The transparent proxy cannot decrypt this traffic to read the HTTP Host header without triggering fatal certificate validation errors on the client device. To handle HTTPS Walled Garden entries, RouterOS employs a passive DNS-snooping mechanism. When a client performs a standard unencrypted DNS query on UDP port 53 for a domain such as payments.gcash.com, the router's DNS cache observes the resolution. The router then cross-references the requested domain against the dst-host Walled Garden rules2. If a match is found, RouterOS dynamically generates a temporary, IP-based allow rule in the /ip hotspot walled-garden ip table and inserts a corresponding bypass rule in the hs-unauth NAT chain. This allows the subsequent encrypted HTTPS traffic to pass directly to that specific resolved IP address2.

### **1.2 The Breakdown of Dynamic DNS Snooping**

This passive DNS-snooping mechanism is highly fragile in modern network environments and is the direct cause of the ERR\_CONNECTION\_CLOSED errors experienced during checkout flows. The failure stems from several overlapping factors inherent to modern web architecture.  
The first major factor is CDN load balancing and abbreviated DNS Time-To-Live (TTL) values. Payment processors like GCash, Maya, and Stripe do not host their frontend checkout assets on single, static servers. Instead, they rely on massive Anycast Content Delivery Networks such as Akamai, Cloudflare, Fastly, and Amazon Web Services (AWS)4. These CDNs use dynamic DNS responses for global load balancing, returning different IP addresses based on the client's geographic proximity, current server load, and network congestion. To facilitate this rapid shifting of traffic, CDNs configure their DNS records with extremely low TTL values, frequently less than 60 seconds, and sometimes as low as 15 seconds3. The MikroTik router's dynamically generated Walled Garden IP rule relies on this DNS cache. Once the cache TTL expires, the router purges the dynamic Walled Garden rule. If a guest takes longer than this brief TTL window to input their payment details or navigate a multi-page checkout flow, the authorization rule vanishes. Subsequent asynchronous API calls from the browser to the payment gateway are intercepted and dropped by the captive portal, resulting in immediate transaction failure3.  
The second, and perhaps most disruptive factor, is the deployment of Encrypted DNS protocols. Modern mobile operating systems and web browsers increasingly circumvent the local network's provided DNS servers entirely to protect user privacy. Android 9 and subsequent versions introduced a feature termed "Private DNS," which defaults to utilizing DNS-over-TLS (DoT) on TCP port 853 in an opportunistic mode7. Similarly, modern browsers such as Google Chrome, Mozilla Firefox, and Apple Safari actively attempt to upgrade DNS queries to DNS-over-HTTPS (DoH) utilizing standard TCP port 4438. When a guest device utilizes DoT or DoH to resolve a domain like payments.gcash.com, the query is sent directly to an external, public resolver—such as Cloudflare's 1.1.1.1 or Google's 8.8.8.8—via a cryptographically secured tunnel. The MikroTik router is entirely bypassed. It never observes the DNS query, the domain is never evaluated against the Walled Garden rules, and the vital dynamic IP bypass is never instantiated. When the client subsequently attempts to open a TCP connection to the resolved IP, the router blocks it because it has no context linking that IP to an allowed hostname.  
The third factor involves the encryption of the Server Name Indication (SNI) extension. Historically, firewalls could perform deep packet inspection (DPI) on the initial, unencrypted ClientHello packet of a TLS handshake to read the SNI field, thereby identifying the destination hostname without needing to decrypt the payload. However, the rollout of TLS 1.3 and the Encrypted Client Hello (ECH) extension encrypts this metadata, closing this loophole9. The router is left entirely blind to the destination hostname, observing only an opaque stream of encrypted data flowing to a generic CDN IP address. Consequently, Layer 7 firewall rules and TLS-host matchers in RouterOS are rendered ineffective against modern, secure payment gateways.

### **1.3 The 3D Secure (3DS) Dilemma**

While CDNs and encrypted DNS complicate the routing of known gateway domains, the integration of credit and debit cards (Visa, Mastercard, JCB, American Express) introduces an insurmountable obstacle for static Walled Gardens: the EMV 3D Secure protocol.  
Under the modern 3DS 2.0 framework, the transaction flow requires direct, real-time authentication from the financial institution that issued the user's card. When a user inputs their card details into the Maya or Google Pay interface, the merchant gateway communicates with a Directory Server (DS) operated by the card network. The DS then routes the authentication request to the specific issuing bank's Access Control Server (ACS)10.  
Crucially, to verify the user's identity, the user's browser is forcibly redirected away from the payment gateway to the issuing bank's specific ACS domain to complete an authentication challenge—typically entering a One-Time Password (OTP) sent via SMS, or confirming a push notification in their mobile banking application10. There are tens of thousands of card-issuing banks globally, and each dictates its own unique ACS infrastructure. A bank's ACS portal may be hosted on their own infrastructure, or more commonly, outsourced to highly specialized third-party security vendors such as Arcot, CardinalCommerce, or SIA11.  
It is structurally and mathematically impossible to predict which specific ACS domain a guest's browser will be redirected to during a checkout flow14. A guest using a local Philippine bank card might be directed to a local domain, while a tourist using an international card could be directed to servers in Europe or North America. Therefore, a static Walled Garden allow-list, regardless of whether it uses hostnames or IP addresses, cannot reliably support global credit card payments because the required destination domains are unknown until the exact moment the card number is processed14.

## **2\. Evaluation of Option 1: IP and ASN-Based Walled Garden Allows**

Option 1 proposes bypassing the inherently flawed hostname-based matching entirely by directly whitelisting the published IP ranges, Classless Inter-Domain Routing (CIDR) blocks, or Autonomous System Numbers (ASNs) associated with the required payment gateways. This is achieved using the /ip hotspot walled-garden ip add dst-address=... command16. This approach assumes that payment networks operate on stable, published IP infrastructure that can be statically routed.

### **2.1 Stability and Predictability of Payment Gateway IP Infrastructure**

Extensive research into the infrastructure of Maya, GCash, Google Pay, and the associated card networks reveals varying degrees of IP stability, which fundamentally dictates the viability of Option 1\.  
**Maya (PayMaya) Infrastructure:** Maya publishes specific IP addresses for its Production API and Webhook environments, which provides a degree of predictability. The primary production API URL (pg.maya.ph) resolves to a stable pool of inbound IP addresses, specifically 18.140.194.9, 54.179.96.150, 46.137.225.171, 13.251.180.11, 52.74.222.228, and 52.76.49.4517. For backend server-to-server communication, such as receiving Webhook notifications, Maya utilizes 18.138.50.235 and 3.1.207.20017. Whitelisting these specific API endpoints is highly feasible. However, the critical failure point for captive portals is the client-facing frontend. The returned web URLs intended for the client browser, such as the actual checkout page hosted at payments.maya.ph, do not use static IPs. They utilize highly dynamic IP addresses governed by AWS CloudFront and Application Load Balancers17. Therefore, whitelisting the API IPs does not solve the browser redirection issue.  
**GCash and Alipay (Ant Group) Infrastructure:** The GCash checkout flow embedded within the Maya gateway utilizes the Alipay cashier infrastructure. When a user selects GCash, the browser loads assets from a constellation of domains including \*.alipay.com, \*.alipayobjects.com, \*.alicdn.com, and \*.antgroup.com18. These domains are heavily distributed across Alibaba Cloud infrastructure (AS45102, AS37963) and supplemented by global CDN partners such as Akamai. The specific IP addresses associated with these domains rotate constantly and are highly geographically dependent. A DNS resolution for alicdn.com in Northern Mindanao will yield a completely different set of IP addresses than a resolution in Manila, and these IPs will change frequently based on edge node health and traffic routing algorithms. Attempting to track and statically whitelist these rotating IPs is an exercise in futility.  
**Google Pay Infrastructure:** Google Pay relies on standard Google infrastructure, heavily utilizing pay.google.com, gstatic.com, and googleapis.com for interface rendering, cryptographic asset fetching, and API submission5. Google operates one of the largest and most complex Anycast networks globally (AS15169). The IP addresses backing these domains are deliberately abstracted and rotate constantly based on Google's internal traffic engineering19. There is no official, static CIDR block dedicated exclusively to Google Pay frontend assets.  
**Card Networks and Global Gateways:** To illustrate the absurdity of maintaining CIDR blocks for modern payment gateways, one only needs to examine the published IP requirements for a major global processor like Stripe, which is architecturally similar to how Maya processes card assets. Stripe officially publishes over 80 discrete /32 IP addresses across multiple AWS regions that their APIs may resolve to, and explicitly states that their frontend assets hosted on \*.stripecdn.com and js.stripe.com use unpredictable, dynamic CDN IPs5. Maintaining this list manually in a MikroTik router is operationally unsustainable and highly prone to breakage when the gateway inevitably provisions new infrastructure.

### **2.2 The Security Tradeoffs of ASN/CIDR Whitelisting**

Faced with the impossibility of tracking individual rotating IP addresses, a network engineer might attempt to whitelist the overarching Autonomous System Numbers (ASNs) or massive CIDR blocks that belong to the CDNs hosting these payment assets. For example, to reliably ensure Google Pay assets load, an operator would need to whitelist Google's entire AS15169. To ensure Maya's CloudFront assets and Alipay's Akamai assets load, one would need to whitelist large portions of Amazon Web Services (AWS) and the Akamai edge network4.  
Allowing whole ASN or expansive CIDR ranges on a captive portal represents a catastrophic security tradeoff that defeats the fundamental purpose of the hotspot billing system. If a captive portal allows unfettered, unauthenticated access to AWS, Google Cloud, or Cloudflare IP ranges, malicious users can effortlessly bypass the hotspot entirely. A sophisticated user can deploy a personal VPN server, an HTTP proxy, or a simple SSH tunnel hosted on a cheap AWS EC2 instance or a Cloudflare Worker. Because the destination IP of their private tunnel belongs to a whitelisted ASN required for the payment gateway, the MikroTik router will allow the traffic to pass. This effectively provides the user with free, unlimited, and encrypted internet access, completely bypassing the captive portal's enforcement mechanisms.

### **2.3 Verdict on Option 1**

Option 1 is entirely unsuitable as a durable solution for captive portal checkouts. While static IP whitelisting is appropriate for secure, backend server-to-server Webhook delivery, it completely fails to accommodate modern, client-side browser checkouts. These checkouts dynamically pull HTML, JavaScript, and CSS assets from sprawling, decentralized CDNs3. Whitelisting the rapidly rotating IP addresses of these CDNs is computationally tedious and prone to constant failure. Furthermore, attempting to solve the rotation issue by broadly whitelisting the overarching ASNs critically compromises the security premise of the captive portal. Most importantly, Option 1 entirely fails to address the unpredictable domains required by 3D Secure card processing, rendering it incapable of supporting a comprehensive payment offering.

## **3\. Evaluation of Option 2: Forced DNS and Dynamic Address List Matching**

Option 2 attempts to restore the functionality of hostname-based matching by altering the fundamental flow of network traffic. Rather than relying on passive snooping, this approach forces all unauthenticated guest DNS traffic through the router's internal DNS resolver. By centralizing DNS resolution, the router can definitively observe all queries, correctly match them against wildcard rules, and dynamically populate the allowed IP lists2.

### **3.1 Forcing Captive Clients to Use Router DNS and Defeating Encrypted Protocols**

The prerequisite for Option 2 is ensuring that the MikroTik router has absolute visibility into client DNS queries. To prevent clients from bypassing the Walled Garden via manually hardcoded DNS servers (such as Google's 8.8.8.8 or Cloudflare's 1.1.1.1), the router must intercept and forcefully redirect standard DNS traffic. This is executed using Destination NAT (dstnat) rules in the RouterOS firewall. Any UDP or TCP traffic destined for port 53 originating from the hotspot interface is transparently redirected to the router's local DNS service.  
However, capturing standard port 53 traffic is insufficient in the era of encrypted DNS. To combat DNS-over-TLS (DoT), the router must aggressively block TCP port 8537. Android's Private DNS operates in an "opportunistic" mode. When the device connects to the network, it attempts to reach a DoT server on port 853\. If the connection is explicitly dropped or rejected by the network firewall, the Android operating system assumes DoT is unsupported on the current network and silently falls back to standard, unencrypted DNS on port 53, which the router can then successfully intercept7.  
Defeating DNS-over-HTTPS (DoH) is significantly more complex. Unlike DoT, DoH operates over standard HTTPS on TCP port 443, making it indistinguishable from regular web traffic8. Because port 443 is absolutely required for the checkout process to function, it cannot be blanket-blocked. If a user's browser is strictly configured to use a DoH provider, the encrypted DNS query will bypass the router's DNS interception, preventing the target IP from being analyzed and added to the Walled Garden25. To mitigate this, network operators must proactively maintain a firewall address list of known public DoH provider IP addresses and block outbound access to them. By blocking access to the DoH resolvers, the browser is forced to fall back to the system's unencrypted DNS configuration24.

### **3.2 Advanced DNS Matching and Dynamic Address Lists in RouterOS v7**

Even when DNS traffic is successfully forced through the router, the legacy /ip hotspot walled-garden feature suffers from the timing issues related to low DNS TTLs previously discussed. To remedy this structural flaw, MikroTik introduced advanced DNS management and address list integration features in RouterOS v78.  
In RouterOS v7, the /ip dns static configuration menu was expanded to include the match-subdomain=yes parameter and the address-list parameter8. This allows the router to actively monitor all DNS queries passing through its internal resolver. When a query matches a predefined static domain (or any of its subdomains), the router resolves the query and immediately injects the resulting IP address directly into a specified Firewall Address List8.  
Crucially, this mechanism bypasses the fragile Hotspot Walled Garden completely. Instead, the operator populates a Firewall Address List (e.g., Payment\_Gateways) and creates a raw firewall rule to permit traffic destined for this list to bypass the hs-unauth chain. To ensure stability against low-TTL CDNs, operators utilize the type=FWD parameter in the DNS static entry. This instructs the router to forward the DNS query to a reliable upstream resolver, but crucially, to intercept the response, parse the dynamic CDN IP addresses (including following CNAME chains, a feature improved in RouterOS 7.7), and add them to the firewall list30. The duration the IP remains in the address list is tied to the TTL of the DNS response, but RouterOS allows this to be artificially extended using the global address-list-extra-time setting, providing a buffer that guarantees the IP remains authorized throughout the duration of the user's checkout process, regardless of the CDN's actual TTL28.

### **3.3 The Inherent Failure Modes of Option 2**

While forcing DNS and utilizing RouterOS v7 Address Lists significantly improves stability for predictable, known domains, Option 2 is not invulnerable and possesses critical blind spots:

> 1. **The DoH Evasion Problem:** Maintaining a comprehensive blocklist of all global DoH providers is a Sisyphean task. New DoH resolvers are deployed continuously. If a client utilizes an obscure or custom DoH endpoint that is not present in the router's blocklist, the client's DNS queries will remain encrypted. Consequently, the router will fail to populate the dynamic address list, and the checkout will fail.  
> 2. **The 3D Secure (3DS) Blindspot:** Option 2 elegantly solves the CDN routing issue for known, predictable domains such as \*.maya.ph, \*.gcash.com, and \*.alipay.com. However, it remains entirely ineffective for 3D Secure credit card processing. Because the specific bank ACS domain is completely unknown prior to the transaction initiation, it cannot be predefined in the /ip dns static rules14. When the user is redirected to their bank to authenticate the transaction, the DNS query will resolve, but because the domain was not pre-programmed into the router, the resulting IP will not be added to the Walled Garden. The connection to the bank will be dropped, resulting in a failed payment14.

### **3.4 Verdict on Option 2**

Option 2 is vastly superior to Option 1 for handling the dynamic nature of E-Wallet CDNs. By forcing DNS and leveraging RouterOS v7 Address Lists, the network architecture can reliably track the rotating IP addresses of known payment domains in real-time, regardless of regional load balancing or Anycast routing. However, the fundamental inability of this approach to support the unpredictable domains required by EMV 3D Secure renders it incomplete as a standalone solution for any portal intending to process credit and debit cards.

## **4\. The Comprehensive Domain Allow-List**

To implement Option 2, or the recommended Hybrid architecture detailed in the subsequent section, a precise and exhaustive list of requisite hostnames must be mapped. Research into the payment flows of GCash via Maya, Google Pay, QRPh, and major card networks reveals the following minimal allow-list required for checkout rendering and execution.

### **Table 1: Primary E-Wallet and Gateway Domains**

These domains represent the core infrastructure required to render the checkout interface, process E-Wallet transactions, and generate dynamic QR codes.

| Service Segment | Required Domains / Wildcards | Justification |
| :---- | :---- | :---- |
| **Maya (PayMaya) Core** | \*.maya.ph \*.paymaya.com \*.pbm.paymaya.com | Essential for Maya API connectivity, hosting the primary checkout frontend, and resolving server-to-server Webhook notifications17. |
| **GCash & Alipay** | \*.gcash.com \*.alipay.com \*.alipayobjects.com \*.alicdn.com \*.antgroup.com | Required to reach GCash authorization endpoints and to load the Alipay cashier frontend CDN assets, which are embedded within the Maya checkout flow18. |
| **Google Pay** | pay.google.com payments.google.com \*.googleapis.com \*.gstatic.com | Necessary for Google Pay interface rendering, fetching critical cryptographic assets, and API submission5. |
| **QRPh Infrastructure** | Assumed under Maya/GCash domains | QRPh dynamic codes are generated and served directly via the acquiring gateway's API (e.g., pg.maya.ph) and do not typically require separate top-level domains for rendering34. |

### **Table 2: Representative 3D Secure (ACS) Domains**

This table is explicitly illustrative, not exhaustive. It highlights the vast decentralization of ACS infrastructure, emphasizing why a strict domain allow-list fundamentally fails for credit card processing and necessitates a behavioral bypass mechanism.

| ACS Vendor / Infrastructure | Common ACS Domains Encountered | Reference |
| :---- | :---- | :---- |
| **CardinalCommerce (Visa)** | \*.cardinalcommerce.com, 1eaf.cardinalcommerce.com, songbird.cardinalcommerce.com | 13 |
| **Broadcom / Arcot** | \*.arcot.com, secure2.arcot.com, secure4.arcot.com, secure5.arcot.com | 4 |
| **Modirum** | \*.modirum.com, acs1.3ds.modirum.com | 11 |
| **Worldline / WLP** | \*.wlp-acs.com, luxembourg-3ds-bxl.wlp-acs.com | 11 |
| **Generic Bank Portals** | acs.boccc.com.hk, 3dauthentication.bankcomm.com, vbv.samsungcard.co.kr | 11 |

## **5\. Philippine Community Practices and Workarounds**

Analyzing the approaches taken by commercial hotspot operators and local Philippine Internet Service Providers (ISPs) provides valuable context for solving these complex routing issues in production environments.  
In the Philippines, the "Piso WiFi" ecosystem—driven by open-source systems like JuanFi and comprehensive voucher management platforms like KLCiS—dominates the micro-transaction internet market. These operators face the exact same challenges when attempting to integrate e-payments (GCash, PayMaya, ShopeePay) into their coin-operated or voucher-based machines40.  
Reviewing the documentation and forum discussions surrounding these systems reveals that local operators frequently abandon the traditional Walled Garden approach for complex checkouts. Instead of trying to maintain exhaustive domain lists, systems like JuanFi and KLCiS often separate the payment process from the captive portal entirely40. A user might purchase a voucher code using their mobile data on an external website, and the system delivers the code via SMS, which the user then inputs into the captive portal.  
For integrated checkouts, advanced operators on the MikroTik forums frequently implement a "Temporary Trial Bypass" script14. When a user signals their intent to purchase, the hotspot backend executes a script that temporarily authorizes the user's MAC address for full internet access for a strictly limited duration (e.g., 10 to 15 minutes)15. This provides the client device with the unfettered access required to navigate complex, multi-domain 3DS authentication flows. If the payment gateway sends a successful Webhook confirmation within that window, the user is transitioned to their purchased data plan. If the window expires without confirmation, the temporary authorization is revoked, and the user is returned to the captive state. Commercial enterprise hotspot platforms, such as Powerlynx, explicitly document this exact behavior to handle South African 3DS requirements (e.g., Payfast) and Stripe implementations, noting that "there is no need to configure Walled Garden hosts when using this feature, as it is automatically skipped" during the trial session4.

## **6\. Recommended Architecture: The Hybrid "Trial Bypass" Strategy**

Based on the exhaustive research, neither Option 1 (IPs) nor Option 2 (DNS) can independently satisfy the constraints of modern HTTPS CDNs while simultaneously supporting the unpredictable domain routing of 3D Secure credit card processing.  
Therefore, this report recommends a **Hybrid Architecture** that combines the strengths of advanced DNS snooping with the behavioral flexibility of a temporary bypass. This architecture leverages Option 2 (Forced DNS \+ Address Lists) to ensure the initial captive portal and the Maya checkout page render flawlessly. However, to solve the 3DS problem, it abandons the Walled Garden at the precise moment of transaction, granting a restricted "Temporary Trial Bypass" that opens external access just long enough to complete the payment4.

### **6.1 Architectural Workflow**

> 1. **Phase 1: Pre-Authentication (Walled Garden).** The guest connects to the Wi-Fi. The router intercepts standard DNS and actively blocks DoT/DoH to ensure query visibility. Using RouterOS v7 /ip dns static rules, queries for primary gateway domains (maya.ph, gcash.com, google.com) are dynamically appended to a Payment\_Gateways firewall address list. The user is redirected to the Hotspot login page and chooses to purchase Wi-Fi time.  
> 2. **Phase 2: Checkout Rendering.** The user selects a plan and clicks "Pay with Maya." The browser is redirected to payments.maya.ph. Because this domain was dynamically mapped to the Payment\_Gateways address list via the intercepted DNS query, the router allows the HTTPS traffic to pass. The Maya checkout renders successfully, presenting GCash, Google Pay, and Credit Card options.  
> 3. **Phase 3: The Transaction Trigger (Temporary Bypass).** When the user selects a payment method and clicks the final "Confirm/Pay" button, the hotspot backend executes a RouterOS API command (or utilizes a RADIUS Change of Authorization, CoA). This command adds the user's IP or MAC address to a specific Bypass Address List (e.g., Checkout\_In\_Progress) for exactly 15 minutes15.  
> 4. **Phase 4: Authentication and 3DS Execution.** For the next 15 minutes, the user's device is granted unrestricted access to TCP port 443 (HTTPS)14. If they selected a credit card, the browser's redirect to secure4.arcot.com or their local bank's unique ACS portal proceeds without interference, allowing them to receive and input their OTP.  
> 5. **Phase 5: Resolution.** The payment succeeds or fails. Maya sends a server-to-server Webhook to the hotspot backend confirming the transaction status33.  
   * If the Webhook indicates success, the backend authenticates the user for their purchased time, removing them from the temporary bypass list and initiating their standard hotspot session.  
   * If the 15 minutes expire without a successful Webhook, the router automatically drops the user from the Checkout\_In\_Progress list, plunging them back into the restricted captive state.

## **7\. Concrete RouterOS Configuration Guide**

The following details the exact RouterOS Command Line Interface (CLI) configuration required to implement this Hybrid architecture. This implementation mandates the use of RouterOS v7.x to utilize the critical match-subdomain and FWD features within the DNS settings.

### **Step 1: Force Client DNS and Mitigate Encrypted DNS Bypasses**

To ensure the router observes the DNS queries required to populate the dynamic address lists, client DNS requests must be intercepted, and encrypted alternatives must be blocked to force fallback behaviors.

Code snippet  
/ip firewall nat  
\# Redirect standard unencrypted DNS to the router's internal resolver.  
\# We exclude the router itself (\!dns-resolvers) to prevent routing loops.  
add chain=dstnat action=redirect to-ports=53 protocol=udp dst-port=53 src-address-list=\!dns-resolvers comment="Force DNS UDP"  
add chain=dstnat action=redirect to-ports=53 protocol=tcp dst-port=53 src-address-list=\!dns-resolvers comment="Force DNS TCP"

/ip firewall filter  
\# Drop DoT (DNS over TLS) on port 853 to force Android Private DNS to fall back to port 53\.  
add chain=forward action=drop protocol=tcp dst-port=853 comment="Block DoT (Android Private DNS Fallback)"

\# Drop known DoH providers to force browsers to fall back to unencrypted DNS.  
\# (Note: The operator must manually populate the 'Known\_DoH\_IPs' address list with common providers like 8.8.8.8, 1.1.1.1, 9.9.9.9)  
add chain=forward action=drop protocol=tcp dst-port=443 dst-address-list=Known\_DoH\_IPs comment="Block known DoH Providers"

### **Step 2: Configure Dynamic Address List Population via DNS**

Instead of utilizing the unreliable /ip hotspot walled-garden feature, this configuration utilizes the DNS static table to catch queries and build a firewall address list dynamically29. The type=FWD parameter instructs the router to forward the query to an upstream resolver, intercept the response, follow any CNAME chains, and add the ultimate resolved IP to the Payment\_Gateways list8.

Code snippet  
\# Artificially extend the duration IPs remain in the list to combat low CDN TTLs  
/ip dns set address-list-extra-time=15m

/ip dns static  
\# Maya & PayMaya Domains  
add match-subdomain=yes name=maya.ph type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=paymaya.com type=FWD address-list=Payment\_Gateways

\# GCash & Alipay Domains  
add match-subdomain=yes name=gcash.com type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=alipay.com type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=alipayobjects.com type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=alicdn.com type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=antgroup.com type=FWD address-list=Payment\_Gateways

\# Google Pay Domains  
add match-subdomain=yes name=google.com type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=googleapis.com type=FWD address-list=Payment\_Gateways  
add match-subdomain=yes name=gstatic.com type=FWD address-list=Payment\_Gateways

### **Step 3: Allow the Dynamic Address List Through the Captive Portal**

The MikroTik Hotspot intercepts unauthenticated traffic using the hs-unauth chain in the NAT table. To bypass the captive portal for our dynamically populated address list, an accept rule is inserted at the top of the pre-hotspot chain. This ensures the rule processes before the traffic can be redirected.

Code snippet  
/ip firewall nat  
\# Allow unauthenticated users to reach the payment gateways without being redirected to the splash page.  
\# This rule MUST be placed above the default hotspot redirection rules.  
add chain=pre-hotspot action=accept dst-address-list=Payment\_Gateways comment="Walled Garden Bypass for Payment Gateways"

### **Step 4: Executing the 15-Minute Trial Bypass for 3DS (Phase 3 & 4\)**

To accommodate the unpredictable 3DS ACS domains, the backend system governing the captive portal splash page must trigger a RouterOS API call the precise moment the user confirms their intent to pay. This dynamically adds the user to a temporary bypass list.  
The RouterOS API command (executed by an external captive portal server via a scripting language like Python or PHP) conceptually operates as follows:

Code snippet  
/ip firewall address-list add list=Checkout\_In\_Progress address=\<Client\_IP\> timeout=15m comment="Temporary 3DS Bypass"

A corresponding NAT rule allows clients on this list temporary, unfettered access to the internet to complete their transaction:

Code snippet  
/ip firewall nat  
\# This rule bypasses the hotspot redirection for clients actively checking out.  
\# Place this directly below the Payment\_Gateways bypass rule.  
add chain=pre-hotspot action=accept src-address-list=Checkout\_In\_Progress comment="15-Minute Full Internet Bypass for Checkout"

To strictly limit network abuse during this open window, firewall filter rules must be deployed to restrict Checkout\_In\_Progress traffic exclusively to TCP port 443 (HTTPS). This prevents high-bandwidth, non-checkout activities (such as video streaming or peer-to-peer torrenting) during the 15-minute grace period14.

Code snippet  
/ip firewall filter  
\# Allow HTTPS traffic for the authentication flow  
add chain=forward action=accept protocol=tcp dst-port=443 src-address-list=Checkout\_In\_Progress comment="Allow HTTPS for Checkout Bypass"

\# Explicitly drop all other traffic from the client to prevent abuse  
add chain=forward action=drop src-address-list=Checkout\_In\_Progress comment="Drop non-HTTPS traffic during Checkout Bypass"

#### **Works cited**

> 1. MikroTik: Setting Up the Walled Garden for PPPoE users \- SIMPLer WiKi \- Azotel, [https://wiki.azotel.com/frequently-asked-questions/mikrotik-setting-up-the-walled-garden-for-pppoe-users](https://wiki.azotel.com/frequently-asked-questions/mikrotik-setting-up-the-walled-garden-for-pppoe-users)  
> 2. Mikrotik Hotspot Walled Garden Guide | PDF | Ip Address | Web Server \- Scribd, [https://www.scribd.com/document/94431160/Mikrotik-Hotspot-Walled-Garden](https://www.scribd.com/document/94431160/Mikrotik-Hotspot-Walled-Garden)  
> 3. Paypal With Hotspot And Walled Garden Bypass \- MikroTik Script RouterOS, [https://buananetpbun.github.io/mikrotik/paypal-with-hotspot-and-walled-garden-bypass.html](https://buananetpbun.github.io/mikrotik/paypal-with-hotspot-and-walled-garden-bypass.html)  
> 4. Mikrotik Walled Garden \- Networking \- PowerLynx, [https://forum.powerlynx.app/t/mikrotik-walled-garden/19](https://forum.powerlynx.app/t/mikrotik-walled-garden/19)  
> 5. Whitelist I Antamedia Cloud WiFi Software \- Start Hotspot Help, [https://go.starthotspot.com/help/whitelist](https://go.starthotspot.com/help/whitelist)  
> 6. Hotspot Walled Garden https problem \- General \- MikroTik community forum, [https://forum.mikrotik.com/t/hotspot-walled-garden-https-problem/65856](https://forum.mikrotik.com/t/hotspot-walled-garden-https-problem/65856)  
> 7. What is Private DNS setting in Android OS \- Cyber Raiden \- WordPress.com, [https://cyberraiden.wordpress.com/2026/04/28/what-is-android-private-dns/](https://cyberraiden.wordpress.com/2026/04/28/what-is-android-private-dns/)  
> 8. MikroTik DNS Complete Guide: DNS Cache, DoH, Adlist, mDNS... \- HellasCom LTD, [https://www.hellascom.gr/en/blog/mikrotik-dns-complete-guide-doh-adlist-mdns-forwarders](https://www.hellascom.gr/en/blog/mikrotik-dns-complete-guide-doh-adlist-mdns-forwarders)  
> 9. Results of our Open-Knock method applied on the Tranco top 6000, [https://www.researchgate.net/figure/Results-of-our-Open-Knock-method-applied-on-the-Tranco-top-6000-list-resulting-in-a\_fig2\_343966537](https://www.researchgate.net/figure/Results-of-our-Open-Knock-method-applied-on-the-Tranco-top-6000-list-resulting-in-a_fig2_343966537)  
> 10. Mastercard Processing Authentication Hub APIs, [https://developer.mastercard.com/mastercard-processing-authentication/documentation](https://developer.mastercard.com/mastercard-processing-authentication/documentation)  
> 11. Google Analytics: 70 ACS Referral Exclusions for E-Commerce \- King Rosales, [https://www.kingrosales.com/blog/google-analytics-list-of-top-68-referral-exclusions-for-retail-e-commerce/](https://www.kingrosales.com/blog/google-analytics-list-of-top-68-referral-exclusions-for-retail-e-commerce/)  
> 12. Authenticate a 3D-Secure Transaction with a One-Time Passcode Sent by the ACS Provider, [https://developer.mastercard.com/mastercard-processing-authentication/documentation/use-cases/auth-trans-with-otp-acs-provider/](https://developer.mastercard.com/mastercard-processing-authentication/documentation/use-cases/auth-trans-with-otp-acs-provider/)  
> 13. 2606:4700:3030::6815:4eb8 \- Shodan, [https://www.shodan.io/host/2606:4700:3030::6815:4eb8](https://www.shodan.io/host/2606:4700:3030::6815:4eb8)  
> 14. 3D Secure \+ hotspot \= no sale \- General \- MikroTik community forum, [https://forum.mikrotik.com/t/3d-secure-hotspot-no-sale/78229](https://forum.mikrotik.com/t/3d-secure-hotspot-no-sale/78229)  
> 15. 10min free access script only to complete voucher purchase \- MikroTik Forum, [https://forum.mikrotik.com/t/10min-free-access-script-only-to-complete-voucher-purchase/78324](https://forum.mikrotik.com/t/10min-free-access-script-only-to-complete-voucher-purchase/78324)  
> 16. ip walled garden setup \- General \- MikroTik community forum, [https://forum.mikrotik.com/t/ip-walled-garden-setup/50194](https://forum.mikrotik.com/t/ip-walled-garden-setup/50194)  
> 17. Domains and IP Addresses \- Maya Developer Hub, [https://developers.maya.ph/docs/domains-and-ip-addresses](https://developers.maya.ph/docs/domains-and-ip-addresses)  
> 18. Cashier Payment \- Alipay+, [https://www.alipayplus.com/cashier-payment/](https://www.alipayplus.com/cashier-payment/)  
> 19. bughunters/domain-tiers/external\_domains\_google.asciipb at main \- GitHub, [https://github.com/google/bughunters/blob/main/domain-tiers/external\_domains\_google.asciipb](https://github.com/google/bughunters/blob/main/domain-tiers/external_domains_google.asciipb)  
> 20. 54.36.227.47 \- Shodan, [https://www.shodan.io/host/54.36.227.47](https://www.shodan.io/host/54.36.227.47)  
> 21. Diff \- 8b7d433f10fd854784121020b76e29295bf51f84^\! \- devtools/devtools-frontend \- Git at Google, [https://chromium.googlesource.com/devtools/devtools-frontend/+/8b7d433f10fd854784121020b76e29295bf51f84%5E%21/](https://chromium.googlesource.com/devtools/devtools-frontend/+/8b7d433f10fd854784121020b76e29295bf51f84%5E%21/)  
> 22. Google Play Store and "hidden" connections \- GrapheneOS Discussion Forum, [https://discuss.grapheneos.org/d/25278-google-play-store-and-hidden-connections](https://discuss.grapheneos.org/d/25278-google-play-store-and-hidden-connections)  
> 23. Mikrotik Installation Guide – manual \- HotspotSystem, [https://www.hotspotsystem.com/mikrotik-installation-guide-manual](https://www.hotspotsystem.com/mikrotik-installation-guide-manual)  
> 24. DNS-over-HTTPS vs DNS-over-TLS with VPN in 2026: What to, [https://vpn.how/de/pages/dns-over-https-vs-dns-over-tls-with-vpn-in-2026-what-to-choose-how-to-set-up-and-avoid-mistakes.html](https://vpn.how/de/pages/dns-over-https-vs-dns-over-tls-with-vpn-in-2026-what-to-choose-how-to-set-up-and-avoid-mistakes.html)  
> 25. ncravino/mikrotik\_enforce\_dns\_block\_doh: Router DNS enforcing and DoH Blocking for MikroTik Router OS \- GitHub, [https://github.com/ncravino/mikrotik\_enforce\_dns\_block\_doh](https://github.com/ncravino/mikrotik_enforce_dns_block_doh)  
> 26. Community.Routeros Release Notes \- Ansible documentation, [https://docs.ansible.com/projects/ansible/latest/collections/community/routeros/changelog.html](https://docs.ansible.com/projects/ansible/latest/collections/community/routeros/changelog.html)  
> 27. RouterOS 7.11 \- kid control not working? \- General \- MikroTik community forum, [https://forum.mikrotik.com/t/routeros-7-11-kid-control-not-working/168916](https://forum.mikrotik.com/t/routeros-7-11-kid-control-not-working/168916)  
> 28. DNS \- RouterOS \- MikroTik Documentation, [https://help.mikrotik.com/docs/spaces/ROS/pages/37748767/DNS](https://help.mikrotik.com/docs/spaces/ROS/pages/37748767/DNS)  
> 29. v7.5beta \[testing\] is released\! \- Page 6 \- MikroTik Forum, [https://forum.mikrotik.com/t/v7-5beta-testing-is-released/159724?page=6](https://forum.mikrotik.com/t/v7-5beta-testing-is-released/159724?page=6)  
> 30. Список изменений \- Mikrotik.moscow, [https://mikrotik.moscow/downloads/changelogs/](https://mikrotik.moscow/downloads/changelogs/)  
> 31. v7.7rc is released\! \- Page 6 \- Announcements \- MikroTik community, [https://forum.mikrotik.com/t/v7-7rc-is-released/162872?page=6](https://forum.mikrotik.com/t/v7-7rc-is-released/162872?page=6)  
> 32. Why are my static DNS records forwarding upstream? \- Page 2 \- General \- MikroTik Forum, [https://forum.mikrotik.com/t/why-are-my-static-dns-records-forwarding-upstream/183529?page=2](https://forum.mikrotik.com/t/why-are-my-static-dns-records-forwarding-upstream/183529?page=2)  
> 33. About Maya Checkout \- Maya Developer Hub, [https://developers.maya.ph/reference/about-maya-checkout](https://developers.maya.ph/reference/about-maya-checkout)  
> 34. QRPh Payment Integration \- PayRex Documentation, [https://docs.payrex.com/docs/guide/developer\_handbook/payments/payment\_methods/qrph/receive\_a\_payment](https://docs.payrex.com/docs/guide/developer_handbook/payments/payment_methods/qrph/receive_a_payment)  
> 35. QR Ph Digital Wallet Integration Guide \- EBANX Docs, [https://docs.ebanx.com/docs/pay-in/processing/payment-methods/country-specific/philippines/qrph](https://docs.ebanx.com/docs/pay-in/processing/payment-methods/country-specific/philippines/qrph)  
> 36. QR Ph API \- PayMongo Documentation, [https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api](https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api)  
> 37. CSP Error: Refused to load the script \- General \- Cloudflare Community, [https://community.cloudflare.com/t/csp-error-refused-to-load-the-script/824898](https://community.cloudflare.com/t/csp-error-refused-to-load-the-script/824898)  
> 38. Refused to load the script Piwik Pro \- Data collection and tags, [https://community.piwik.pro/t/refused-to-load-the-script-piwik-pro/1046](https://community.piwik.pro/t/refused-to-load-the-script-piwik-pro/1046)  
> 39. 3D Secure Iframe Content Security Policy · Issue \#497 · braintree, [https://github.com/braintree/braintree-web/issues/497?timeline\_page=1](https://github.com/braintree/braintree-web/issues/497?timeline_page=1)  
> 40. darkhoundz/KLCiS-JuanFi: JuanFi with e-payment support for hotspot voucher code. \- GitHub, [https://github.com/darkhoundz/KLCiS-JuanFi](https://github.com/darkhoundz/KLCiS-JuanFi)  
> 41. Hotspot, walled garden deny action \- General \- MikroTik community forum, [https://forum.mikrotik.com/t/hotspot-walled-garden-deny-action/44561](https://forum.mikrotik.com/t/hotspot-walled-garden-deny-action/44561)  
> 42. Testing and Validating Your Maya Checkout Integration, [https://developers.maya.ph/reference/testing-and-validating-your-maya-checkout-integration](https://developers.maya.ph/reference/testing-and-validating-your-maya-checkout-integration)