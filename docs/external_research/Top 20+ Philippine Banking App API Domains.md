# **Network Architecture and Walled Garden Implementation: A Comprehensive Framework for Whitelisting Philippine Financial Applications on Captive Portals**

The intersection of public telecommunications infrastructure and digital financial services has generated highly complex operational requirements for network administrators. When users connect to public or guest Wi-Fi networks in commercial venues, transportation hubs, or hospitality environments, their traffic is typically intercepted by a captive portal. This portal places the user’s device into a pre-authentication state, effectively blocking wide area network (WAN) access until the user accepts a terms-of-service agreement or processes a payment. However, a significant architectural paradox arises when network operators attempt to monetize internet access through digital payments: a user cannot access their digital bank or e-wallet to pay for the Wi-Fi if the Wi-Fi network itself is blocking access to the internet.  
To resolve this paradox, network engineers must construct a "walled garden." A walled garden is a pre-approved whitelist of specific domains, subdomains, and IP addresses that bypass the captive portal’s interception mechanics, allowing unauthenticated users to communicate freely with specific destination servers1. This comprehensive research report delineates the architectural blueprint for whitelisting the top 20 or more major e-wallets and banking applications in the Philippines. The analysis strictly focuses on the Application Programming Interface (API) endpoints, Content Delivery Networks (CDNs), and backend domains requisite for native application functionality, while expressly excluding domains associated with external credit and debit card security verification.

## **The Technical Mechanics of Captive Portals and Walled Gardens**

The foundational mechanism of a captive portal involves the interception of HTTP and HTTPS traffic from an unauthenticated client. This is most commonly achieved through Layer 3 traffic redirection or Domain Name System (DNS) spoofing1. When a device associates with the wireless access point and requests an IP address via DHCP, the network controller intercepts the subsequent DNS queries. Instead of resolving the requested domain (e.g., google.com), the controller responds with the IP address of its localized or cloud-hosted splash page server1. The user is held in a restricted pre-authentication role, unable to establish Transmission Control Protocol (TCP) connections with any external server1.  
The implementation of a walled garden overrides this localized interception for specified destinations. Different enterprise network hardware vendors handle this whitelisting capability with varying degrees of granularity:

> * **Aruba Instant On:** The Aruba ecosystem permits the configuration of up to 253 unique Uniform Resource Locators (URLs) for unauthenticated users accessing external captive portal networks1. When a domain such as a banking API is added to this whitelist, the automatic URL interception is bypassed for the pre-authentication role of guest users, allowing the TLS handshake to proceed natively1.  
> * **Peplink:** Modern Peplink firmware (version 6.1.2 and later) supports advanced walled garden configurations that accept explicit IP addresses, exact fully qualified domain names (FQDNs), and wildcard domains (e.g., \*.bdo.com.ph)2. This wildcard capability is critical for modern mobile applications that dynamically balance loads across hundreds of subdomains.  
> * **Cisco Meraki:** The Meraki dashboard allows administrators to define walled garden ranges, requiring the explicit entry of IP address ranges and domains necessary for the splash page and authorized pre-authentication access to function3.  
> * **StartHotspot:** Specialized hotspot management platforms require explicit whitelisting of payment gateway domains, CDNs, and specific callback URLs to ensure the functionality of integrated e-wallets4. For example, when integrating Philippine e-wallets via Xendit, specific API channels must be whitelisted directly in the routing table alongside specific callback strings to signal transaction completion4.

The complexity of creating a whitelist for modern financial applications lies in their distributed architecture. A mobile banking application does not communicate with a single monolithic server. Upon launch, it executes dozens of concurrent connections to API gateways for authentication, CDNs for user interface assets, and telemetry servers for risk assessment5. If the captive portal intercepts even one critical API endpoint, the application will experience a connection timeout, rendering the user unable to complete their transaction.

## **Regulatory Catalysts: The Imminent Shift in Authentication Paradigms**

The urgency for deploying accurate, comprehensive walled garden configurations is currently being accelerated by aggressive regulatory shifts within the Philippine financial sector. The Bangko Sentral ng Pilipinas (BSP), acting as the central monetary authority, has issued sweeping mandates altering how supervised financial institutions handle customer authentication and fraud prevention.  
These regulatory actions are primarily driven by the Anti-Financial Account Scamming Act (AFASA), or Republic Act No. 120106. Under these new directives, the BSP has mandated that all supervised financial institutions (BSFIs) phase out reliance on text-based (SMS) and email-based One-Time Passwords (OTPs) for high-risk transactions6. By the regulatory deadline of June 25, 2026, legacy OTPs must be replaced by stronger, encrypted authentication technologies, including biometric verification, behavioral analytics, adaptive authentication, or cryptographic password-less solutions6. This stringent requirement applies universally to commercial banks and electronic wallet operators that process at least PHP 75 million in average monthly online transactions over a trailing six-month period6.

### **Network Implications of the BSP Authentication Mandate**

The transition away from SMS-based OTPs fundamentally alters the baseline network requirements for user authentication in the Philippines. SMS operates entirely over the cellular voice and signaling network (SS7/Diameter); therefore, a user without an active mobile data connection could historically still receive an OTP to authorize a transaction. Conversely, the mandated replacement technologies—biometric token validation, app-based push notifications, and adaptive behavioral profiling—require a continuous, encrypted, and stable Internet Protocol (IP) connection to communicate securely with the bank's central authentication servers6.  
If a user connects to a commercial public Wi-Fi network and is placed in a captive portal, they are entirely severed from the bank's authentication infrastructure. They cannot authenticate their digital bank account to pay for the Wi-Fi access unless the bank's specific biometric and API tokenization endpoints are explicitly whitelisted. Consequently, the BSP’s phase-out of offline SMS OTPs dictates that walled gardens are no longer merely a convenience for user experience; they are a strict, operational necessity for the functional monetization and usability of captive portal networks throughout the country.

## **Strategic Exclusion of Credit and Debit Card Security Domains**

In adhering to specific, streamlined network deployment parameters, this architectural framework expressly excludes domains associated with traditional credit and debit card security verification.  
When a user initiates an online transaction using a standard Visa, Mastercard, or JCB card, the payment gateway typically invokes the 3D Secure (3DS) protocol to verify the cardholder's identity and shift fraud liability. This process involves redirecting the user's browser or application frame to an Access Control Server (ACS) hosted either by the issuing bank or the global card network itself. These domains frequently manifest as highly dynamic, regionally balanced subdomains, such as secure.verifiedbyvisa.com, identitycheck.mastercard.com, or bank-specific dynamic routing domains like secure07b.chase.com8.  
The inclusion of these domains in a walled garden presents massive security and maintenance liabilities. Card network domains are virtually infinite in their variations and change rapidly based on global routing policies. Furthermore, this report is strictly focused on facilitating access to native e-wallets and mobile banking applications—ecosystems where authentication is handled entirely within the application's proprietary, closed-loop environment via PINs, biometrics, or internally generated cryptographic tokens. By excluding external card network verification domains, network administrators can maintain a lean, highly deterministic, application-specific walled garden that limits the attack surface of the pre-authentication network state.

## **Architectural Directory of Major Philippine E-Wallets**

Electronic wallets have achieved extraordinary market penetration in the Philippines, driven largely by historically high populations of unbanked citizens and the rapid, pandemic-accelerated adoption of QR-based payments10. These applications rely on complex microservices architectures, frequently leveraging third-party Platform as a Service (PaaS) infrastructure and regional cloud providers.

### **1\. GCash (Globe Fintech Innovations, Inc. / Mynt)**

GCash, operated by Mynt, is the most universally utilized e-wallet in the Philippines. The application's backend architecture is heavily integrated with Alibaba's Alipay infrastructure, utilizing their cloud services for risk management, payment routing, and cross-border settlement4. The GCash application requires a highly granular whitelist due to its reliance on disparate PaaS endpoints5.  
Network administrators must whitelist primary API endpoints alongside specific Alipay routing domains. Furthermore, telemetry and advertisement tracking subdomains (such as kde.mynt.xyz, which resolves to the Adzerk/Kevel tracking network) can be safely omitted from the whitelist without degrading the core transactional capability of the application5.

| Application | Primary Backend Domains & APIs | Required CDNs & Integrations |
| :---- | :---- | :---- |
| **GCash** | \*.gcash.com | \*.alipay.com |
|  | payment.gcash.com | irisk-sea.alipay.com |
|  | api.mynt.xyz | mobilegw.alipay.com |
|  | login.mynt.xyz | w.alipayobjects.com |
|  | mdap.paas.mynt.xyz | g.alipaypplus.com |
|  | mss.paas.mynt.xyz | resources.gcash.com |
|  | mgs-gw.paas.mynt.xyz | new.gcash.com |
|  | paybills.mynt.xyz | www.beta.gcash.com |

### **2\. Maya (formerly PayMaya)**

Maya operates a dual-model ecosystem, functioning simultaneously as a traditional e-wallet and a fully licensed digital bank. Its architecture separates consumer-facing application services from heavy payment gateway routing. Integration documentation from payment processors explicitly details the domains utilized for both production and sandbox payment routing environments4.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **Maya** | \*.maya.ph | api.maya.ph |
|  | \*.paymaya.com | payments-web.paymaya.com |
|  | pg.paymaya.com |  |

### **3\. ShopeePay**

ShopeePay is integrated directly into the broader Shopee e-commerce application but functions as an independent payment provider at physical retail terminals and integrated payment gateways9. Because the wallet is embedded deeply within the main Shopee application infrastructure, granting access to the wallet necessitates whitelisting Shopee's root domains and their specific API routing endpoints13.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **ShopeePay** | \*.shopeepay.ph | api.shopee.ph |
|  | \*.shopeepay.com |  |
|  | \*.shopee.ph |  |

### **4\. GrabPay**

Functioning within the Grab regional super-app ecosystem, GrabPay serves as a primary cashless payment method for ride-hailing, food delivery, and widespread merchant payments across the Philippines10. Grab's infrastructure is highly reliant on Amazon Web Services (AWS) and its own proprietary, localized API gateways14.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **GrabPay** | \*.grab.com | pay.grab.com |
|  | api.grab.com |  |

### **5\. Coins.ph**

Regulated by the BSP as both a fiat e-wallet and a virtual asset service provider, Coins.ph utilizes standard RESTful APIs for its mobile application architecture. The platform requires unrestricted access to its core domain and associated API versions for seamless centralized exchange queries and standard wallet transactions15.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **Coins.ph** | \*.coins.ph | app.coins.ph |
|  | api.coins.ph |  |

### **6\. PalawanPay**

Developed by the Palawan Pawnshop Group to digitize their vast physical remittance network, PalawanPay extends domestic remittance services into the digital wallet space. It operates on modern cloud infrastructure, requiring its root domains to be whitelisted for API calls governing account balances, transfers, and QR-based payments15.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **PalawanPay** | \*.palawanpay.com | api.palawanpay.com |

### **7\. Starpay**

Starpay focuses aggressively on grassroots financial inclusion, frequently utilized for government cash distribution programs (such as the Social Amelioration Program) and local merchant payments in tier-2 and tier-3 municipalities15. Its application logic relies on straightforward domain calls to its centralized servers.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **Starpay** | \*.starpay.com.ph | api.starpay.com.ph |

## **Architectural Directory of Tier 1 Traditional Banks**

Traditional banking institutions in the Philippines have undergone massive, capital-intensive digital transformations to defend their market share against nimble fintech startups. These banks, explicitly listed by the Credit Information Corporation (CIC) as major accessing entities18, have developed robust mobile applications that rely on dedicated Mobile Backend as a Service (MBaaS) platforms19. MBaaS architectures expose specific APIs to mobile clients for core banking functions like user management, ledger queries, and push notifications.

### **8\. BDO Unibank**

As the largest commercial bank in the Philippines by total assets, BDO Unibank has continually updated its digital infrastructure to handle massive concurrency19. Their modern mobile application architecture routes traffic through specific online domains, differentiating strictly between informational websites and secure transactional APIs20.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **BDO Unibank** | \*.bdo.com.ph | api.bdo.com.ph |
|  | online.bdo.com.ph |  |

### **9\. Bank of the Philippine Islands (BPI)**

BPI provides an extensive, highly integrated digital banking ecosystem. Their application heavily utilizes features such as QR Ph integration, real-time interbank fund transfers, and proprietary "Mobile Key" biometric authorization22. The BPI mobile application connects directly to their online banking portal's backend architecture for all transactional verification8.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **BPI** | \*.bpi.com.ph | api.bpi.com.ph |
|  | online.bpi.com.ph |  |

### **10\. UnionBank of the Philippines**

UnionBank is universally recognized as the foremost pioneer of digital banking in the Philippines, being the first commercial bank to adopt a strict API-first architecture, cloud-hosted platforms, and a fully convergent mobile application24. Their infrastructure is built entirely on decoupled microservices, meaning wildcard whitelisting for their root domain is absolutely critical to capture dynamically routed API traffic24.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **UnionBank** | \*.unionbankph.com | api.unionbankph.com |
|  | online.unionbankph.com |  |

### **11\. Security Bank**

Security Bank has invested heavily in its application-based offerings to compete directly with emerging financial technology firms and Neo-banks27. Their application requires seamless, uninhibited access to their root domains to process biometric logins, interbank fund transfers, and real-time balance inquiries28.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **Security Bank** | \*.securitybank.com | api.securitybank.com |
|  | \*.securitybank.com.ph | online.securitybank.com |

### **12\. Philippine National Bank (PNB)**

PNB operates a comprehensive digital banking application featuring in-app biometric authentication, QR-based payments, and extensive real-time remittance servicing for overseas Filipino workers29. The mobile application interfaces directly with their core financial center servers located on their primary domain31.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **PNB** | \*.pnb.com.ph | api.pnb.com.ph |

### **13\. Metropolitan Bank & Trust Company (Metrobank)**

Metrobank's modernized mobile application architecture requires precise whitelisting to ensure their client software can securely establish TLS connections to their main server clusters without being intercepted or dropped by the captive portal's splash page redirector29.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **Metrobank** | \*.metrobank.com.ph | api.metrobank.com.ph |
|  | online.metrobank.com.ph |  |

### **14\. Rizal Commercial Banking Corporation (RCBC)**

RCBC Digital offers advanced consumer features including cardless ATM withdrawals and fully digital account opening29. Their backend relies on continuous, unhindered access to their API gateways to validate user sessions and execute ledger updates.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **RCBC** | \*.rcbc.com | api.rcbc.com |
|  | online.rcbc.com |  |

### **15\. China Banking Corporation (China Bank)**

China Bank’s digital services route heavily through their localized Philippine domain. Their mobile banking platform requires standard wildcard whitelisting to ensure all transactional and authentication subdomains are reachable from the pre-authentication network state29.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **China Bank** | \*.chinabank.ph | api.chinabank.ph |
|  | online.chinabank.ph |  |

### **16\. EastWest Bank**

EastWest Bank provides a comprehensive mobile application servicing both retail and corporate clients. Access to their secure domains must be guaranteed to prevent session timeouts during complex, multi-step transactions29.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **EastWest** | \*.eastwestbanker.com | api.eastwestbanker.com |
|  | online.eastwestbanker.com |  |

### **17\. Asia United Bank (AUB)**

AUB is notable within the Philippine banking sector for being highly aggressive in digital payments integration, particularly concerning early adoption of QR technologies and cross-border integrations with WeChat Pay and Alipay18. Their mobile banking application relies on their core domain infrastructure.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **AUB** | \*.aub.com.ph | api.aub.com.ph |

### **18\. Land Bank of the Philippines (LandBank)**

As a government-owned universal bank servicing millions of public sector employees and conditional cash transfer beneficiaries, LandBank's iAccess and mobile banking platforms are critical components of national financial inclusion29. Their application routing requires access to their central government-linked domains.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **LandBank** | \*.landbank.com | api.landbank.com |
|  | \*.landbank.com.ph | lbpiaccess.com |

### **19\. PSBank (Philippine Savings Bank)**

Operating as the retail and savings banking arm of the Metrobank Group, PSBank manages its own highly rated mobile application. This application utilizes an independent API architecture and requires dedicated domain whitelisting separate from its parent company9.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **PSBank** | \*.psbank.com.ph | api.psbank.com.ph |
|  | online.psbank.com.ph |  |

## **Architectural Directory of Neo-Banks and Digital-Only Banks**

The BSP has recently issued a limited number of specialized digital banking licenses to entities that operate entirely without physical branch infrastructure. These neo-banks are inherently "cloud-native," relying extensively on modern API gateways, distributed systems, and mobile-first, agile architectures33.

### **20\. GoTyme Bank**

A high-growth joint venture between the Philippine Gokongwei Group and South Africa's Tyme Group, GoTyme Bank utilizes a highly modern, cloud-based digital banking infrastructure36. Because of its multi-national development lineage and decentralized engineering hubs (notably in Vietnam and South Africa), its APIs span multiple regional domains33. Its engineering teams build API-first, distributed systems capable of massive scaling34.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **GoTyme Bank** | \*.gotyme.com.ph | api.gotyme.com.ph |
|  | \*.gotyme.co.za |  |

### **21\. SeaBank Philippines**

Operated by Sea Limited (the Singaporean parent company of Shopee), SeaBank is a cloud-native rural and digital bank offering high-yield savings products and seamless ShopeePay integration29. Its infrastructure is deeply embedded into the broader Sea Limited network, utilizing highly resilient API gateways.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **SeaBank** | \*.seabank.ph | api.seabank.ph |
|  | \*.seabank.com.ph |  |

### **22\. Tonik Digital Bank**

Operating as Southeast Asia's first neobank under a digital bank license in the Philippines, Tonik relies entirely on cloud infrastructure to deliver its consumer services, which include customized "Stashes," high-yield time deposits, and instant consumer loans39. The Tonik application requires continuous access to its core domain for both API queries, encrypted biometric identity verification, and loan disbursement logic39.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **Tonik** | \*.tonikbank.com | app.tonikbank.com |
|  | api.tonikbank.com |  |

### **23\. UNO Digital Bank**

Pioneering a "full-spectrum" digital banking approach, UNO Digital Bank operates entirely through its centralized mobile application to facilitate saving, borrowing, and investing35. Given its total reliance on digital interfaces for the entire account lifecycle, its API routing domains are strictly required in the walled garden to prevent user abandonment43.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **UNO Digital** | \*.uno.bank | api.uno.bank |

### **24\. UnionDigital Bank**

Operating as the standalone, digital-only subsidiary of UnionBank, UnionDigital targets the unbanked and underbanked populations with specialized lending and deposit products29. While legally and operationally distinct from the parent commercial bank, it utilizes a similar API-first methodology and requires its own dedicated domain whitelisting29.

| Application | Primary Backend Domains & APIs | Secondary Infrastructure |
| :---- | :---- | :---- |
| **UnionDigital** | \*.uniondigitalbank.io | api.uniondigitalbank.io |

## **Resolving Third-Party Dependencies and Infrastructure Constraints**

A critical second-order complexity of whitelisting modern mobile financial applications is their deep reliance on third-party libraries and content delivery networks (CDNs). When a user launches a banking app, the initial runtime execution often pulls essential typographic, interface, and telemetry assets from external sources. For example, if GCash or BDO is perfectly whitelisted, but the application's user interface is built on frameworks that require rendering resources from Google or Cloudflare, the application may inexplicably freeze on the initial loading screen5.  
To ensure complete, end-to-end functionality of the applications listed above, it is highly recommended to include standard, foundational CDNs in the walled garden whitelist. Analytical tracking of e-wallet traffic indicates the following domains are heavily utilized during application initialization:

> * cdnjs.cloudflare.com (Provides common JavaScript libraries essential for UI rendering)5  
> * fonts.gstatic.com and fonts.googleapis.com (Serves UI typography required by material design frameworks)4  
> * www.googletagmanager.com (Frequently used by developers to asynchronously trigger essential application scripts and event handlers)4

While whitelisting these broad CDNs slightly increases the attack surface of the walled garden, they are generally considered safe as they solely serve static assets and do not facilitate bidirectional data tunneling.

## **Network Security and Operational Considerations**

The deployment of a comprehensive fintech whitelist generates significant ripple effects across the entire network ecosystem, necessitating robust traffic management policies.  
Firstly, by allowing unauthenticated access to high-bandwidth digital banking applications, network administrators must enforce strict Quality of Service (QoS) protocols and bandwidth throttling specifically on the pre-authentication role. If left unthrottled, malicious actors could potentially exploit the walled garden through MAC address spoofing, or legitimate users could unintentionally abuse the whitelist to download massive application updates (e.g., updating a 150MB+ application via the App Store, if Apple or Google domains inadvertently leak into the whitelist). This would starve the network of essential bandwidth intended for authenticated, paying users.  
Secondly, the architecture of SNI (Server Name Indication) routing must be considered. When the mobile application makes an HTTPS request, the captive portal examines the SNI header during the TLS handshake. If the SNI matches a domain on the whitelist, the traffic is allowed through without being intercepted by the proxy. However, administrators must ensure that their network hardware supports fully qualified domain name (FQDN) whitelisting rather than relying purely on static IP addresses. Modern banks utilize cloud load balancers where the backend IP address changes dynamically based on Time-to-Live (TTL) values and geographical routing. Attempting to whitelist static IP addresses for distributed apps like GoTyme, GCash, or Maya will result in intermittent, highly frustrating failures for the end user.  
Finally, the creation of a universal banking walled garden creates a highly lucrative environment for captive portal monetization. Network operators in high-density areas—such as transportation hubs, commercial malls, and rural communities—can seamlessly implement "Pay-per-use" Wi-Fi models. A user connects to the Wi-Fi, selects an internet package, and chooses to pay via GCash, Maya, or their preferred bank. Because those specific domains are whitelisted, the user successfully completes the payment flow natively within their app. The captive portal gateway then receives an automated callback (e.g., https://app.antamedia.com/payment/XenditCallback), verifies the transaction cryptographically, and seamlessly elevates the user's MAC address from the restricted pre-authentication role to the fully authenticated role4.

## **Synthesis and Strategic Outlook**

The convergence of public network infrastructure and digital finance in the Philippines demands highly sophisticated captive portal management. With the Bangko Sentral ng Pilipinas strictly enforcing a transition away from offline SMS OTPs toward data-dependent biometric and adaptive authentication methods by mid-2026, the reliance on stable, continuous internet access for basic financial transactions has become absolute6.  
Network administrators must proactively configure robust, wildcard-enabled walled gardens that allow unauthenticated access to the top e-wallets and banking applications operating in the country. By meticulously mapping out and whitelisting the precise API endpoints, CDNs, and root domains detailed in this architectural framework—while strictly enforcing the exclusion of extraneous credit card verification gateways—organizations can deploy a seamless, highly secure, and exceptionally monetizable public Wi-Fi ecosystem. This architecture not only supports the operational requirements of venue operators but directly facilitates the continued expansion and resilience of the modern Philippine digital economy.

#### **Works cited**

> 1. How to Whitelist domains for External Captive Portal Network. | Everything Instant On, [https://community.instant-on.hpe.com/viewthread?MID=506](https://community.instant-on.hpe.com/viewthread?MID=506)  
> 2. Captive portal whitelist \- Feature Requests \- Peplink Community, [https://forum.peplink.com/t/captive-portal-whitelist/2383](https://forum.peplink.com/t/captive-portal-whitelist/2383)  
> 3. SSID, Walled Garden, and Splash page Configuration \- Meraki Captive Portal API, [https://developer.cisco.com/meraki/captive-portal-api/meraki-dashboard-configuration/](https://developer.cisco.com/meraki/captive-portal-api/meraki-dashboard-configuration/)  
> 4. Payment Gateway Integrations I Antamedia Cloud WiFi Software \- Start Hotspot Help, [https://go.starthotspot.com/get-started/payment-gateway-integrations](https://go.starthotspot.com/get-started/payment-gateway-integrations)  
> 5. \[OTHER\] Local bank domain that was strangely blocked. Needs some investigation. Also connections dump. · Issue \#38 · celenityy/BadBlock \- GitHub, [https://github.com/celenityy/BadBlock/issues/38](https://github.com/celenityy/BadBlock/issues/38)  
> 6. Many banks and e-wallets have phased out OTPs for authentication, BSP says, [https://bworldonline.com/banking-finance/2026/06/25/758940/many-banks-and-e-wallets-have-phased-out-otps-for-authentication-bsp-says/](https://bworldonline.com/banking-finance/2026/06/25/758940/many-banks-and-e-wallets-have-phased-out-otps-for-authentication-bsp-says/)  
> 7. Strengthening Authentication, Fraud Prevention and Risk Governance Become Top Priorities for Philippine Banks \- Savyint, [https://savyint.com/strengthening-authentication-fraud-prevention-and-risk-governance-become-top-priorities-for-philippine-banks/](https://savyint.com/strengthening-authentication-fraud-prevention-and-risk-governance-become-top-priorities-for-philippine-banks/)  
> 8. Non-working sites \[obsolete\] · Issue \#1358 · keepassxreboot, [https://github.com/keepassxreboot/keepassxc-browser/issues/1358?timeline\_page=2](https://github.com/keepassxreboot/keepassxc-browser/issues/1358?timeline_page=2)  
> 9. PayDollar PayGate, [https://www.paydollar.com/pdf/op/enpdintguide.pdf](https://www.paydollar.com/pdf/op/enpdintguide.pdf)  
> 10. Transforming \- Globe Telecom, [https://www.globe.com.ph/sites/default/files/2024-01/Globe-2021-Integrated-Report-1.pdf](https://www.globe.com.ph/sites/default/files/2024-01/Globe-2021-Integrated-Report-1.pdf)  
> 11. HOMESERVA \- Community App for Residents & JMB/MC, [https://homeserva.com/](https://homeserva.com/)  
> 12. Domains and IP Addresses \- Maya Developer Hub, [https://developers.maya.ph/docs/domains-and-ip-addresses](https://developers.maya.ph/docs/domains-and-ip-addresses)  
> 13. Market Review on the Digital Economy Ecosystem Under the Competition Act 2010, [https://www.mycc.gov.my/sites/default/files/2025-03/Public\_Interim%20report%20for%20Market%20Review%20on%20the%20Digital%20Economy%20Ecosystem%20under%20the%20Competition%20Act%202010.pdf](https://www.mycc.gov.my/sites/default/files/2025-03/Public_Interim%20report%20for%20Market%20Review%20on%20the%20Digital%20Economy%20Ecosystem%20under%20the%20Competition%20Act%202010.pdf)  
> 14. SMARTSERVA \- Campus Operations Platform | xSERVA, [https://smartserva.com/](https://smartserva.com/)  
> 15. Skrill Quick Checkout Integration Guide, [https://www.skrill.com/fileadmin/content/pdf/Skrill\_Quick\_Checkout\_Guide.pdf](https://www.skrill.com/fileadmin/content/pdf/Skrill_Quick_Checkout_Guide.pdf)  
> 16. Manual · ccxt/ccxt Wiki \- GitHub, [https://github.com/ccxt/ccxt/wiki/manual](https://github.com/ccxt/ccxt/wiki/manual)  
> 17. What Is Alchemist AI ($ALCH)? Everything You Need to Know \- Coins.ph, [https://www.coins.ph/en-ph/academy/what-is-alchemist-ai-alch-everything-you-need-to-know](https://www.coins.ph/en-ph/academy/what-is-alchemist-ai-alch-everything-you-need-to-know)  
> 18. List of Accessing Entities (AEs) \- Credit Information Corporation (CIC), [https://cic.gov.ph/list-accessing-entities-aes/](https://cic.gov.ph/list-accessing-entities-aes/)  
> 19. Business Glossary: Topical Terms & Definitions You Must Know \- Clickworks, [https://clickworks.ie/business-glossary/](https://clickworks.ie/business-glossary/)  
> 20. HUAWEI BAR 310 23.1 PRODUCT DOCUMENTATION, [https://www.products.shopping/datasheet/huaweienterprises/EDOC1100406017/HUAWEI\_BAR\_310\_23\_1\_PRODUCT\_DOCUMENTATION.pdf](https://www.products.shopping/datasheet/huaweienterprises/EDOC1100406017/HUAWEI_BAR_310_23_1_PRODUCT_DOCUMENTATION.pdf)  
> 21. Official Email Senders | BDO Unibank, Inc., [https://www.bdo.com.ph/about-bdo/learn/stop-scam/official-email-senders](https://www.bdo.com.ph/about-bdo/learn/stop-scam/official-email-senders)  
> 22. Mobile \- BPI, [https://www.bpi.com.ph/personal/bank/digital-banking/mobile](https://www.bpi.com.ph/personal/bank/digital-banking/mobile)  
> 23. 30 Natatanging Tanong Tungkol sa Online Login ng BPI para sa mga Baguhan, mga Senior, mga Negosyo, at mga Nangangalaga sa Teknikal na Problema \- 跨境汇款 \- Panda Remit, [https://item.pandaremit.com/article/248815](https://item.pandaremit.com/article/248815)  
> 24. THE FUTURE IS HERE, NOW: \- UnionBank, [https://www.unionbankph.com/sites/default/files/2021-06/Annual%20Report%202020\~06-04-2021.pdf](https://www.unionbankph.com/sites/default/files/2021-06/Annual%20Report%202020~06-04-2021.pdf)  
> 25. Annual Report 2019 \- UnionBank, [https://www.unionbankph.com/sites/default/files/2021-04/Annual%20Report%202019\~07-31-2020.pdf](https://www.unionbankph.com/sites/default/files/2021-04/Annual%20Report%202019~07-31-2020.pdf)  
> 26. SEC Form 20-IS (Definitive Information Statement), [https://cdn.prod.website-files.com/69b8e32a7caf13f712cfd7c1/69f4e593f200e0b934ed2a70\_sec-form-20-is-definitive-information-statement-03312025-redacted\_09-46-23-281156.pdf](https://cdn.prod.website-files.com/69b8e32a7caf13f712cfd7c1/69f4e593f200e0b934ed2a70_sec-form-20-is-definitive-information-statement-03312025-redacted_09-46-23-281156.pdf)  
> 27. IMPORTANT: You must read the following disclaimer before continuing. The following disclaimer applies to the attached offering c \- pds group, [https://www.pds.com.ph/wp-content/uploads/2026/04/SECB-Offering-Circular-7Jul2023.pdf](https://www.pds.com.ph/wp-content/uploads/2026/04/SECB-Offering-Circular-7Jul2023.pdf)  
> 28. AboitizPower Preliminary Offer Supplement and SEC Submissions (3rd Tranche Bonds), [https://aboitizpower.com/static-assets/uploads/media/aboitizpower--offer-supplement-and-sec-submissions--3rd-tranche-bonds---yoda-\_redacted.pdf](https://aboitizpower.com/static-assets/uploads/media/aboitizpower--offer-supplement-and-sec-submissions--3rd-tranche-bonds---yoda-_redacted.pdf)  
> 29. Online, Mobile, and Digital Banks Comparison in the Philippines: A Definitive Guide \- Z.com, [https://web.z.com/ph/blogs/2294/](https://web.z.com/ph/blogs/2294/)  
> 30. Panahon Ng Bayanihan \- Philippine National Bank, [https://www.pnb.com.ph/storage/asset-libraries/jIpbO3u1gUtxZBAUg7YjR4xAyN98WglLui4BoNML.pdf](https://www.pnb.com.ph/storage/asset-libraries/jIpbO3u1gUtxZBAUg7YjR4xAyN98WglLui4BoNML.pdf)  
> 31. [https://www.pnb.com.ph/anti-phishing](https://www.pnb.com.ph/anti-phishing)  
> 32. Office Services Assistant Jobs in Davao Region | Careerjet, [https://www.careerjet.ph/office-services-assistant-jobs/Davao-Region](https://www.careerjet.ph/office-services-assistant-jobs/Davao-Region)  
> 33. Agentic AI Build Week \- Opportunities with GoTyme Crypto & Payment / Lending \- GoTymeX, [https://apply.workable.com/gotymex/j/448853720F/](https://apply.workable.com/gotymex/j/448853720F/)  
> 34. Agentic AI Build Week \- Opportunities with GoTyme Crypto & Payment / Lending | GoTymeX | Jobs By Workable, [https://jobs.workable.com/view/jWmP78KVbF1FH3TbUuUxp4/hybrid-agentic-ai-build-week---opportunities-with-gotyme-crypto-%26-payment-%2F-lending-in-ho-chi-minh-city-at-gotymex](https://jobs.workable.com/view/jWmP78KVbF1FH3TbUuUxp4/hybrid-agentic-ai-build-week---opportunities-with-gotyme-crypto-%26-payment-%2F-lending-in-ho-chi-minh-city-at-gotymex)  
> 35. About Us \- UNOBank, [https://www.uno.bank/about-us/](https://www.uno.bank/about-us/)  
> 36. Open a bank account for free | GoTyme Bank | South Africa. T's & C's Apply. Free Banking, [https://gotyme.co.za/](https://gotyme.co.za/)  
> 37. Product Manager \- Crypto, Custody & Payments \- GoTymeX \- BeBee, [https://bebee.com/hk/jobs/product-manager-crypto-custody-payments-gotymex-hong-kong--fj-2244211999](https://bebee.com/hk/jobs/product-manager-crypto-custody-payments-gotymex-hong-kong--fj-2244211999)  
> 38. SeaBank Philippines 2026 Company Profile: Valuation, Investors, Acquisition | PitchBook, [https://pitchbook.com/profiles/company/820647-37](https://pitchbook.com/profiles/company/820647-37)  
> 39. Safe Online Shopping in the Philippines: How To Do It \- Tonik Bank, [https://tonikbank.com/blog/tips-safer-online-shopping-philippines](https://tonikbank.com/blog/tips-safer-online-shopping-philippines)  
> 40. Digital Banking Philippines Conference 2024, [http://digital-banking.asia/philippines2024](http://digital-banking.asia/philippines2024)  
> 41. Terms and Conditions \- Tonik Bank, [https://tonikbank.com/tonikloans-terms-and-conditions](https://tonikbank.com/tonikloans-terms-and-conditions)  
> 42. Buy Now Pay Later: How to Get Installment Loans in the Philippines \- Tonik Bank, [https://tonikbank.com/blog/buy-now-pay-later](https://tonikbank.com/blog/buy-now-pay-later)  
> 43. terms and conditions \- UNO Digital Bank, [https://www.uno.bank/wp-content/uploads/2026/05/UNOBank-Terms-and-Conditions\_March2026.pdf](https://www.uno.bank/wp-content/uploads/2026/05/UNOBank-Terms-and-Conditions_March2026.pdf)